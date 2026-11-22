//! docs/encryption-test-vectors/mls-prototype.json: checked here against OpenMLS and the
//! binding code, and in server/test/e2ee.test.ts against the server's framing parser.
//!
//! The binding cases are deterministic. The wire cases are real OpenMLS output from a
//! synthetic group, made once: `PLAINPHONE_WRITE_VECTORS=1 cargo test --test vectors`
//! rewrites the file, after which the JSON diff needs review.

use ed25519_dalek::{Signer, SigningKey};
use openmls::prelude::{tls_codec::*, *};
use openmls_rust_crypto::RustCrypto;
use plainphone_mls::b64;
use plainphone_mls::client::{Client, CIPHERSUITE};
use plainphone_mls::roster::{binding_input, verify_entry, EntryIn, Role};
use plainphone_mls::testkit;
use serde_json::{json, Value};

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/encryption-test-vectors/mls-prototype.json");

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn binding_case(device_id: &str, log_seed: u8, mls_seed: u8, role: &str) -> Value {
    let mls_pub = key(mls_seed).verifying_key().to_bytes();
    let input = binding_input(device_id, &mls_pub).unwrap();
    json!({
        "deviceId": device_id,
        "role": role,
        "logSeed": b64::encode(&[log_seed; 32]),
        "logSignPub": b64::encode(key(log_seed).verifying_key().as_bytes()),
        "mlsSignPub": b64::encode(&mls_pub),
        "signInputUtf8": String::from_utf8(input.clone()).unwrap(),
        "signInput": b64::encode(&input),
        "binding": b64::encode(&key(log_seed).sign(&input).to_bytes()),
    })
}

fn entry_of(v: &Value) -> EntryIn {
    EntryIn {
        device_id: v["deviceId"].as_str().unwrap().into(),
        role: if v["role"] == "admin" { Role::Admin } else { Role::Child },
        log_sign_pub: v["logSignPub"].as_str().unwrap().into(),
        mls_sign_pub: v["mlsSignPub"].as_str().unwrap().into(),
        binding: v["binding"].as_str().unwrap().into(),
    }
}

fn rejection(name: &str, mut case: Value, field: &str, value: Value) -> Value {
    case[field] = value;
    case["name"] = json!(name);
    case["error"] = json!("binding_invalid");
    case
}

fn private_case(name: &str, message: &str) -> Value {
    let bytes = b64::decode(message).unwrap();
    let m = MlsMessageIn::tls_deserialize_exact(&bytes).unwrap();
    let p = m.try_into_protocol_message().unwrap();
    let content = match p.content_type() {
        ContentType::Application => 1,
        ContentType::Proposal => 2,
        ContentType::Commit => 3,
    };
    json!({
        "name": name, "message": message, "wireFormat": 2,
        "groupId": b64::encode(p.group_id().as_slice()), "epoch": p.epoch().as_u64(), "contentType": content,
    })
}

