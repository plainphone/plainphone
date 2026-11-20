//! Synthetic devices and an in-process fake delivery server.
//!
//! The server stands in for the Plainphone Hono API: it stores opaque blobs
//! per recipient device, keeps one queue order per device, can order commits
//! (one accepted commit per epoch) and sends push payloads that carry no
//! content. It can also misbehave on purpose (substitute key packages,
//! withhold messages, reorder) so the scenarios can measure what the clients
//! detect.
//!
//! `Server::roster` plays the household log from docs/encryption.md §3: the
//! device IDs and signature keys every honest client has already verified.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

pub type Roster = Rc<RefCell<HashMap<String, Vec<u8>>>>;
use std::sync::atomic::{AtomicUsize, Ordering};

use openmls::prelude::{tls_codec::*, *};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::{MemoryStorage, RustCrypto};
use openmls_traits::OpenMlsProvider;

pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const PADDING: usize = 64;

static PAST_EPOCHS: AtomicUsize = AtomicUsize::new(0);

pub fn set_past_epochs(n: usize) {
    PAST_EPOCHS.store(n, Ordering::SeqCst);
}

#[derive(Default)]
pub struct Prov {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for Prov {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;
    fn storage(&self) -> &MemoryStorage {
        &self.storage
    }
    fn crypto(&self) -> &RustCrypto {
        &self.crypto
    }
    fn rand(&self) -> &RustCrypto {
        &self.crypto
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Welcome,
    Handshake,
    Application,
}

#[derive(Clone)]
pub struct Item {
    pub seq: u64,
    pub kind: Kind,
    pub body: Vec<u8>,
    held: bool,
}

#[derive(Default)]
pub struct Server {
    pub roster: Roster,
    pub key_packages: HashMap<String, Vec<u8>>,
    queues: HashMap<String, Vec<Item>>,
    history: Vec<(String, Kind, Vec<u8>)>,
    pushes: Vec<Vec<u8>>,
    seq: u64,
    epoch: Option<u64>,
    pub order_commits: bool,
    pub reject_stale_epoch: bool,
    pub deliver_handshakes_first: bool,
    pub withhold_from: Vec<String>,
    pub rejected: u32,
}

impl Server {
    pub fn new() -> Self {
        Server { order_commits: true, ..Default::default() }
    }

    pub fn publish_key_package(&mut self, d: &Device) {
        self.key_packages.insert(d.id.clone(), d.key_package());
    }

    pub fn substitute_key_package(&mut self, id: &str, evil: &Device) {
        self.key_packages.insert(id.to_string(), evil.key_package());
    }

    /// What a client does with a key package it fetched: parse and verify the
    /// self-signature. The roster check is separate (see `Device::add`).
    pub fn fetch_key_package(&self, id: &str) -> Result<KeyPackage, String> {
        let bytes = self.key_packages.get(id).ok_or(format!("no key package for {id}"))?;
        let kp = KeyPackageIn::tls_deserialize_exact(bytes).map_err(|e| format!("{e:?}"))?;
        kp.validate(&RustCrypto::default(), ProtocolVersion::Mls10).map_err(|e| format!("{e:?}"))
    }

    fn enqueue(&mut self, to: &str, kind: Kind, body: &[u8]) {
        self.seq += 1;
        let held = self.withhold_from.iter().any(|w| w == to);
        self.queues.entry(to.to_string()).or_default().push(Item { seq: self.seq, kind, body: body.to_vec(), held });
        self.history.push((to.to_string(), kind, body.to_vec()));
        // Push carries a conversation handle and a cursor, nothing else.
        self.pushes.push(format!("{{\"c\":\"fam1\",\"cursor\":{}}}", self.seq).into_bytes());
    }

    pub fn submit_commit(&mut self, epoch: u64, to: &[String], body: &[u8]) -> Result<(), String> {
        let current = self.epoch.unwrap_or(epoch);
        if self.order_commits && epoch != current {
            self.rejected += 1;
            return Err(format!("409 commit for epoch {epoch}, conversation is at {current}"));
        }
        self.epoch = Some(current.max(epoch) + 1);
        for r in to {
            self.enqueue(r, Kind::Handshake, body);
        }
        Ok(())
    }

