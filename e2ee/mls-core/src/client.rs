//! One MLS client (one household device) and the Plainphone checks around OpenMLS.
//!
//! Parameters from the recommendation (docs/research/e2ee-recommendation.md,
//! "Recommended design"): suite 0x0001, `PURE_CIPHERTEXT`, padding 64,
//! `max_past_epochs` 0, the default sender ratchet, and the ratchet tree in
//! the Welcome. The checks are the "Plainphone checks" from the same report:
//! every leaf matches the roster, only admins add or remove, a client refuses
//! to send while the group holds a device the roster no longer lists, and
//! duplicates are dropped before decryption.

use std::collections::{BTreeMap, VecDeque};

use openmls::prelude::{tls_codec::*, *};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::{MemoryStorage, RustCrypto};
use openmls_traits::OpenMlsProvider;

use sha2::{Digest, Sha256};

use crate::b64;
use crate::error::{mls, Error};
use crate::roster::{EntryIn, Role, Roster};

pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
pub const PADDING: usize = 64;
pub const MAX_PAST_EPOCHS: usize = 0;
/// Largest text the prototype encrypts, in UTF-8 bytes.
pub const MAX_TEXT_BYTES: usize = 2000;
/// How many ciphertext hashes and message IDs a group remembers for dedupe.
const SEEN_LIMIT: usize = 1000;

#[derive(Default)]
pub struct Provider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for Provider {
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

fn create_config() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .padding_size(PADDING)
        .max_past_epochs(MAX_PAST_EPOCHS)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .build()
}

fn join_config() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .padding_size(PADDING)
        .max_past_epochs(MAX_PAST_EPOCHS)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .build()
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Seen {
    ciphertexts: VecDeque<String>,
    message_ids: VecDeque<String>,
}

impl Seen {
    fn remember(list: &mut VecDeque<String>, v: String) {
        list.push_back(v);
        while list.len() > SEEN_LIMIT {
            list.pop_front();
        }
    }
}

struct Conversation {
    group: MlsGroup,
    seen: Seen,
    /// False once a merged commit produced a tree the roster does not match.
    trusted: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub device_id: String,
    pub role: Option<Role>,
}

/// A commit this client made and has not merged yet. The app posts it to the
/// delivery service, then calls `merge_pending` (accepted) or `clear_pending` (409).
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub group_id: String,
    /// The epoch the commit was made in. The server accepts one commit per epoch.
    pub epoch: u64,
    pub commit: String,
    pub welcome: Option<String>,
    /// Device IDs after the commit: the server's recipient list for the next epoch.
    pub members: Vec<String>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

#[derive(serde::Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    Joined {
        group_id: String,
        epoch: u64,
        by: String,
        members: Vec<Member>,
    },
    Commit {
        group_id: String,
        epoch: u64,
        by: String,
        added: Vec<String>,
        removed: Vec<String>,
        members: Vec<Member>,
    },
    /// This device was removed. Its group state is deleted.
    Removed {
        group_id: String,
        by: String,
    },
    Text {
        group_id: String,
        epoch: u64,
        sender: String,
        message_id: String,
        text: String,
    },
    /// Already processed (same ciphertext, or a retry with the same message ID).
    Duplicate {
        group_id: String,
    },
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plaintext {
    v: u8,
    id: String,
    text: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    v: u8,
    device_id: String,
    mls_sign_pub: String,
    roster_version: u64,
    roster: Vec<EntryIn>,
    groups: Vec<(String, bool, Seen)>,
    store: Vec<(String, String)>,
}

pub struct Client {
    pub device_id: String,
    provider: Provider,
    signer: SignatureKeyPair,
    roster: Roster,
    groups: BTreeMap<Vec<u8>, Conversation>,
}

fn device_of(credential: &Credential) -> String {
    String::from_utf8_lossy(credential.serialized_content()).into_owned()
}

fn conversation<'a>(groups: &'a mut BTreeMap<Vec<u8>, Conversation>, group_id: &str) -> Result<&'a mut Conversation, Error> {
    let id = b64::decode(group_id)?;
    groups.get_mut(&id).ok_or_else(|| Error::new("group_unknown", "no such group on this device"))
}

fn hash(bytes: &[u8]) -> String {
    b64::encode(&Sha256::digest(bytes))
}

