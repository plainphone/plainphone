//! Synthetic devices and an in-process fake homeserver for the Matrix model.
//!
//! This reproduces how the Matrix Rust SDK (matrix-sdk-crypto) uses
//! vodozemac: every device has an Olm account (Curve25519 identity key,
//! Ed25519 signing key, one-time keys); every sender owns an outbound Megolm
//! session per room and shares its key with each recipient device over a
//! pairwise Olm channel (to-device). Room events carry Megolm ciphertext.
//!
//! The server stands in for a private homeserver or the Plainphone API acting
//! as one: a device-key directory (keys/query), one-time keys (keys/claim),
//! per-device to-device queues and one ordered room timeline. It can
//! misbehave on purpose. `Roster` plays the Plainphone household log.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use vodozemac::megolm::{GroupSession, InboundGroupSession, MegolmMessage, SessionConfig as MegolmConfig, SessionKey};
use vodozemac::olm::{Account, AccountPickle, OlmMessage, Session, SessionConfig as OlmConfig, SessionPickle};
use vodozemac::{Curve25519PublicKey, Ed25519PublicKey};

pub type Roster = Rc<RefCell<HashMap<String, (Curve25519PublicKey, Ed25519PublicKey)>>>;

pub const PICKLE_KEY: [u8; 32] = [7u8; 32];

#[derive(Clone)]
pub struct Event {
    pub seq: u64,
    pub sender: String,
    pub session_id: String,
    pub body: Vec<u8>,
}

#[derive(Clone)]
pub struct ToDevice {
    pub seq: u64,
    pub from: String,
    pub sender_key: Curve25519PublicKey,
    pub msg_type: usize,
    pub body: Vec<u8>,
    held: bool,
}

#[derive(Default)]
pub struct Server {
    pub roster: Roster,
    pub directory: HashMap<String, (Curve25519PublicKey, Ed25519PublicKey)>,
    one_time_keys: HashMap<String, Vec<Curve25519PublicKey>>,
    to_device: HashMap<String, Vec<ToDevice>>,
    pub timeline: Vec<Event>,
    cursors: HashMap<String, usize>,
    pushes: Vec<Vec<u8>>,
    /// Devices the server lists as room members (what keys/query and the
    /// member list would return).
    pub room_devices: Vec<String>,
    pub withhold_from: Vec<String>,
    seq: u64,
}

impl Server {
    pub fn upload_keys(&mut self, d: &mut Device) {
        self.directory.insert(d.id.clone(), (d.account.curve25519_key(), d.account.ed25519_key()));
        d.account.generate_one_time_keys(10);
        self.one_time_keys.insert(d.id.clone(), d.account.one_time_keys().values().copied().collect());
        d.account.mark_keys_as_published();
    }

    pub fn substitute_keys(&mut self, id: &str, evil: &mut Device) {
        self.upload_keys(evil);
        let k = self.directory.remove(&evil.id).expect("evil keys");
        let otks = self.one_time_keys.remove(&evil.id).expect("evil otks");
        self.directory.insert(id.to_string(), k);
        self.one_time_keys.insert(id.to_string(), otks);
    }

    pub fn query(&self, id: &str) -> Option<(Curve25519PublicKey, Ed25519PublicKey)> {
        self.directory.get(id).copied()
    }

    pub fn claim(&mut self, id: &str) -> Option<Curve25519PublicKey> {
        self.one_time_keys.get_mut(id).and_then(|v| v.pop())
    }

    pub fn send_to_device(&mut self, from: &str, to: &str, sender_key: Curve25519PublicKey, m: OlmMessage) {
        self.seq += 1;
        let (msg_type, body) = m.to_parts();
        let held = self.withhold_from.iter().any(|w| w == to);
        self.to_device.entry(to.to_string()).or_default().push(ToDevice {
            seq: self.seq,
            from: from.to_string(),
            sender_key,
            msg_type,
            body,
            held,
        });
        self.pushes.push(format!("{{\"c\":\"fam1\",\"cursor\":{}}}", self.seq).into_bytes());
    }

    pub fn post_event(&mut self, sender: &str, session_id: String, m: &MegolmMessage) {
        self.seq += 1;
        self.timeline.push(Event { seq: self.seq, sender: sender.to_string(), session_id, body: m.to_bytes() });
        self.pushes.push(format!("{{\"c\":\"fam1\",\"cursor\":{}}}", self.seq).into_bytes());
    }

