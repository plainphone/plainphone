//! Scenarios through the JSON API (`plainphone_mls::call`), the same surface the
//! Android binding and the demo use. All identities and texts are synthetic.

use plainphone_mls::roster::Role;
use plainphone_mls::testkit;
use serde_json::{json, Value};

const CANARY: &str = "SYNTH-CANARY 4417";

fn call(req: Value) -> Value {
    serde_json::from_slice(&plainphone_mls::call(req.to_string().as_bytes())).expect("json")
}

fn ok(req: Value) -> Value {
    let r = call(req.clone());
    assert_eq!(r["ok"], true, "{} -> {r}", req["op"]);
    r
}

fn err(req: Value) -> String {
    let r = call(req);
    assert_eq!(r["ok"], false, "expected an error, got {r}");
    assert!(!r.to_string().contains(CANARY), "an error leaked the plaintext: {r}");
    r["error"].as_str().unwrap().to_string()
}

struct Dev {
    id: &'static str,
    h: u64,
    pk: Vec<u8>,
    role: Role,
    seed: u8,
}

impl Dev {
    fn new(id: &'static str, role: Role, seed: u8) -> Dev {
        let r = ok(json!({"op": "new_client", "deviceId": id}));
        let pk = plainphone_mls::b64::decode(r["mlsSignPub"].as_str().unwrap()).unwrap();
        Dev { id, h: r["handle"].as_u64().unwrap(), pk, role, seed }
    }
    fn entry(&self) -> Value {
        serde_json::to_value(testkit::entry(self.id, self.role, &testkit::log_key(self.seed), &self.pk).unwrap()).unwrap()
    }
    fn kp(&self) -> String {
        ok(json!({"op": "key_packages", "handle": self.h, "count": 1}))["keyPackages"][0].as_str().unwrap().to_string()
    }
    fn roster(&self, version: u64, devs: &[&Dev]) {
        let entries: Vec<Value> = devs.iter().map(|d| d.entry()).collect();
        ok(json!({"op": "set_roster", "handle": self.h, "version": version, "roster": entries}));
    }
    fn send(&self, gid: &str, mid: &str, text: &str) -> String {
        ok(json!({"op": "encrypt", "handle": self.h, "groupId": gid, "messageId": mid, "text": text}))["message"]
            .as_str()
            .unwrap()
            .to_string()
    }
    fn process(&self, m: &str) -> Value {
        ok(json!({"op": "process", "handle": self.h, "message": m}))
    }
    fn try_process(&self, m: &str) -> Value {
        call(json!({"op": "process", "handle": self.h, "message": m}))
    }
    fn merge(&self, gid: &str) -> Value {
        ok(json!({"op": "merge_pending", "handle": self.h, "groupId": gid}))
    }
}

/// Parent A, parent B and the child, everyone on everyone's roster, in one conversation.
fn household() -> (Dev, Dev, Dev, String) {
    let a = Dev::new("parent-a-phone", Role::Admin, 1);
    let b = Dev::new("parent-b-phone", Role::Admin, 2);
    let c = Dev::new("child-phone", Role::Child, 3);
    for d in [&a, &b, &c] {
        d.roster(1, &[&a, &b, &c]);
    }
    let gid = ok(json!({"op": "create_group", "handle": a.h}))["groupId"].as_str().unwrap().to_string();
    let p = ok(json!({"op": "add_members", "handle": a.h, "groupId": gid, "keyPackages": [b.kp(), c.kp()]}));
    assert_eq!(p["epoch"], 0);
    a.merge(&gid);
    let w = p["welcome"].as_str().unwrap();
    assert_eq!(b.process(w)["kind"], "joined");
    let joined = c.process(w);
    assert_eq!(joined["by"], "parent-a-phone");
    assert_eq!(joined["members"].as_array().unwrap().len(), 3);
    (a, b, c, gid)
}

