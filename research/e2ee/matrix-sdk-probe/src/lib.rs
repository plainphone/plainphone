//! matrix-sdk-crypto probe for Plainphone issue #120.
//!
//! The vodozemac harness models how Matrix uses Olm and Megolm. This probe
//! drives the real SDK state machine (`OlmMachine` 0.19.1, in-memory store)
//! through its public API against an in-process fake homeserver, to measure
//! the SDK's own defaults: key-sharing strategy, rotation on device removal,
//! "unable to decrypt" before the key arrives, and duplicate events. Matrix
//! users and devices are synthetic; nothing touches the network.

use std::collections::BTreeMap;

/// The SDK uses Tokio timers outside wasm, so it needs a Tokio runtime.
#[cfg(not(target_family = "wasm"))]
fn block_on<F: std::future::Future>(f: F) -> F::Output {
    static RT: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RT.get_or_init(|| tokio::runtime::Builder::new_current_thread().enable_time().build().expect("runtime"))
        .block_on(f)
}

/// The wasm build is only measured for size, never run.
#[cfg(target_family = "wasm")]
fn block_on<F: std::future::Future>(f: F) -> F::Output {
    futures_executor::block_on(f)
}

use matrix_sdk_crypto::types::events::room::encrypted::EncryptedEvent;
use matrix_sdk_crypto::types::requests::AnyOutgoingRequest;
use matrix_sdk_crypto::{
    CollectStrategy, DecryptionSettings, EncryptionSettings, EncryptionSyncChanges, LocalTrust, OlmMachine,
    TrustRequirement,
};
use ruma::api::client::keys::{claim_keys, get_keys, upload_keys};
use ruma::api::client::sync::sync_events::DeviceLists;
use ruma::api::client::to_device::send_event_to_device;
use ruma::encryption::{DeviceKeys, OneTimeKey};
use ruma::events::AnyToDeviceEvent;
use ruma::serde::Raw;
use ruma::{OwnedDeviceId, OwnedOneTimeKeyId, OwnedRoomId, OwnedUserId, RoomId, UserId};
use serde_json::{json, Value};

pub const ROOM: &str = "!family:family.invalid";

pub fn user(name: &str) -> OwnedUserId {
    UserId::parse(format!("@{name}:family.invalid")).expect("user id")
}

fn room() -> OwnedRoomId {
    RoomId::parse(ROOM).expect("room id")
}

fn settings() -> DecryptionSettings {
    DecryptionSettings { sender_device_trust_requirement: TrustRequirement::Untrusted }
}

#[derive(Default)]
pub struct Homeserver {
    device_keys: BTreeMap<OwnedUserId, BTreeMap<OwnedDeviceId, Raw<DeviceKeys>>>,
    otks: BTreeMap<(OwnedUserId, OwnedDeviceId), BTreeMap<OwnedOneTimeKeyId, Raw<OneTimeKey>>>,
    to_device: BTreeMap<(OwnedUserId, OwnedDeviceId), Vec<Raw<AnyToDeviceEvent>>>,
    pub timeline: Vec<String>,
    /// Users whose device list changed, per receiving device.
    changed: BTreeMap<(OwnedUserId, OwnedDeviceId), Vec<OwnedUserId>>,
    pub seen: Vec<String>,
}

pub struct Client {
    pub machine: OlmMachine,
    pub user: OwnedUserId,
    pub device: OwnedDeviceId,
}