    pub fn take_to_device(&mut self, id: &str) -> Vec<ToDevice> {
        let withheld = self.withhold_from.iter().any(|w| w == id);
        let q = self.to_device.entry(id.to_string()).or_default();
        let (keep, out): (Vec<_>, Vec<_>) = q.drain(..).partition(|t| t.held && withheld);
        *q = keep;
        out
    }

    pub fn new_events(&mut self, id: &str) -> Vec<Event> {
        let c = self.cursors.entry(id.to_string()).or_insert(0);
        let out = self.timeline[*c..].to_vec();
        *c = self.timeline.len();
        out
    }

    pub fn everything_seen(&self) -> Vec<Vec<u8>> {
        let mut v: Vec<Vec<u8>> = self.timeline.iter().map(|e| e.body.clone()).collect();
        for q in self.to_device.values() {
            v.extend(q.iter().map(|t| t.body.clone()));
        }
        v.extend(self.pushes.iter().cloned());
        v
    }

    pub fn timeline_sizes(&self) -> Vec<usize> {
        self.timeline.iter().map(|e| e.body.len()).collect()
    }
}

pub struct Device {
    pub id: String,
    honest: bool,
    pub account: Account,
    olm: HashMap<String, Vec<Session>>,
    outbound: Option<GroupSession>,
    /// Devices the current outbound session was shared with.
    shared_with: HashSet<String>,
    inbound: HashMap<String, (String, InboundGroupSession)>,
    seen: HashSet<(String, u32)>,
    roster: Roster,
    pub detect_replays: bool,
    pub check_sender_in_roster: bool,
    pub last_errors: Vec<String>,
    pub undecryptable: Vec<Event>,
}

impl Device {
    pub fn new(id: &str, server: &mut Server) -> Device {
        let mut d = Device::make(id, true, server.roster.clone());
        server.roster.borrow_mut().insert(id.to_string(), (d.account.curve25519_key(), d.account.ed25519_key()));
        server.upload_keys(&mut d);
        server.room_devices.push(id.to_string());
        d
    }

    pub fn new_unlisted(id: &str) -> Device {
        Device::make(id, false, Roster::default())
    }

    fn make(id: &str, honest: bool, roster: Roster) -> Device {
        Device {
            id: id.to_string(),
            honest,
            account: Account::new(),
            olm: HashMap::new(),
            outbound: None,
            shared_with: HashSet::new(),
            inbound: HashMap::new(),
            seen: HashSet::new(),
            roster,
            detect_replays: true,
            check_sender_in_roster: true,
            last_errors: vec![],
            undecryptable: vec![],
        }
    }

    /// Recipients from the server's member list, or from the roster.
    fn recipients(&self, server: &Server, from_roster: bool) -> Vec<String> {
        let mut v: Vec<String> = if from_roster {
            self.roster.borrow().keys().cloned().collect()
        } else {
            server.room_devices.clone()
        };
        v.retain(|d| d != &self.id);
        v.sort();
        v
    }

    fn olm_session_to(&mut self, server: &mut Server, to: &str, check: bool) -> Result<(), String> {
        if self.olm.get(to).is_some_and(|s| !s.is_empty()) {
            return Ok(());
        }
        let (curve, ed) = server.query(to).ok_or(format!("no keys for {to}"))?;
        if check {
            match self.roster.borrow().get(to) {
                Some((c, e)) if *c == curve && *e == ed => {}
                Some(_) => return Err(format!("roster: {to} presents identity keys the household log does not list")),
                None => return Err(format!("roster: {to} is not in the household log")),
            }
        }
        let otk = server.claim(to).ok_or(format!("no one-time key for {to}"))?;
        let s = self.account.create_outbound_session(OlmConfig::version_1(), curve, otk).map_err(|e| e.to_string())?;
        self.olm.entry(to.to_string()).or_default().push(s);
        Ok(())
    }

    /// Create a fresh outbound Megolm session and share it.
    pub fn rotate(&mut self, server: &mut Server, from_roster: bool, check: bool) -> Result<(), String> {
        let gs = GroupSession::new(MegolmConfig::version_1());
        self.shared_with.clear();
        self.outbound = Some(gs);
        // Our own copy so we can read our own events after a restore.
        let own = self.outbound.as_ref().unwrap();
        self.inbound.insert(
            own.session_id(),
            (self.id.clone(), InboundGroupSession::new(&own.session_key(), MegolmConfig::version_1())),
        );
        self.share(server, from_roster, check)
    }