impl Client {
    pub fn new(device_id: &str) -> Result<Client, Error> {
        if !crate::roster::valid_device_id(device_id) {
            return Err(Error::new("bad_request", "device id must be 1-64 characters of [a-z0-9-]"));
        }
        let provider = Provider::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(mls)?;
        signer.store(provider.storage()).map_err(mls)?;
        Ok(Client { device_id: device_id.to_string(), provider, signer, roster: Roster::default(), groups: BTreeMap::new() })
    }

    pub fn mls_sign_pub(&self) -> Vec<u8> {
        self.signer.to_public_vec()
    }

    fn credential(&self) -> CredentialWithKey {
        CredentialWithKey {
            credential: BasicCredential::new(self.device_id.as_bytes().to_vec()).into(),
            signature_key: self.signer.to_public_vec().into(),
        }
    }

    /// Replace the roster. Versions only move forward, so an old copy of the log
    /// cannot be replayed to bring a removed device back.
    pub fn set_roster(&mut self, version: u64, entries: &[EntryIn]) -> Result<usize, Error> {
        if version < self.roster.version || (version == self.roster.version && version != 0) {
            return Err(Error::new(
                "roster_stale",
                format!("roster version {version} is not newer than {}", self.roster.version),
            ));
        }
        let roster = Roster::from_entries(version, entries)?;
        let me =
            roster.get(&self.device_id).ok_or_else(|| Error::new("roster_unknown_device", "this device is not in the roster"))?;
        if me.mls_sign_pub != self.mls_sign_pub() {
            return Err(Error::new("roster_key_mismatch", "the roster lists another key for this device"));
        }
        let n = entries.len();
        self.roster = roster;
        Ok(n)
    }

    fn my_role(&self) -> Result<Role, Error> {
        self.roster
            .get(&self.device_id)
            .map(|e| e.role)
            .ok_or_else(|| Error::new("roster_unknown_device", "set the roster first"))
    }

    pub fn key_packages(&self, count: usize, last_resort: bool) -> Result<(Vec<String>, Option<String>), Error> {
        if count > 20 {
            return Err(Error::new("bad_request", "at most 20 key packages at a time"));
        }
        let build = |resort: bool| -> Result<String, Error> {
            // A last-resort package carries the LastResort extension, which its leaf must list.
            let caps = Capabilities::new(None, Some(&[CIPHERSUITE]), Some(&[ExtensionType::LastResort]), None, None);
            let builder = KeyPackage::builder().leaf_node_capabilities(caps);
            let builder = if resort { builder.mark_as_last_resort() } else { builder };
            let bundle = builder.build(CIPHERSUITE, &self.provider, &self.signer, self.credential()).map_err(mls)?;
            Ok(b64::encode(&bundle.key_package().tls_serialize_detached().map_err(mls)?))
        };
        let list = (0..count).map(|_| build(false)).collect::<Result<Vec<_>, _>>()?;
        let resort = if last_resort { Some(build(true)?) } else { None };
        Ok((list, resort))
    }

    fn conversation(&mut self, group_id: &str) -> Result<&mut Conversation, Error> {
        conversation(&mut self.groups, group_id)
    }

    fn members_of(&self, group: &MlsGroup) -> Vec<Member> {
        let mut out: Vec<Member> = group
            .members()
            .map(|m| {
                let device_id = device_of(&m.credential);
                let role = self.roster.get(&device_id).filter(|e| e.mls_sign_pub == m.signature_key).map(|e| e.role);
                Member { device_id, role }
            })
            .collect();
        out.sort_by(|a, b| a.device_id.cmp(&b.device_id));
        out
    }

    /// Every leaf must be a roster device with its bound key.
    fn check_tree(&self, group: &MlsGroup) -> Result<(), Error> {
        for m in group.members() {
            self.roster.check_leaf(m.credential.serialized_content(), &m.signature_key)?;
        }
        Ok(())
    }

    pub fn create_group(&mut self) -> Result<(String, u64, Vec<Member>), Error> {
        if self.my_role()? != Role::Admin {
            return Err(Error::new("not_admin", "only a parent device creates a conversation"));
        }
        let group = MlsGroup::new(&self.provider, &self.signer, &create_config(), self.credential()).map_err(mls)?;
        let id = group.group_id().as_slice().to_vec();
        let out = (b64::encode(&id), group.epoch().as_u64(), self.members_of(&group));
        self.groups.insert(id, Conversation { group, seen: Seen::default(), trusted: true });
        Ok(out)
    }

