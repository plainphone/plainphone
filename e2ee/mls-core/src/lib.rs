//! Plainphone E2EE phase 0: an OpenMLS core behind one JSON entry point.
//!
//! PROTOTYPE, test data only (issue #120). Nothing in a release build links
//! this crate. See docs/e2ee-prototype.md for the threat model and the gaps.

pub mod api;
pub mod b64;
pub mod client;
pub mod error;
pub mod roster;

#[cfg(feature = "jni")]
mod jni;

pub use api::call;

/// Helpers for synthetic identities (tests, selftest, demo). A real device
/// signs the binding with its household-log key, which never leaves it.
pub mod testkit {
    use ed25519_dalek::{Signer, SigningKey};

    use crate::b64;
    use crate::error::Error;
    use crate::roster::{binding_input, EntryIn, Role};

    /// A synthetic household-log key from a fixed seed. Never use outside tests.
    pub fn log_key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    pub fn entry(device_id: &str, role: Role, log: &SigningKey, mls_sign_pub: &[u8]) -> Result<EntryIn, Error> {
        let sig = log.sign(&binding_input(device_id, mls_sign_pub)?);
        Ok(EntryIn {
            device_id: device_id.to_string(),
            role,
            log_sign_pub: b64::encode(log.verifying_key().as_bytes()),
            mls_sign_pub: b64::encode(mls_sign_pub),
            binding: b64::encode(&sig.to_bytes()),
        })
    }
}

/// Two synthetic devices: create, add, read, answer, all in memory. The Android
/// debug build and the host JVM test call it to prove the whole path is linked.
pub fn selftest() -> Result<(), error::Error> {
    use roster::Role;
    let fail = |d: &str| error::Error::new("selftest", d.to_string());
    let mut parent = client::Client::new("selftest-parent")?;
    let mut child = client::Client::new("selftest-child")?;
    let roster = vec![
        testkit::entry("selftest-parent", Role::Admin, &testkit::log_key(1), &parent.mls_sign_pub())?,
        testkit::entry("selftest-child", Role::Child, &testkit::log_key(2), &child.mls_sign_pub())?,
    ];
    parent.set_roster(1, &roster)?;
    child.set_roster(1, &roster)?;
    let (kps, _) = child.key_packages(1, false)?;
    let (gid, _, _) = parent.create_group()?;
    let p = parent.add_members(&gid, &kps)?;
    parent.merge_pending(&gid)?;
    child.process(p.welcome.as_deref().ok_or_else(|| fail("no welcome"))?)?;
    let (m, _) = parent.encrypt(&gid, "selftest-1", "SYNTH selftest")?;
    match child.process(&m)? {
        client::Event::Text { text, .. } if text == "SYNTH selftest" => {}
        _ => return Err(fail("child did not read the text")),
    }
    let (m, _) = child.encrypt(&gid, "selftest-2", "SYNTH answer")?;
    match parent.process(&m)? {
        client::Event::Text { text, .. } if text == "SYNTH answer" => Ok(()),
        _ => Err(fail("parent did not read the answer")),
    }
}