impl Homeserver {
    /// Answer every outgoing request the machine has, like a real server.
    pub fn pump(&mut self, c: &Client) {
        for _ in 0..5 {
            let reqs = block_on(c.machine.outgoing_requests()).expect("requests");
            if reqs.is_empty() {
                return;
            }
            for r in reqs {
                let id = r.request_id().to_owned();
                match r.request() {
                    AnyOutgoingRequest::KeysUpload(u) => {
                        if let Some(dk) = &u.device_keys {
                            self.seen.push(dk.json().get().to_string());
                            self.device_keys.entry(c.user.clone()).or_default().insert(c.device.clone(), dk.clone());
                        }
                        let slot = self.otks.entry((c.user.clone(), c.device.clone())).or_default();
                        slot.extend(u.one_time_keys.clone());
                        slot.extend(u.fallback_keys.clone());
                        let mut counts = BTreeMap::new();
                        counts.insert(ruma::OneTimeKeyAlgorithm::SignedCurve25519, (slot.len() as u32).into());
                        let resp = upload_keys::v3::Response::new(counts);
                        block_on(c.machine.mark_request_as_sent(&id, &resp)).expect("upload");
                    }
                    AnyOutgoingRequest::KeysQuery(q) => {
                        let mut resp = get_keys::v3::Response::new();
                        for u in q.device_keys.keys() {
                            if let Some(d) = self.device_keys.get(u) {
                                resp.device_keys.insert(u.clone(), d.clone());
                            }
                        }
                        block_on(c.machine.mark_request_as_sent(&id, &resp)).expect("query");
                    }
                    AnyOutgoingRequest::KeysClaim(q) => {
                        let resp = self.claim(&q.one_time_keys);
                        block_on(c.machine.mark_request_as_sent(&id, &resp)).expect("claim");
                    }
                    AnyOutgoingRequest::ToDeviceRequest(t) => {
                        self.deliver(&c.user, t);
                        let resp = send_event_to_device::v3::Response::new();
                        block_on(c.machine.mark_request_as_sent(&id, &resp)).expect("to-device");
                    }
                    _ => {}
                }
            }
        }
    }

    fn claim(
        &mut self,
        want: &BTreeMap<OwnedUserId, BTreeMap<OwnedDeviceId, ruma::OneTimeKeyAlgorithm>>,
    ) -> claim_keys::v3::Response {
        let mut out: BTreeMap<OwnedUserId, BTreeMap<OwnedDeviceId, BTreeMap<OwnedOneTimeKeyId, Raw<OneTimeKey>>>> =
            BTreeMap::new();
        for (u, devs) in want {
            for d in devs.keys() {
                if let Some(slot) = self.otks.get_mut(&(u.clone(), d.clone())) {
                    if let Some(k) = slot.keys().next().cloned() {
                        let v = slot.remove(&k).unwrap();
                        out.entry(u.clone()).or_default().entry(d.clone()).or_default().insert(k, v);
                    }
                }
            }
        }
        claim_keys::v3::Response::new(out)
    }

    fn deliver(&mut self, sender: &UserId, t: &matrix_sdk_crypto::types::requests::ToDeviceRequest) {
        for (u, devs) in &t.messages {
            for (d, content) in devs {
                let d: OwnedDeviceId = match d {
                    ruma::to_device::DeviceIdOrAllDevices::DeviceId(d) => d.clone(),
                    _ => continue,
                };
                self.seen.push(content.json().get().to_string());
                let ev = json!({"sender": sender, "type": t.event_type.to_string(), "content": serde_json::from_str::<Value>(content.json().get()).unwrap()});
                self.to_device
                    .entry((u.clone(), d))
                    .or_default()
                    .push(Raw::from_json_string(ev.to_string()).expect("raw"));
            }
        }
    }

    pub fn new_client(&mut self, name: &str, device: &str) -> Client {
        let u = user(name);
        let d: OwnedDeviceId = device.into();
        let machine = block_on(OlmMachine::new(&u, &d));
        let c = Client { machine, user: u, device: d };
        self.pump(&c);
        // Everyone who shares the room learns about the new device.
        for k in self.device_keys.iter().flat_map(|(u2, ds)| ds.keys().map(move |d2| (u2.clone(), d2.clone()))) {
            self.changed.entry(k).or_default().push(c.user.clone());
        }
        c
    }

    /// The server forgets a device (logout / admin delete) and tells the rest.
    pub fn delete_device(&mut self, u: &UserId, d: &str) {
        if let Some(m) = self.device_keys.get_mut(u) {
            m.remove(<&ruma::DeviceId>::from(d));
        }
        for k in self.device_keys.iter().flat_map(|(u2, ds)| ds.keys().map(move |d2| (u2.clone(), d2.clone()))) {
            self.changed.entry(k).or_default().push(u.to_owned());
        }
    }

    /// Insert device keys the server chose (forged device for a user).
    pub fn inject_device(&mut self, victim: &UserId, attacker: &Client) {
        let dk = self.device_keys.get(&attacker.user).and_then(|m| m.get(&attacker.device)).cloned().expect("keys");
        self.device_keys.entry(victim.to_owned()).or_default().insert(attacker.device.clone(), dk);
        for k in self.device_keys.iter().flat_map(|(u2, ds)| ds.keys().map(move |d2| (u2.clone(), d2.clone()))) {
            self.changed.entry(k).or_default().push(victim.to_owned());
        }
    }