    pub fn members(&mut self, group_id: &str) -> Result<(u64, Vec<Member>, Vec<String>, bool), Error> {
        let conv = self.conversation(group_id)?;
        let (epoch, trusted) = (conv.group.epoch().as_u64(), conv.trusted);
        let id = conv.group.group_id().as_slice().to_vec();
        let group = &self.groups[&id].group;
        let members = self.members_of(group);
        let stale = members.iter().filter(|m| m.role.is_none()).map(|m| m.device_id.clone()).collect();
        Ok((epoch, members, stale, trusted))
    }

    fn ready_to_commit(&mut self, group_id: &str) -> Result<Vec<u8>, Error> {
        if self.my_role()? != Role::Admin {
            return Err(Error::new("not_admin", "only a parent device adds or removes members"));
        }
        let conv = self.conversation(group_id)?;
        if !conv.trusted || !conv.group.is_active() {
            return Err(Error::new("group_untrusted", "this conversation is not usable"));
        }
        if conv.group.pending_commit().is_some() {
            return Err(Error::new("pending_commit", "merge or clear the previous commit first"));
        }
        Ok(conv.group.group_id().as_slice().to_vec())
    }

    fn pending(
        &self,
        id: &[u8],
        epoch: u64,
        commit: MlsMessageOut,
        welcome: Option<MlsMessageOut>,
        added: Vec<String>,
        removed: Vec<String>,
    ) -> Result<Pending, Error> {
        let group = &self.groups[id].group;
        // Members after the commit = current members minus removed plus added.
        let mut members: Vec<String> =
            group.members().map(|m| device_of(&m.credential)).filter(|d| !removed.contains(d)).collect();
        members.extend(added.iter().cloned());
        members.sort();
        Ok(Pending {
            group_id: b64::encode(id),
            epoch,
            commit: b64::encode(&commit.to_bytes().map_err(mls)?),
            welcome: welcome.map(|w| w.to_bytes().map(|b| b64::encode(&b))).transpose().map_err(mls)?,
            members,
            added,
            removed,
        })
    }

    /// Add devices from their published key packages. Each must validate, use
    /// our suite and match the roster.
    pub fn add_members(&mut self, group_id: &str, key_packages: &[String]) -> Result<Pending, Error> {
        let id = self.ready_to_commit(group_id)?;
        if key_packages.is_empty() || key_packages.len() > 10 {
            return Err(Error::new("bad_request", "add 1 to 10 devices at a time"));
        }
        let current: Vec<String> = self.groups[&id].group.members().map(|m| device_of(&m.credential)).collect();
        let mut kps = vec![];
        let mut added = vec![];
        for kp in key_packages {
            let bytes = b64::decode(kp)?;
            let kp = KeyPackageIn::tls_deserialize_exact(&bytes)
                .map_err(mls)?
                .validate(self.provider.crypto(), ProtocolVersion::Mls10)
                .map_err(mls)?;
            if kp.ciphersuite() != CIPHERSUITE {
                return Err(Error::new("bad_request", "key package uses another ciphersuite"));
            }
            let leaf = kp.leaf_node();
            let (device, _) = self.roster.check_leaf(leaf.credential().serialized_content(), leaf.signature_key().as_slice())?;
            if current.contains(&device) || added.contains(&device) {
                return Err(Error::new("bad_request", format!("{device} is already a member")));
            }
            added.push(device);
            kps.push(kp);
        }
        let conv = self.groups.get_mut(&id).expect("checked");
        let epoch = conv.group.epoch().as_u64();
        let (commit, welcome, _) = conv.group.add_members(&self.provider, &self.signer, &kps).map_err(mls)?;
        self.pending(&id, epoch, commit, Some(welcome), added, vec![])
    }

    pub fn remove_members(&mut self, group_id: &str, device_ids: &[String]) -> Result<Pending, Error> {
        let id = self.ready_to_commit(group_id)?;
        if device_ids.is_empty() || device_ids.iter().any(|d| d == &self.device_id) {
            return Err(Error::new("bad_request", "name 1 or more other devices"));
        }
        let group = &self.groups[&id].group;
        let mut idx = vec![];
        for d in device_ids {
            let m = group
                .members()
                .find(|m| m.credential.serialized_content() == d.as_bytes())
                .ok_or_else(|| Error::new("bad_request", format!("{d} is not a member")))?;
            idx.push(m.index);
        }
        let conv = self.groups.get_mut(&id).expect("checked");
        let epoch = conv.group.epoch().as_u64();
        let (commit, welcome, _) = conv.group.remove_members(&self.provider, &self.signer, &idx).map_err(mls)?;
        self.pending(&id, epoch, commit, welcome, vec![], device_ids.to_vec())
    }

