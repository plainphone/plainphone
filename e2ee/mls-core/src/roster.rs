//! The household roster and the binding of MLS leaf keys to it.
//!
//! In the full design the roster is the verified household log
//! (docs/encryption.md §3). Each `device.add`/`phone.add` would carry an
//! `mlsSignPub`, and the device's existing log key signs
//! `D("mls-leaf", {deviceId, mlsSignPub})`. The prototype does not have the
//! log yet, so the app passes the entries it trusts to `set_roster`, and the
//! core verifies every binding signature before any entry is used. Every key
//! package, Welcome member, commit and sender is then checked against it.

use std::collections::BTreeMap;

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::b64;
use crate::error::Error;

/// The domain label for the binding statement, `D(p, x)` in docs/encryption.md §2.
pub const BINDING_LABEL: &str = "mls-leaf";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// A parent device. May add and remove members.
    Admin,
    /// The child phone. Reads and writes, never adds or removes anyone.
    Child,
}

/// One roster entry as the app hands it over (all byte fields base64url).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryIn {
    pub device_id: String,
    pub role: Role,
    /// The device's household-log Ed25519 key (`signPub`), trusted input.
    pub log_sign_pub: String,
    /// The device's MLS leaf signature key, bound by `binding`.
    pub mls_sign_pub: String,
    /// Ed25519 signature by `log_sign_pub` over `binding_input(device_id, mls_sign_pub)`.
    pub binding: String,
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub role: Role,
    pub mls_sign_pub: Vec<u8>,
    pub source: EntryIn,
}

/// Device IDs are UUIDs or similar opaque tokens. Restricting the alphabet keeps
/// the JCS encoding below exact without a JSON escaper.
pub fn valid_device_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `UTF8(JCS(["plainphone",1,"mls-leaf",{"deviceId":…,"mlsSignPub":…}]))`.
/// Keys are already in JCS order and both values need no escaping.
pub fn binding_input(device_id: &str, mls_sign_pub: &[u8]) -> Result<Vec<u8>, Error> {
    if !valid_device_id(device_id) {
        return Err(Error::new("bad_request", "device id must be 1-64 characters of [a-z0-9-]"));
    }
    if mls_sign_pub.len() != 32 {
        return Err(Error::new("bad_request", "MLS signature key must be a 32-byte Ed25519 key"));
    }
    Ok(format!(
        "[\"plainphone\",1,\"{BINDING_LABEL}\",{{\"deviceId\":\"{device_id}\",\"mlsSignPub\":\"{}\"}}]",
        b64::encode(mls_sign_pub)
    )
    .into_bytes())
}

/// Verify one entry. Uses `verify_strict` (canonical points, no small-order
/// keys or R, S below the group order), as §2 requires.
pub fn verify_entry(e: &EntryIn) -> Result<Entry, Error> {
    let log_key: [u8; 32] =
        b64::decode(&e.log_sign_pub)?.try_into().map_err(|_| Error::new("binding_invalid", "log key must be 32 bytes"))?;
    let mls_key = b64::decode(&e.mls_sign_pub)?;
    let sig: [u8; 64] =
        b64::decode(&e.binding)?.try_into().map_err(|_| Error::new("binding_invalid", "binding signature must be 64 bytes"))?;
    let input = binding_input(&e.device_id, &mls_key)?;
    let vk = VerifyingKey::from_bytes(&log_key).map_err(|_| Error::new("binding_invalid", "log key is not a valid point"))?;
    if vk.is_weak() {
        return Err(Error::new("binding_invalid", "log key has small order"));
    }
    vk.verify_strict(&input, &Signature::from_bytes(&sig))
        .map_err(|_| Error::new("binding_invalid", format!("binding signature for {} does not verify", e.device_id)))?;
    Ok(Entry { role: e.role, mls_sign_pub: mls_key, source: e.clone() })
}

#[derive(Default, Clone)]
pub struct Roster {
    pub version: u64,
    entries: BTreeMap<String, Entry>,
}

impl Roster {
    /// All-or-nothing: one bad entry rejects the whole roster.
    pub fn from_entries(version: u64, entries: &[EntryIn]) -> Result<Roster, Error> {
        let mut map = BTreeMap::new();
        for e in entries {
            let v = verify_entry(e)?;
            if map.insert(e.device_id.clone(), v).is_some() {
                return Err(Error::new("bad_request", format!("device {} listed twice", e.device_id)));
            }
        }
        Ok(Roster { version, entries: map })
    }

    pub fn get(&self, device_id: &str) -> Option<&Entry> {
        self.entries.get(device_id)
    }

    pub fn sources(&self) -> Vec<EntryIn> {
        self.entries.values().map(|e| e.source.clone()).collect()
    }

    /// The binding check for a leaf: its credential (the device ID) must be in
    /// the roster with exactly this signature key.
    pub fn check_leaf(&self, identity: &[u8], sig_key: &[u8]) -> Result<(String, Role), Error> {
        let id = std::str::from_utf8(identity)
            .ok()
            .filter(|s| valid_device_id(s))
            .ok_or_else(|| Error::new("roster_unknown_device", "credential is not a device id"))?;
        match self.entries.get(id) {
            Some(e) if e.mls_sign_pub == sig_key => Ok((id.to_string(), e.role)),
            Some(_) => Err(Error::new("roster_key_mismatch", format!("{id} presents a key the roster does not list"))),
            None => Err(Error::new("roster_unknown_device", format!("{id} is not in the roster"))),
        }
    }
}