    pub fn submit_welcome(&mut self, to: &[String], body: &[u8]) {
        for r in to {
            self.enqueue(r, Kind::Welcome, body);
        }
    }

    pub fn submit_app(&mut self, epoch: u64, to: &[String], body: &[u8]) -> Result<(), String> {
        if self.reject_stale_epoch {
            if let Some(cur) = self.epoch {
                if epoch < cur {
                    self.rejected += 1;
                    return Err(format!("409 text for epoch {epoch}, conversation is at {cur}"));
                }
            }
        }
        for r in to {
            self.enqueue(r, Kind::Application, body);
        }
        Ok(())
    }

    pub fn group_created(&mut self, epoch: u64) {
        self.epoch = Some(epoch);
    }

    pub fn take_queue(&mut self, id: &str) -> Vec<Item> {
        let withheld = self.withhold_from.iter().any(|w| w == id);
        let q = self.queues.entry(id.to_string()).or_default();
        let mut out = vec![];
        let mut keep = vec![];
        for it in q.drain(..) {
            if it.held && withheld {
                keep.push(it);
            } else {
                out.push(it);
            }
        }
        *q = keep;
        if self.deliver_handshakes_first {
            out.sort_by_key(|i| (i.kind == Kind::Application, i.seq));
        }
        out
    }

    pub fn queue_len(&self, id: &str) -> usize {
        self.queues.get(id).map_or(0, Vec::len)
    }

    pub fn all_ciphertexts_for(&self, id: &str) -> Vec<Vec<u8>> {
        self.history.iter().filter(|(to, k, _)| to == id && *k == Kind::Application).map(|(_, _, b)| b.clone()).collect()
    }

    pub fn everything_seen(&self) -> Vec<Vec<u8>> {
        let mut v: Vec<Vec<u8>> = self.key_packages.values().cloned().collect();
        v.extend(self.history.iter().map(|(_, _, b)| b.clone()));
        v.extend(self.pushes.iter().cloned());
        v
    }

    /// Parse the cleartext framing of application messages the way a curious
    /// server could.
    pub fn cleartext_headers(&self) -> String {
        let mut fields = vec![];
        for (_, k, b) in &self.history {
            if *k != Kind::Application {
                continue;
            }
            let m = MlsMessageIn::tls_deserialize_exact(b).expect("server parses framing");
            let wire = format!("{:?}", m.wire_format());
            let p = m.try_into_protocol_message().expect("protocol message");
            fields.push(format!(
                "wire_format={wire}, group_id={} bytes, epoch={}, content_type={:?}",
                p.group_id().as_slice().len(),
                p.epoch().as_u64(),
                p.content_type()
            ));
        }
        fields.sort();
        fields.dedup();
        fields.join("; ")
    }

    pub fn label_visibility(&self, label: &[u8]) -> (usize, usize) {
        let has = |b: &Vec<u8>| b.windows(label.len()).any(|w| w == label);
        (
            self.key_packages.values().filter(|b| has(b)).count(),
            self.history.iter().filter(|(_, _, b)| has(b)).count(),
        )
    }

    pub fn text_sizes(&self) -> Vec<usize> {
        // One entry per distinct ciphertext, in sending order.
        let mut seen: Vec<&Vec<u8>> = vec![];
        for (_, k, b) in &self.history {
            if *k == Kind::Application && !seen.contains(&b) {
                seen.push(b);
            }
        }
        seen.iter().map(|b| b.len()).collect()
    }
}

pub struct Device {
    pub id: String,
    honest: bool,
    prov: Prov,
    signer: SignatureKeyPair,
    cred: CredentialWithKey,
    group: Option<MlsGroup>,
    roster: Roster,
    pub last_errors: Vec<String>,
}

fn create_config() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .padding_size(PADDING)
        .max_past_epochs(PAST_EPOCHS.load(Ordering::SeqCst))
        .build()
}

fn join_config() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .padding_size(PADDING)
        .max_past_epochs(PAST_EPOCHS.load(Ordering::SeqCst))
        .build()
}