    /// Key rotation: a commit with an update path and a fresh leaf. Any member may do it.
    pub fn update(&mut self, group_id: &str) -> Result<Pending, Error> {
        let conv = conversation(&mut self.groups, group_id)?;
        if !conv.trusted || !conv.group.is_active() {
            return Err(Error::new("group_untrusted", "this conversation is not usable"));
        }
        if conv.group.pending_commit().is_some() {
            return Err(Error::new("pending_commit", "merge or clear the previous commit first"));
        }
        let id = conv.group.group_id().as_slice().to_vec();
        let epoch = conv.group.epoch().as_u64();
        let bundle = conv.group.self_update(&self.provider, &self.signer, LeafNodeParameters::default()).map_err(mls)?;
        let (commit, _, _) = bundle.into_contents();
        self.pending(&id, epoch, commit, None, vec![], vec![])
    }

    pub fn merge_pending(&mut self, group_id: &str) -> Result<(u64, Vec<Member>), Error> {
        let conv = conversation(&mut self.groups, group_id)?;
        if conv.group.pending_commit().is_none() {
            return Err(Error::new("bad_request", "no pending commit"));
        }
        let id = conv.group.group_id().as_slice().to_vec();
        conv.group.merge_pending_commit(&self.provider).map_err(mls)?;
        let group = &self.groups[&id].group;
        Ok((group.epoch().as_u64(), self.members_of(group)))
    }

    pub fn clear_pending(&mut self, group_id: &str) -> Result<(), Error> {
        let conv = conversation(&mut self.groups, group_id)?;
        conv.group.clear_pending_commit(self.provider.storage()).map_err(mls)
    }

    pub fn encrypt(&mut self, group_id: &str, message_id: &str, text: &str) -> Result<(String, u64), Error> {
        if text.len() > MAX_TEXT_BYTES {
            return Err(Error::new("bad_request", "text too long"));
        }
        if !crate::roster::valid_device_id(message_id) {
            return Err(Error::new("bad_request", "message id must be 1-64 characters of [a-z0-9-]"));
        }
        let (_, _, stale, trusted) = self.members(group_id)?;
        if !stale.is_empty() {
            // The roster no longer lists a member: remove it before anyone sends.
            return Err(Error::new("stale_members", format!("remove {} first", stale.join(", "))));
        }
        let plaintext = serde_json::to_vec(&Plaintext { v: 1, id: message_id.to_string(), text: text.to_string() })
            .map_err(|_| Error::new("bad_request", "text"))?;
        let conv = conversation(&mut self.groups, group_id)?;
        if !trusted || !conv.group.is_active() {
            return Err(Error::new("group_untrusted", "this conversation is not usable"));
        }
        let epoch = conv.group.epoch().as_u64();
        let msg = conv.group.create_message(&self.provider, &self.signer, &plaintext).map_err(mls)?;
        Seen::remember(&mut conv.seen.message_ids, message_id.to_string());
        Ok((b64::encode(&msg.to_bytes().map_err(mls)?), epoch))
    }

    pub fn process(&mut self, message: &str) -> Result<Event, Error> {
        let bytes = b64::decode(message)?;
        let msg = MlsMessageIn::tls_deserialize_exact(&bytes).map_err(mls)?;
        match msg.extract() {
            MlsMessageBodyIn::Welcome(w) => self.join(w),
            MlsMessageBodyIn::PrivateMessage(p) => self.process_protocol(p.into(), &bytes),
            // PURE_CIPHERTEXT: a public handshake message is a policy violation.
            MlsMessageBodyIn::PublicMessage(_) => Err(Error::new("bad_message", "public messages are not accepted")),
            _ => Err(Error::new("bad_message", "unexpected message type")),
        }
    }