#[test]
fn everyone_reads_everyone() {
    let (a, b, c, gid) = household();
    let m = a.send(&gid, "m-1", "SYNTH hello");
    for d in [&b, &c] {
        let e = d.process(&m);
        assert_eq!(
            (e["kind"].as_str(), e["sender"].as_str(), e["text"].as_str()),
            (Some("text"), Some("parent-a-phone"), Some("SYNTH hello"))
        );
    }
    let m = c.send(&gid, "m-2", "SYNTH from the child");
    assert_eq!(a.process(&m)["text"], "SYNTH from the child");
    assert_eq!(b.process(&m)["messageId"], "m-2");
}

#[test]
fn substituted_key_package_is_refused() {
    let (a, _b, _c, gid) = household();
    // The server hands out a key package it made itself under the child's ID.
    let evil = Dev::new("child-phone", Role::Child, 9);
    let e = err(json!({"op": "add_members", "handle": a.h, "groupId": gid, "keyPackages": [evil.kp()]}));
    assert_eq!(e, "roster_key_mismatch");
    // A device the roster never listed.
    let stranger = Dev::new("server-tablet", Role::Admin, 10);
    let e = err(json!({"op": "add_members", "handle": a.h, "groupId": gid, "keyPackages": [stranger.kp()]}));
    assert_eq!(e, "roster_unknown_device");
}

#[test]
fn forged_binding_and_roster_rollback_are_refused() {
    let a = Dev::new("parent-a-phone", Role::Admin, 1);
    let c = Dev::new("child-phone", Role::Child, 3);
    let mut forged = c.entry();
    forged["mlsSignPub"] = json!(plainphone_mls::b64::encode(&a.pk));
    let e = err(json!({"op": "set_roster", "handle": a.h, "version": 1, "roster": [a.entry(), forged]}));
    assert_eq!(e, "binding_invalid");
    a.roster(2, &[&a, &c]);
    let e = err(json!({"op": "set_roster", "handle": a.h, "version": 1, "roster": [a.entry(), c.entry()]}));
    assert_eq!(e, "roster_stale");
}

#[test]
fn joiner_refuses_a_welcome_with_an_unlisted_member() {
    // Parent A's roster was tampered with to include a server device; the child's was not.
    let a = Dev::new("parent-a-phone", Role::Admin, 1);
    let c = Dev::new("child-phone", Role::Child, 3);
    let evil = Dev::new("server-tablet", Role::Admin, 10);
    a.roster(1, &[&a, &c, &evil]);
    c.roster(1, &[&a, &c]);
    evil.roster(1, &[&a, &c, &evil]);
    let gid = ok(json!({"op": "create_group", "handle": a.h}))["groupId"].as_str().unwrap().to_string();
    let p = ok(json!({"op": "add_members", "handle": a.h, "groupId": gid, "keyPackages": [c.kp(), evil.kp()]}));
    a.merge(&gid);
    let r = c.try_process(p["welcome"].as_str().unwrap());
    assert_eq!(r["error"], "roster_unknown_device");
}

#[test]
fn add_then_remove_a_member() {
    let (a, b, c, gid) = household();
    let t = Dev::new("parent-a-tablet", Role::Admin, 4);
    for d in [&a, &b, &c, &t] {
        d.roster(2, &[&a, &b, &c, &t]);
    }
    let p = ok(json!({"op": "add_members", "handle": a.h, "groupId": gid, "keyPackages": [t.kp()]}));
    assert_eq!(p["added"], json!(["parent-a-tablet"]));
    a.merge(&gid);
    for d in [&b, &c] {
        let e = d.process(p["commit"].as_str().unwrap());
        assert_eq!((e["kind"].as_str(), e["epoch"].as_u64()), (Some("commit"), Some(2)));
    }
    t.process(p["welcome"].as_str().unwrap());
    let m = c.send(&gid, "m-3", "SYNTH with the tablet");
    assert_eq!(t.process(&m)["text"], "SYNTH with the tablet");

    // The log removes the tablet. Until the MLS removal lands, nobody sends.
    for d in [&a, &b, &c] {
        d.roster(3, &[&a, &b, &c]);
    }
    let e = err(json!({"op": "encrypt", "handle": c.h, "groupId": gid, "messageId": "m-4", "text": CANARY}));
    assert_eq!(e, "stale_members");
    let members = ok(json!({"op": "members", "handle": c.h, "groupId": gid}));
    assert_eq!(members["notInRoster"], json!(["parent-a-tablet"]));
    // The child may not remove anyone itself.
    let e = err(json!({"op": "remove_members", "handle": c.h, "groupId": gid, "deviceIds": ["parent-a-tablet"]}));
    assert_eq!(e, "not_admin");

    let p = ok(json!({"op": "remove_members", "handle": b.h, "groupId": gid, "deviceIds": ["parent-a-tablet"]}));
    b.merge(&gid);
    for d in [&a, &c] {
        assert_eq!(d.process(p["commit"].as_str().unwrap())["removed"], json!(["parent-a-tablet"]));
    }
    let gone = t.process(p["commit"].as_str().unwrap());
    assert_eq!(gone["kind"], "removed");
    // The tablet's state for the conversation is gone, and it reads nothing new.
    let m = c.send(&gid, "m-5", CANARY);
    assert_eq!(a.process(&m)["text"], CANARY);
    let r = t.try_process(&m);
    assert_eq!(r["error"], "group_unknown");
    assert!(!r.to_string().contains(CANARY));
}