fn err<E: std::fmt::Debug>(e: E) -> String {
    let s = format!("{e:?}");
    // Keep notes short: the outermost variant names are enough.
    s.chars().take(110).collect()
}

impl Device {
    pub fn new(id: &str, roster: &Roster) -> Device {
        let d = Device::make(id, true);
        roster.borrow_mut().insert(id.to_string(), d.signer.to_public_vec());
        d.with_roster(roster.clone())
    }

    /// A device the household log never admitted (attacker-controlled).
    pub fn new_unlisted(id: &str) -> Device {
        Device::make(id, false)
    }

    fn make(id: &str, honest: bool) -> Device {
        let prov = Prov::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).expect("keygen");
        signer.store(prov.storage()).expect("store signer");
        let cred = CredentialWithKey {
            credential: BasicCredential::new(id.as_bytes().to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Device { id: id.to_string(), honest, prov, signer, cred, group: None, roster: Roster::default(), last_errors: vec![] }
    }

    fn with_roster(mut self, r: Roster) -> Device {
        self.roster = r;
        self
    }

    pub fn group(&self) -> &MlsGroup {
        self.group.as_ref().expect("in a group")
    }

    pub fn key_package(&self) -> Vec<u8> {
        let kpb = KeyPackage::builder()
            .build(CIPHERSUITE, &self.prov, &self.signer, self.cred.clone())
            .expect("key package");
        kpb.key_package().tls_serialize_detached().expect("serialize")
    }

    pub fn create_group(&mut self, server: &mut Server) -> Result<(), String> {
        let g = MlsGroup::new(&self.prov, &self.signer, &create_config(), self.cred.clone()).map_err(err)?;
        server.group_created(g.epoch().as_u64());
        self.group = Some(g);
        Ok(())
    }

    fn others(&self) -> Vec<String> {
        self.group()
            .members()
            .map(|m| String::from_utf8_lossy(m.credential.serialized_content()).to_string())
            .filter(|id| id != &self.id)
            .collect()
    }

    fn index_of(&self, id: &str) -> Result<LeafNodeIndex, String> {
        self.group()
            .members()
            .find(|m| m.credential.serialized_content() == id.as_bytes())
            .map(|m| m.index)
            .ok_or(format!("{id} is not a member"))
    }

    /// The binding check: the key package's identity must be in the
    /// household roster with exactly this signature key.
    fn check_roster(&self, identity: &[u8], sig_key: &[u8]) -> Result<(), String> {
        let id = String::from_utf8_lossy(identity);
        match self.roster.borrow().get(id.as_ref()) {
            Some(k) if k.as_slice() == sig_key => Ok(()),
            Some(_) => Err(format!("roster: {id} presents a signature key the household log does not list")),
            None => Err(format!("roster: {id} is not in the household log")),
        }
    }

    pub fn add(&mut self, server: &mut Server, kps: &[KeyPackage]) -> Result<(), String> {
        for kp in kps {
            let leaf = kp.leaf_node();
            self.check_roster(leaf.credential().serialized_content(), leaf.signature_key().as_slice())?;
        }
        self.add_unchecked(server, kps)
    }

    pub fn add_unchecked(&mut self, server: &mut Server, kps: &[KeyPackage]) -> Result<(), String> {
        let to = self.others();
        let new: Vec<String> = kps
            .iter()
            .map(|k| String::from_utf8_lossy(k.leaf_node().credential().serialized_content()).to_string())
            .collect();
        let epoch = self.group().epoch().as_u64();
        let g = self.group.as_mut().expect("group");
        let (commit, welcome, _) = g.add_members(&self.prov, &self.signer, kps).map_err(err)?;
        self.finish_commit(server, epoch, &to, commit)?;
        server.submit_welcome(&new, &welcome.to_bytes().map_err(err)?);
        Ok(())
    }

    fn finish_commit(&mut self, server: &mut Server, epoch: u64, to: &[String], commit: MlsMessageOut) -> Result<(), String> {
        let bytes = commit.to_bytes().map_err(err)?;
        let g = self.group.as_mut().expect("group");
        match server.submit_commit(epoch, to, &bytes) {
            Ok(()) => g.merge_pending_commit(&self.prov).map_err(err),
            Err(e) => {
                g.clear_pending_commit(self.prov.storage()).map_err(err)?;
                Err(e)
            }
        }
    }

    pub fn remove(&mut self, server: &mut Server, ids: &[&str]) -> Result<(), String> {
        let idx = ids.iter().map(|i| self.index_of(i)).collect::<Result<Vec<_>, _>>()?;
        let to = self.others();
        let epoch = self.group().epoch().as_u64();
        let g = self.group.as_mut().expect("group");
        let (commit, _, _) = g.remove_members(&self.prov, &self.signer, &idx).map_err(err)?;
        self.finish_commit(server, epoch, &to, commit)
    }

    /// Remove a lost device and add its re-enrolled successor in one commit.
    pub fn replace(&mut self, server: &mut Server, old: &str, kp: KeyPackage) -> Result<(), String> {
        let leaf = kp.leaf_node();
        self.check_roster(leaf.credential().serialized_content(), leaf.signature_key().as_slice())?;
        let new = String::from_utf8_lossy(leaf.credential().serialized_content()).to_string();
        let idx = self.index_of(old)?;
        let to: Vec<String> = self.others().into_iter().filter(|o| o != old).collect();
        let epoch = self.group().epoch().as_u64();
        let g = self.group.as_mut().expect("group");
        let msgs = g.swap_members(&self.prov, &self.signer, &[idx], &[kp]).map_err(err)?;
        let welcome = msgs.welcome.to_bytes().map_err(err)?;
        self.finish_commit(server, epoch, &to, msgs.commit)?;
        server.submit_welcome(&[new], &welcome);
        Ok(())
    }

    pub fn self_update(&mut self, server: &mut Server) -> Result<(), String> {
        let to = self.others();
        let epoch = self.group().epoch().as_u64();
        let g = self.group.as_mut().expect("group");
        let bundle = g.self_update(&self.prov, &self.signer, LeafNodeParameters::default()).map_err(err)?;
        let (commit, _, _) = bundle.into_contents();
        self.finish_commit(server, epoch, &to, commit)
    }

    pub fn send(&mut self, server: &mut Server, text: &str) -> Result<(), String> {
        let g = self.group.as_mut().ok_or("no group")?;
        if !g.is_active() {
            return Err("group inactive after removal".into());
        }
        let epoch = g.epoch().as_u64();
        let m = g.create_message(&self.prov, &self.signer, text.as_bytes()).map_err(err)?;
        let to = self.others();
        server.submit_app(epoch, &to, &m.to_bytes().map_err(err)?)
    }

    /// Fetch and process the queue. Undecryptable items are recorded in
    /// `last_errors`; only a roster violation aborts.
    pub fn sync(&mut self, server: &mut Server) -> Result<Vec<String>, String> {
        self.last_errors.clear();
        let mut texts = vec![];
        for it in server.take_queue(&self.id.clone()) {
            match self.process_raw(&it.body) {
                Ok(Some(t)) => texts.push(t),
                Ok(None) => {}
                Err(e) if e.starts_with("roster") => return Err(e),
                Err(e) => self.last_errors.push(e),
            }
        }
        Ok(texts)
    }

    pub fn try_decrypt_raw(&mut self, body: &[u8]) -> Result<Option<String>, String> {
        self.process_raw(body)
    }

    pub fn process_raw(&mut self, body: &[u8]) -> Result<Option<String>, String> {
        let msg = MlsMessageIn::tls_deserialize_exact(body).map_err(err)?;
        match msg.extract() {
            MlsMessageBodyIn::Welcome(w) => {
                let staged = StagedWelcome::new_from_welcome(&self.prov, &join_config(), w, None).map_err(err)?;
                if self.honest {
                    for m in staged.members() {
                        self.check_roster(m.credential.serialized_content(), &m.signature_key)?;
                    }
                }
                self.group = Some(staged.into_group(&self.prov).map_err(err)?);
                Ok(None)
            }
            MlsMessageBodyIn::PrivateMessage(p) => self.process_protocol(p.into()),
            MlsMessageBodyIn::PublicMessage(p) => self.process_protocol(p.into()),
            _ => Err("unexpected message body".into()),
        }
    }

    fn process_protocol(&mut self, p: ProtocolMessage) -> Result<Option<String>, String> {
        let g = self.group.as_mut().ok_or("no group")?;
        let processed = g.process_message(&self.prov, p).map_err(err)?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(a) => {
                Ok(Some(String::from_utf8_lossy(&a.into_bytes()).to_string()))
            }
            ProcessedMessageContent::StagedCommitMessage(sc) => {
                if self.honest {
                    for add in sc.add_proposals() {
                        let leaf = add.add_proposal().key_package().leaf_node();
                        self.check_roster(leaf.credential().serialized_content(), leaf.signature_key().as_slice())?;
                    }
                }
                let g = self.group.as_mut().expect("group");
                if g.pending_commit().is_some() {
                    // Our own commit lost the race: drop it, apply theirs.
                    g.clear_pending_commit(self.prov.storage()).map_err(err)?;
                }
                g.merge_staged_commit(&self.prov, *sc).map_err(err)?;
                Ok(None)
            }
            ProcessedMessageContent::ProposalMessage(p) => {
                let g = self.group.as_mut().expect("group");
                g.store_pending_proposal(self.prov.storage(), *p).map_err(err)?;
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    /// Serialize the device store the way an app would persist it, and report
    /// whether private signing key bytes appear in it.
    pub fn snapshot(&self) -> (Vec<u8>, bool) {
        // A simple length-prefixed dump of the key-value store, the shape an
        // app would hand to encrypted local storage.
        let values = self.prov.storage().values.read().expect("lock");
        let mut keys: Vec<&Vec<u8>> = values.keys().collect();
        keys.sort();
        let mut out = vec![];
        let mut private_in_clear = false;
        for k in keys {
            let v = &values[k];
            out.extend_from_slice(&(k.len() as u32).to_be_bytes());
            out.extend_from_slice(k);
            out.extend_from_slice(&(v.len() as u32).to_be_bytes());
            out.extend_from_slice(v);
            if v.windows(9).any(|w| w == b"\"private\"") {
                private_in_clear = true;
            }
        }
        (out, private_in_clear)
    }

    pub fn restore(from: &Device, bytes: &[u8]) -> Result<Device, String> {
        let mut map = HashMap::new();
        let mut i = 0;
        let mut take = |i: &mut usize| -> Vec<u8> {
            let n = u32::from_be_bytes(bytes[*i..*i + 4].try_into().expect("len")) as usize;
            let v = bytes[*i + 4..*i + 4 + n].to_vec();
            *i += 4 + n;
            v
        };
        while i < bytes.len() {
            let k = take(&mut i);
            let v = take(&mut i);
            map.insert(k, v);
        }
        let storage = MemoryStorage { values: std::sync::RwLock::new(map) };
        let prov = Prov { crypto: RustCrypto::default(), storage };
        let signer = SignatureKeyPair::read(prov.storage(), from.signer.public(), from.signer.signature_scheme())
            .ok_or("signer not in store")?;
        let group = match &from.group {
            Some(g) => MlsGroup::load(prov.storage(), g.group_id()).map_err(err)?,
            None => None,
        };
        Ok(Device {
            id: from.id.clone(),
            honest: from.honest,
            prov,
            signer,
            cred: from.cred.clone(),
            group,
            roster: from.roster.clone(),
            last_errors: vec![],
        })
    }

    pub fn clone_for_experiment(&self) -> Result<Device, String> {
        let (bytes, _) = self.snapshot();
        Device::restore(self, &bytes)
    }
}