    fn join(&mut self, welcome: Welcome) -> Result<Event, Error> {
        self.my_role()?;
        let staged = StagedWelcome::new_from_welcome(&self.provider, &join_config(), welcome, None).map_err(mls)?;
        // The welcome must come from an admin, and every member must be on the roster.
        let sender = staged.welcome_sender().map_err(mls)?;
        let (by, role) = self.roster.check_leaf(sender.credential().serialized_content(), sender.signature_key().as_slice())?;
        if role != Role::Admin {
            return Err(Error::new("not_admin", format!("{by} may not add members")));
        }
        for m in staged.members() {
            self.roster.check_leaf(m.credential.serialized_content(), &m.signature_key)?;
        }
        if staged.group_context().ciphersuite() != CIPHERSUITE {
            return Err(Error::new("bad_message", "conversation uses another ciphersuite"));
        }
        let group = staged.into_group(&self.provider).map_err(mls)?;
        let id = group.group_id().as_slice().to_vec();
        let event =
            Event::Joined { group_id: b64::encode(&id), epoch: group.epoch().as_u64(), by, members: self.members_of(&group) };
        self.groups.insert(id, Conversation { group, seen: Seen::default(), trusted: true });
        Ok(event)
    }

    fn process_protocol(&mut self, p: ProtocolMessage, raw: &[u8]) -> Result<Event, Error> {
        let id = p.group_id().as_slice().to_vec();
        let group_id = b64::encode(&id);
        let digest = hash(raw);
        let conv = self.groups.get_mut(&id).ok_or_else(|| Error::new("group_unknown", "no such group on this device"))?;
        // Dedupe before decrypting: a second decryption of the same ciphertext fails
        // as SecretReuseError, which would look like tampering.
        if conv.seen.ciphertexts.contains(&digest) {
            return Ok(Event::Duplicate { group_id });
        }
        if !conv.trusted {
            return Err(Error::new("group_untrusted", "this conversation is not usable"));
        }
        let processed = conv.group.process_message(&self.provider, p).map_err(mls)?;
        let epoch = processed.epoch().as_u64();
        let leaf = match processed.sender() {
            Sender::Member(leaf) => *leaf,
            _ => return Err(Error::new("bad_message", "only members send")),
        };
        // The sender's leaf (credential and signature key) as the current tree has it, checked
        // against the roster. A device the roster removed is refused even before the removal
        // commit lands.
        let member = conv.group.member_at(leaf).ok_or_else(|| Error::new("bad_message", "sender leaf is empty"))?;
        let sender = device_of(&member.credential);
        let sender_role = self.roster.check_leaf(member.credential.serialized_content(), &member.signature_key).map(|(_, r)| r);
        let event = match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(a) => {
                sender_role?;
                let pt: Plaintext = serde_json::from_slice(&a.into_bytes())
                    .map_err(|_| Error::new("bad_message", "plaintext is not a Plainphone message"))?;
                if pt.v != 1 {
                    return Err(Error::new("bad_message", "unsupported message version"));
                }
                let conv = self.groups.get_mut(&id).expect("exists");
                Seen::remember(&mut conv.seen.ciphertexts, digest);
                if conv.seen.message_ids.contains(&pt.id) {
                    return Ok(Event::Duplicate { group_id });
                }
                Seen::remember(&mut conv.seen.message_ids, pt.id.clone());
                Event::Text { group_id, epoch, sender, message_id: pt.id, text: pt.text }
            }
            ProcessedMessageContent::StagedCommitMessage(sc) => {
                let (added, removed) = self.check_commit(&id, &sender, sender_role, &sc)?;
                let conv = self.groups.get_mut(&id).expect("exists");
                if conv.group.pending_commit().is_some() {
                    // Our own commit lost the race for this epoch: drop it, apply theirs.
                    conv.group.clear_pending_commit(self.provider.storage()).map_err(mls)?;
                }
                let self_removed = sc.self_removed();
                conv.group.merge_staged_commit(&self.provider, *sc).map_err(mls)?;
                Seen::remember(&mut conv.seen.ciphertexts, digest);
                if self_removed || !conv.group.is_active() {
                    // Deletion on removal: nothing of this conversation stays on the device.
                    let mut conv = self.groups.remove(&id).expect("exists");
                    conv.group.delete(self.provider.storage()).map_err(mls)?;
                    return Ok(Event::Removed { group_id, by: sender });
                }
                let group = &self.groups[&id].group;
                if let Err(e) = self.check_tree(group) {
                    self.groups.get_mut(&id).expect("exists").trusted = false;
                    return Err(e);
                }
                let group = &self.groups[&id].group;
                Event::Commit {
                    group_id,
                    epoch: group.epoch().as_u64(),
                    by: sender,
                    added,
                    removed,
                    members: self.members_of(group),
                }
            }
            _ => return Err(Error::new("bad_message", "standalone proposals and own messages are not accepted")),
        };
        Ok(event)
    }

    /// The checks on an incoming commit, before it is merged.
    fn check_commit(
        &self,
        id: &[u8],
        sender: &str,
        sender_role: Result<Role, Error>,
        sc: &StagedCommit,
    ) -> Result<(Vec<String>, Vec<String>), Error> {
        let role = sender_role?;
        let group = &self.groups[id].group;
        let mut added = vec![];
        let mut removed = vec![];
        for q in sc.queued_proposals() {
            match q.proposal() {
                Proposal::Add(_) | Proposal::Remove(_) => {}
                _ => return Err(Error::new("unsupported_proposal", "only add and remove proposals are accepted")),
            }
        }
        for add in sc.add_proposals() {
            let leaf = add.add_proposal().key_package().leaf_node();
            let (device, _) = self.roster.check_leaf(leaf.credential().serialized_content(), leaf.signature_key().as_slice())?;
            added.push(device);
        }
        for r in sc.remove_proposals() {
            let m = group
                .member_at(r.remove_proposal().removed())
                .ok_or_else(|| Error::new("bad_message", "removal of an empty leaf"))?;
            removed.push(device_of(&m.credential));
        }
        if (!added.is_empty() || !removed.is_empty()) && role != Role::Admin {
            return Err(Error::new("not_admin", format!("{sender} may not add or remove members")));
        }
        if let Some(leaf) = sc.update_path_leaf_node() {
            let (device, _) = self.roster.check_leaf(leaf.credential().serialized_content(), leaf.signature_key().as_slice())?;
            if device != sender {
                return Err(Error::new("roster_key_mismatch", "update path leaf does not belong to the committer"));
            }
        }
        Ok((added, removed))
    }

    /// The whole device state, including the private keys IN CLEAR. The app
    /// must encrypt it (Android Keystore AES-GCM) and exclude it from backups.
    pub fn export_state(&self) -> Result<String, Error> {
        let values = self.provider.storage.values.read().map_err(|_| Error::new("internal", "storage lock"))?;
        let mut store: Vec<(String, String)> = values.iter().map(|(k, v)| (b64::encode(k), b64::encode(v))).collect();
        store.sort();
        let state = State {
            v: 1,
            device_id: self.device_id.clone(),
            mls_sign_pub: b64::encode(self.signer.public()),
            roster_version: self.roster.version,
            roster: self.roster.sources(),
            groups: self.groups.iter().map(|(id, c)| (b64::encode(id), c.trusted, c.seen.clone())).collect(),
            store,
        };
        Ok(b64::encode(&serde_json::to_vec(&state).map_err(|_| Error::new("internal", "state"))?))
    }

    pub fn import_state(state: &str) -> Result<Client, Error> {
        let state: State =
            serde_json::from_slice(&b64::decode(state)?).map_err(|_| Error::new("bad_request", "not a state blob"))?;
        if state.v != 1 {
            return Err(Error::new("bad_request", "unsupported state version"));
        }
        let mut values = std::collections::HashMap::new();
        for (k, v) in &state.store {
            values.insert(b64::decode(k)?, b64::decode(v)?);
        }
        let provider =
            Provider { crypto: RustCrypto::default(), storage: MemoryStorage { values: std::sync::RwLock::new(values) } };
        let signer =
            SignatureKeyPair::read(provider.storage(), &b64::decode(&state.mls_sign_pub)?, CIPHERSUITE.signature_algorithm())
                .ok_or_else(|| Error::new("bad_request", "signature key missing from state"))?;
        let roster =
            if state.roster.is_empty() { Roster::default() } else { Roster::from_entries(state.roster_version, &state.roster)? };
        let mut groups = BTreeMap::new();
        for (gid, trusted, seen) in state.groups {
            let id = b64::decode(&gid)?;
            let group = MlsGroup::load(provider.storage(), &GroupId::from_slice(&id))
                .map_err(mls)?
                .ok_or_else(|| Error::new("bad_request", "group missing from state"))?;
            groups.insert(id, Conversation { group, seen, trusted });
        }
        Ok(Client { device_id: state.device_id, provider, signer, roster, groups })
    }
}