#[test]
fn key_rotation_by_the_child_and_forward_secrecy_across_epochs() {
    let (a, b, c, gid) = household();
    let old = a.send(&gid, "m-6", "SYNTH before rotation");
    let p = ok(json!({"op": "update", "handle": c.h, "groupId": gid}));
    assert_eq!(p["added"], json!([]));
    c.merge(&gid);
    for d in [&a, &b] {
        assert_eq!(d.process(p["commit"].as_str().unwrap())["epoch"], 2);
    }
    // max_past_epochs = 0: a text from the previous epoch that arrives late is refused.
    let r = b.try_process(&old);
    assert_eq!(r["ok"], false);
    let m = a.send(&gid, "m-7", "SYNTH after rotation");
    assert_eq!(c.process(&m)["epoch"], 2);
}

#[test]
fn receivers_refuse_an_add_by_the_child() {
    // The child's own roster wrongly calls it an admin, so its core lets it commit.
    let a = Dev::new("parent-a-phone", Role::Admin, 1);
    let c = Dev::new("child-phone", Role::Child, 3);
    let t = Dev::new("parent-a-tablet", Role::Admin, 4);
    a.roster(1, &[&a, &c, &t]);
    t.roster(1, &[&a, &c, &t]);
    let inflated = serde_json::to_value(testkit::entry(c.id, Role::Admin, &testkit::log_key(3), &c.pk).unwrap()).unwrap();
    ok(json!({"op": "set_roster", "handle": c.h, "version": 1, "roster": [a.entry(), inflated, t.entry()]}));
    let gid = ok(json!({"op": "create_group", "handle": a.h}))["groupId"].as_str().unwrap().to_string();
    let p = ok(json!({"op": "add_members", "handle": a.h, "groupId": gid, "keyPackages": [c.kp()]}));
    a.merge(&gid);
    c.process(p["welcome"].as_str().unwrap());
    let p = ok(json!({"op": "add_members", "handle": c.h, "groupId": gid, "keyPackages": [t.kp()]}));
    assert_eq!(a.try_process(p["commit"].as_str().unwrap())["error"], "not_admin");
    assert_eq!(t.try_process(p["welcome"].as_str().unwrap())["error"], "not_admin");
}

#[test]
fn concurrent_commits_resolve_to_one() {
    let (a, b, c, gid) = household();
    let pa = ok(json!({"op": "update", "handle": a.h, "groupId": gid}));
    let pb = ok(json!({"op": "update", "handle": b.h, "groupId": gid}));
    assert_eq!(pa["epoch"], pb["epoch"]);
    // The delivery service accepts A's commit and answers 409 to B.
    a.merge(&gid);
    ok(json!({"op": "clear_pending", "handle": b.h, "groupId": gid}));
    b.process(pa["commit"].as_str().unwrap());
    c.process(pa["commit"].as_str().unwrap());
    let m = b.send(&gid, "m-8", "SYNTH after the race");
    assert_eq!(a.process(&m)["text"], "SYNTH after the race");
    assert_eq!(c.process(&m)["text"], "SYNTH after the race");
}