    pub fn sync(&mut self, c: &Client) {
        let evs = self.to_device.remove(&(c.user.clone(), c.device.clone())).unwrap_or_default();
        let changed = self.changed.remove(&(c.user.clone(), c.device.clone())).unwrap_or_default();
        let mut lists = DeviceLists::new();
        lists.changed = changed;
        let counts = BTreeMap::new();
        let changes = EncryptionSyncChanges {
            to_device_events: evs,
            changed_devices: &lists,
            one_time_keys_counts: &counts,
            unused_fallback_keys: None,
            next_batch_token: None,
        };
        block_on(c.machine.receive_sync_changes(changes, &settings())).expect("sync");
        self.pump(c);
    }

    pub fn send(&mut self, c: &Client, members: &[OwnedUserId], text: &str, strategy: CollectStrategy) -> String {
        self.sync(c);
        block_on(c.machine.update_tracked_users(members.iter().map(|u| u.as_ref()))).expect("track");
        self.pump(c);
        if let Some((id, req)) = block_on(c.machine.get_missing_sessions(members.iter().map(|u| u.as_ref()))).expect("missing") {
            let resp = self.claim(&req.one_time_keys);
            block_on(c.machine.mark_request_as_sent(&id, &resp)).expect("claim");
        }
        let mut es = EncryptionSettings::default();
        es.sharing_strategy = strategy;
        let reqs = block_on(c.machine.share_room_key(&room(), members.iter().map(|u| u.as_ref()), es)).expect("share");
        for r in reqs {
            self.deliver(&c.user, &r);
            block_on(c.machine.mark_request_as_sent(&r.txn_id, &send_event_to_device::v3::Response::new())).expect("sent");
        }
        let content: Raw<ruma::events::AnyMessageLikeEventContent> =
            Raw::from_json_string(json!({"msgtype": "m.text", "body": text}).to_string()).unwrap();
        let enc = block_on(c.machine.encrypt_room_event_raw(&room(), "m.room.message", &content)).expect("encrypt");
        let n = self.timeline.len() + 1;
        let ev = json!({
            "type": "m.room.encrypted", "sender": c.user, "event_id": format!("$ev{n}"),
            "origin_server_ts": 1_000_000 + n as u64, "room_id": ROOM,
            "content": serde_json::from_str::<Value>(enc.content.json().get()).unwrap(),
        })
        .to_string();
        self.seen.push(ev.clone());
        self.timeline.push(ev.clone());
        ev
    }

    pub fn decrypt(&self, c: &Client, ev: &str) -> Result<String, String> {
        let raw: Raw<EncryptedEvent> = Raw::from_json_string(ev.to_string()).map_err(|e| e.to_string())?;
        let d = block_on(c.machine.decrypt_room_event(&raw, &room(), &settings())).map_err(|e| format!("{e}"))?;
        let v: Value = serde_json::from_str(d.event.json().get()).map_err(|e| e.to_string())?;
        Ok(v["content"]["body"].as_str().unwrap_or_default().to_string())
    }
}

pub fn session_id(ev: &str) -> String {
    let v: Value = serde_json::from_str(ev).unwrap();
    v["content"]["session_id"].as_str().unwrap_or_default().to_string()
}

pub fn trust(c: &Client, u: &UserId, d: &str) {
    let dev = block_on(c.machine.get_device(u, <&ruma::DeviceId>::from(d), None)).expect("get").expect("device");
    block_on(dev.set_local_trust(LocalTrust::Verified)).expect("trust");
}

/// Two-device roundtrip, exported over the C ABI so the Android size build
/// keeps the whole SDK path.
pub fn selftest() -> Result<(), String> {
    let mut hs = Homeserver::default();
    let a = hs.new_client("parent-a", "PAPHONE");
    let c = hs.new_client("child", "CHILDPHONE");
    let members = [a.user.clone(), c.user.clone()];
    let ev = hs.send(&a, &members, "SYNTH-CANARY hello", CollectStrategy::AllDevices);
    hs.sync(&c);
    let t = hs.decrypt(&c, &ev)?;
    if t != "SYNTH-CANARY hello" {
        return Err(format!("wrong text {t}"));
    }
    Ok(())
}

#[no_mangle]
pub extern "C" fn plainphone_matrix_sdk_selftest() -> i32 {
    match selftest() {
        Ok(()) => 0,
        Err(_) => 1,
    }
}