    /// Share the current outbound session with recipients that lack it.
    pub fn share(&mut self, server: &mut Server, from_roster: bool, check: bool) -> Result<(), String> {
        let key: SessionKey = self.outbound.as_ref().ok_or("no outbound session")?.session_key();
        let sid = self.outbound.as_ref().unwrap().session_id();
        for to in self.recipients(server, from_roster) {
            if self.shared_with.contains(&to) {
                continue;
            }
            self.olm_session_to(server, &to, check)?;
            let payload = format!("{{\"type\":\"m.room_key\",\"sender\":\"{}\",\"session_id\":\"{sid}\",\"session_key\":\"{}\"}}", self.id, key.to_base64());
            let s = self.olm.get_mut(&to).unwrap().last_mut().unwrap();
            let m = s.encrypt(payload).map_err(|e| e.to_string())?;
            server.send_to_device(&self.id, &to, self.account.curve25519_key(), m);
            self.shared_with.insert(to);
        }
        Ok(())
    }

    /// Matrix-SDK behaviour: rotate when a device that had the key is gone.
    pub fn send(&mut self, server: &mut Server, text: &str) -> Result<(), String> {
        self.send_with(server, text, true, true, true)
    }

    pub fn send_with(&mut self, server: &mut Server, text: &str, from_roster: bool, check: bool, rotate_on_removal: bool) -> Result<(), String> {
        let current: HashSet<String> = self.recipients(server, from_roster).into_iter().collect();
        let removed = self.shared_with.iter().any(|d| !current.contains(d));
        if self.outbound.is_none() || (rotate_on_removal && removed) {
            self.rotate(server, from_roster, check)?;
        } else {
            self.share(server, from_roster, check)?;
        }
        let gs = self.outbound.as_mut().unwrap();
        let m = gs.encrypt(text);
        let sid = gs.session_id();
        server.post_event(&self.id, sid, &m);
        Ok(())
    }

    pub fn sync(&mut self, server: &mut Server) -> Vec<String> {
        self.last_errors.clear();
        for t in server.take_to_device(&self.id) {
            if let Err(e) = self.receive_to_device(&t) {
                self.last_errors.push(e);
            }
        }
        let mut events = std::mem::take(&mut self.undecryptable);
        events.extend(server.new_events(&self.id));
        let mut texts = vec![];
        for e in events {
            if e.sender == self.id {
                continue;
            }
            match self.decrypt_event(&e) {
                Ok(t) => texts.push(t),
                Err(err) => {
                    if err.starts_with("unknown session") {
                        self.undecryptable.push(e);
                    }
                    self.last_errors.push(err);
                }
            }
        }
        texts
    }

    pub fn receive_to_device(&mut self, t: &ToDevice) -> Result<(), String> {
        if self.honest {
            let known = self.roster.borrow().get(&t.from).map(|(c, _)| *c);
            if known != Some(t.sender_key) {
                return Err(format!("roster: to-device from {} with an identity key the household log does not list", t.from));
            }
        }
        let m = OlmMessage::from_parts(t.msg_type, &t.body).map_err(|e| e.to_string())?;
        let mut plaintext = None;
        for s in self.olm.get_mut(&t.from).into_iter().flatten() {
            if let Ok(p) = s.decrypt(&m) {
                plaintext = Some(p);
                break;
            }
        }
        let plaintext = match (plaintext, &m) {
            (Some(p), _) => p,
            (None, OlmMessage::PreKey(pk)) => {
                let r = self
                    .account
                    .create_inbound_session(OlmConfig::version_1(), t.sender_key, pk)
                    .map_err(|e| e.to_string())?;
                self.olm.entry(t.from.clone()).or_default().push(r.session);
                r.plaintext
            }
            (None, _) => return Err(format!("olm: cannot decrypt to-device from {}", t.from)),
        };
        let s = String::from_utf8_lossy(&plaintext).to_string();
        let field = |name: &str| -> String {
            let k = format!("\"{name}\":\"");
            let i = s.find(&k).expect("field") + k.len();
            s[i..].split('"').next().unwrap().to_string()
        };
        let key = SessionKey::from_base64(&field("session_key")).map_err(|e| e.to_string())?;
        let ig = InboundGroupSession::new(&key, MegolmConfig::version_1());
        // The room key is bound to the Olm sender, as in matrix-sdk-crypto.
        self.inbound.insert(field("session_id"), (t.from.clone(), ig));
        Ok(())
    }