fn generate() -> Value {
    let bindings = vec![
        binding_case("parent-a-phone", 1, 0x41, "admin"),
        binding_case("parent-b-phone", 2, 0x42, "admin"),
        binding_case("child-phone", 3, 0x43, "child"),
    ];
    let other_pub = b64::encode(&key(0x44).verifying_key().to_bytes());
    let rejections = vec![
        rejection("signed for another device", bindings[2].clone(), "deviceId", json!("child-tablet")),
        rejection("another MLS key", bindings[2].clone(), "mlsSignPub", json!(other_pub)),
        rejection("signed by another log key", bindings[2].clone(), "logSignPub", bindings[0]["logSignPub"].clone()),
        rejection("small-order log key", bindings[2].clone(), "logSignPub", json!(b64::encode(&[0u8; 32]))),
    ];

    // A synthetic household: add (epoch 0), text (epoch 1), rotation (epoch 1), text (epoch 2).
    let mut a = Client::new("parent-a-phone").unwrap();
    let mut c = Client::new("child-phone").unwrap();
    let roster = vec![
        testkit::entry("parent-a-phone", Role::Admin, &testkit::log_key(1), &a.mls_sign_pub()).unwrap(),
        testkit::entry("child-phone", Role::Child, &testkit::log_key(3), &c.mls_sign_pub()).unwrap(),
    ];
    a.set_roster(1, &roster).unwrap();
    c.set_roster(1, &roster).unwrap();
    let (kps, resort) = c.key_packages(1, true).unwrap();
    let (gid, _, _) = a.create_group().unwrap();
    let add = a.add_members(&gid, &kps).unwrap();
    a.merge_pending(&gid).unwrap();
    let welcome = add.welcome.clone().unwrap();
    c.process(&welcome).unwrap();
    let (text1, _) = a.encrypt(&gid, "v-1", "SYNTH vector text").unwrap();
    let rotate = c.update(&gid).unwrap();
    c.merge_pending(&gid).unwrap();
    a.process(&rotate.commit).unwrap();
    let (text2, _) = c.encrypt(&gid, "v-2", "SYNTH vector answer").unwrap();
    a.process(&text2).unwrap();

    let wire = vec![
        private_case("commit adding the child", &add.commit),
        json!({ "name": "welcome for the child", "message": welcome, "wireFormat": 3, "cipherSuite": 1 }),
        private_case("application message", &text1),
        private_case("key rotation commit by the child", &rotate.commit),
        private_case("application message after rotation", &text2),
    ];

    let raw = b64::decode(&text1).unwrap();
    let mutate = |f: &dyn Fn(&mut Vec<u8>)| {
        let mut b = raw.clone();
        f(&mut b);
        b64::encode(&b)
    };
    let wire_rejections = vec![
        json!({ "name": "truncated", "message": mutate(&|b| { b.pop(); }), "openmlsRejects": true }),
        json!({ "name": "trailing byte", "message": mutate(&|b| b.push(0)), "openmlsRejects": true }),
        json!({ "name": "unsupported version", "message": mutate(&|b| b[1] = 2), "openmlsRejects": true }),
        json!({ "name": "public message wire format", "message": mutate(&|b| b[3] = 1), "openmlsRejects": false }),
        json!({ "name": "non-minimal group id length", "message": mutate(&|b| { b.splice(4..5, [0x40, raw[4]]); }), "openmlsRejects": false }),
        json!({ "name": "length prefix 0b11", "message": mutate(&|b| b[4] = 0xc0), "openmlsRejects": true }),
        json!({ "name": "unknown content type", "message": mutate(&|b| { let at = 5 + raw[4] as usize + 8; b[at] = 9; }), "openmlsRejects": true }),
    ];

    json!({
        "description": "E2EE phase 0 prototype (docs/e2ee-prototype.md). Synthetic test data only: never use these keys, seeds or messages outside tests. The binding cases are deterministic; the wire cases are recorded OpenMLS 0.9.2 output for suite 0x0001 with PURE_CIPHERTEXT and padding 64.",
        "ciphersuite": CIPHERSUITE as u16,
        "binding": bindings,
        "bindingRejections": rejections,
        "wire": wire,
        "keyPackages": [
            { "name": "child key package", "keyPackage": kps[0] },
            { "name": "child last-resort key package", "keyPackage": resort.unwrap() },
        ],
        "wireRejections": wire_rejections,
    })
}

#[test]
fn vectors_match() {
    if std::env::var("PLAINPHONE_WRITE_VECTORS").as_deref() == Ok("1") {
        let text = serde_json::to_string_pretty(&generate()).unwrap() + "\n";
        std::fs::write(PATH, text).unwrap();
    }
    let v: Value = serde_json::from_str(&std::fs::read_to_string(PATH).expect("vectors file")).unwrap();

    for (case, expected) in v["binding"].as_array().unwrap().iter().zip(generate()["binding"].as_array().unwrap()) {
        assert_eq!(case, expected, "binding vectors are deterministic");
        verify_entry(&entry_of(case)).expect("binding verifies");
    }
    for case in v["bindingRejections"].as_array().unwrap() {
        let e = verify_entry(&entry_of(case)).expect_err(case["name"].as_str().unwrap());
        assert_eq!(e.code, case["error"].as_str().unwrap());
    }
    for case in v["wire"].as_array().unwrap() {
        let bytes = b64::decode(case["message"].as_str().unwrap()).unwrap();
        let m = MlsMessageIn::tls_deserialize_exact(&bytes).unwrap();
        if case["wireFormat"] == 2 {
            assert_eq!(&private_case(case["name"].as_str().unwrap(), case["message"].as_str().unwrap()), case);
        } else {
            assert!(matches!(m.extract(), MlsMessageBodyIn::Welcome(_)), "{}", case["name"]);
        }
    }
    for case in v["keyPackages"].as_array().unwrap() {
        let bytes = b64::decode(case["keyPackage"].as_str().unwrap()).unwrap();
        let kp = KeyPackageIn::tls_deserialize_exact(&bytes).unwrap().validate(&RustCrypto::default(), ProtocolVersion::Mls10);
        assert!(kp.is_ok(), "{} {:?}", case["name"], kp.err());
    }
    for case in v["wireRejections"].as_array().unwrap() {
        if case["openmlsRejects"] == true {
            let bytes = b64::decode(case["message"].as_str().unwrap()).unwrap();
            let parsed = MlsMessageIn::tls_deserialize_exact(&bytes).ok().and_then(|m| m.try_into_protocol_message().ok());
            assert!(parsed.is_none(), "OpenMLS accepted {}", case["name"]);
        }
    }
}