#[test]
fn duplicates_and_retries_are_dropped_before_decryption() {
    let (a, _b, c, gid) = household();
    let m = a.send(&gid, "m-9", "SYNTH once");
    assert_eq!(c.process(&m)["kind"], "text");
    assert_eq!(c.process(&m)["kind"], "duplicate");
    // A sender retry re-encrypts under the same message ID.
    let retry = a.send(&gid, "m-9", "SYNTH once");
    assert_ne!(retry, m);
    assert_eq!(c.process(&retry)["kind"], "duplicate");
}

#[test]
fn padding_hides_length_within_64_byte_steps() {
    let (a, _b, _c, gid) = household();
    let size = |n: usize| plainphone_mls::b64::decode(&a.send(&gid, &format!("p-{n}"), &"x".repeat(n))).unwrap().len();
    // 1 to 15 characters look the same on the server; the next step is 64 bytes larger.
    assert_eq!(size(1), size(15));
    assert_eq!(size(20), size(1) + 64);
}

#[test]
fn state_survives_export_and_import() {
    let (a, _b, c, gid) = household();
    let state = ok(json!({"op": "export_state", "handle": c.h}))["state"].as_str().unwrap().to_string();
    ok(json!({"op": "free", "handle": c.h}));
    let restored = ok(json!({"op": "import_state", "state": state}));
    assert_eq!(restored["deviceId"], "child-phone");
    let h = restored["handle"].as_u64().unwrap();
    let m = a.send(&gid, "m-12", "SYNTH after restart");
    let e = ok(json!({"op": "process", "handle": h, "message": m}));
    assert_eq!(e["text"], "SYNTH after restart");
}

#[test]
fn malformed_requests_are_errors_not_panics() {
    assert_eq!(call(json!({"op": "nope"}))["error"], "bad_request");
    assert_eq!(call(json!({"op": "process", "handle": 999_999, "message": "AA"}))["error"], "bad_request");
    let r: Value = serde_json::from_slice(&plainphone_mls::call(b"\xff\xfe")).unwrap();
    assert_eq!(r["ok"], false);
    let a = Dev::new("parent-a-phone", Role::Admin, 1);
    a.roster(1, &[&a]);
    assert_eq!(a.try_process("AAAA")["ok"], false);
    assert_eq!(call(json!({"op": "selftest"}))["ok"], true);
}

#[test]
fn an_offline_child_joins_two_conversations_from_one_last_resort_key_package() {
    let a = Dev::new("parent-a-phone", Role::Admin, 1);
    let c = Dev::new("child-phone", Role::Child, 3);
    a.roster(1, &[&a, &c]);
    c.roster(1, &[&a, &c]);
    let resort = ok(json!({"op": "key_packages", "handle": c.h, "count": 0, "lastResort": true}))["lastResort"]
        .as_str()
        .unwrap()
        .to_string();
    for n in 0..2 {
        let gid = ok(json!({"op": "create_group", "handle": a.h}))["groupId"].as_str().unwrap().to_string();
        let p = ok(json!({"op": "add_members", "handle": a.h, "groupId": gid, "keyPackages": [resort]}));
        a.merge(&gid);
        assert_eq!(c.process(p["welcome"].as_str().unwrap())["kind"], "joined");
        let m = a.send(&gid, &format!("lr-{n}"), "SYNTH via last resort");
        assert_eq!(c.process(&m)["text"], "SYNTH via last resort");
    }
}

#[test]
fn a_sender_whose_key_the_roster_no_longer_lists_is_refused() {
    let (a, b, c, gid) = household();
    // The log re-enrolled the child under a new MLS key; the old leaf is still in the group.
    let new_child = Dev::new("child-phone", Role::Child, 3);
    a.roster(2, &[&a, &b, &new_child]);
    let m = c.send(&gid, "m-13", CANARY);
    let r = a.try_process(&m);
    assert_eq!(r["error"], "roster_key_mismatch");
    assert!(!r.to_string().contains(CANARY));
}