    pub fn decrypt_event(&mut self, e: &Event) -> Result<String, String> {
        let (owner, ig) = self.inbound.get_mut(&e.session_id).ok_or(format!("unknown session {}", &e.session_id[..8]))?;
        if owner != &e.sender {
            return Err(format!("session belongs to {owner}, event claims {}", e.sender));
        }
        if self.check_sender_in_roster && !self.roster.borrow().contains_key(owner.as_str()) {
            return Err(format!("roster: sender {owner} is no longer in the household log"));
        }
        let m = MegolmMessage::from_bytes(&e.body).map_err(|e| e.to_string())?;
        let d = ig.decrypt(&m).map_err(|e| e.to_string())?;
        if self.detect_replays && !self.seen.insert((e.session_id.clone(), d.message_index)) {
            return Err(format!("replay: index {} of session {} seen before", d.message_index, &e.session_id[..8]));
        }
        Ok(String::from_utf8_lossy(&d.plaintext).to_string())
    }

    pub fn export_history_for(&mut self, session_id: &str) -> Option<vodozemac::megolm::ExportedSessionKey> {
        self.inbound.get_mut(session_id).map(|(_, ig)| ig.export_at_first_known_index())
    }

    pub fn import_history(&mut self, sender: &str, session_id: &str, k: &vodozemac::megolm::ExportedSessionKey) {
        self.inbound.insert(
            session_id.to_string(),
            (sender.to_string(), InboundGroupSession::import(k, MegolmConfig::version_1())),
        );
    }

    pub fn outbound_session_id(&self) -> Option<String> {
        self.outbound.as_ref().map(|g| g.session_id())
    }

    /// Encrypted pickles of the account, Olm sessions and outbound session.
    pub fn pickle(&self) -> Pickled {
        Pickled {
            account: self.account.pickle().encrypt(&PICKLE_KEY),
            olm: self
                .olm
                .iter()
                .map(|(k, v)| (k.clone(), v.iter().map(|s| s.pickle().encrypt(&PICKLE_KEY)).collect()))
                .collect(),
            outbound: self.outbound.as_ref().map(|g| g.pickle().encrypt(&PICKLE_KEY)),
            shared_with: self.shared_with.clone(),
            inbound: self
                .inbound
                .iter()
                .map(|(k, (o, ig))| (k.clone(), (o.clone(), ig.pickle().encrypt(&PICKLE_KEY))))
                .collect(),
        }
    }

    pub fn unpickle(id: &str, roster: Roster, p: &Pickled) -> Result<Device, String> {
        let mut d = Device::make(id, true, roster);
        d.account = Account::from_pickle(AccountPickle::from_encrypted(&p.account, &PICKLE_KEY).map_err(|e| e.to_string())?);
        for (k, v) in &p.olm {
            for s in v {
                d.olm
                    .entry(k.clone())
                    .or_default()
                    .push(Session::from_pickle(SessionPickle::from_encrypted(s, &PICKLE_KEY).map_err(|e| e.to_string())?));
            }
        }
        if let Some(o) = &p.outbound {
            d.outbound = Some(GroupSession::from_pickle(
                vodozemac::megolm::GroupSessionPickle::from_encrypted(o, &PICKLE_KEY).map_err(|e| e.to_string())?,
            ));
        }
        d.shared_with = p.shared_with.clone();
        for (k, (o, s)) in &p.inbound {
            let ig = InboundGroupSession::from_pickle(
                vodozemac::megolm::InboundGroupSessionPickle::from_encrypted(s, &PICKLE_KEY).map_err(|e| e.to_string())?,
            );
            d.inbound.insert(k.clone(), (o.clone(), ig));
        }
        Ok(d)
    }
}

#[derive(Clone)]
pub struct Pickled {
    pub account: String,
    pub olm: HashMap<String, Vec<String>>,
    pub outbound: Option<String>,
    pub shared_with: HashSet<String>,
    pub inbound: HashMap<String, (String, String)>,
}

impl Pickled {
    pub fn total_len(&self) -> usize {
        self.account.len()
            + self.olm.values().flatten().map(String::len).sum::<usize>()
            + self.outbound.as_ref().map_or(0, String::len)
            + self.inbound.values().map(|(_, s)| s.len()).sum::<usize>()
    }
}
