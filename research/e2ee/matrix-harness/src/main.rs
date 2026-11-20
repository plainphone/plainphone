//! Synthetic Matrix-crypto experiment for Plainphone issue #120.
//!
//! The same four synthetic endpoints as the OpenMLS harness (parent A,
//! parent B, child phone, a parent tablet that gets revoked) use vodozemac
//! Olm + Megolm the way matrix-sdk-crypto does, through an in-process fake
//! homeserver. No network, no real accounts, invented text only.

mod world;

use vodozemac::megolm::MegolmMessage;
use world::*;

type Res = Result<Vec<String>, String>;

/// Same texts in both harnesses, to compare what ciphertext length reveals.
const TEXTS: [&str; 5] = [
    "SYNTH-CANARY ok",
    "SYNTH-CANARY pick me up at the library after football",
    "SYNTH-CANARY a much longer text about the plan for the weekend, with times and places and who drives",
    "SYNTH-CANARY I'm home",
    "SYNTH-CANARY ok",
];

fn main() {
    let scenarios: Vec<(&str, fn() -> Res)> = vec![
        ("encrypt/decrypt between all members", encrypt_decrypt),
        ("substituted endpoint", substituted_endpoint),
        ("stale roster", stale_roster),
        ("revoke then send", revoke_then_send),
        ("lost device", lost_device),
        ("retry and reordering", retry_reordering),
        ("concurrent key changes", concurrent_changes),
        ("offline child catches up", offline_catch_up),
        ("local storage and restart", local_storage),
        ("ciphertext-only server and push inspection", server_inspection),
    ];
    let mut failed = 0;
    for (name, f) in scenarios {
        match f() {
            Ok(notes) => {
                println!("PASS  {name}");
                for n in notes {
                    println!("      - {n}");
                }
            }
            Err(e) => {
                failed += 1;
                println!("FAIL  {name}: {e}");
            }
        }
    }
    if failed > 0 {
        std::process::exit(1);
    }
}

fn family() -> (Server, Device, Device, Device, Device) {
    let mut server = Server::default();
    let pa = Device::new("parent-a-phone", &mut server);
    let pb = Device::new("parent-b-phone", &mut server);
    let cp = Device::new("child-phone", &mut server);
    let tab = Device::new("parent-a-tablet", &mut server);
    (server, pa, pb, cp, tab)
}

fn revoke(server: &mut Server, id: &str) {
    server.roster.borrow_mut().remove(id);
    server.room_devices.retain(|d| d != id);
}

fn encrypt_decrypt() -> Res {
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family();
    pa.send(&mut server, "SYNTH-CANARY dinner at six")?;
    cp.send(&mut server, "SYNTH-CANARY I'm home")?;
    pb.send(&mut server, "SYNTH-CANARY ok")?;
    for d in [&mut pa, &mut pb, &mut cp] {
        let n = d.sync(&mut server).len();
        if n != 2 {
            return Err(format!("{} read {n} of 2 ({:?})", d.id, d.last_errors));
        }
    }
    if tab.sync(&mut server).len() != 3 {
        return Err(format!("tablet read less than 3 ({:?})", tab.last_errors));
    }
    Ok(vec![
        "4 devices, 3 senders: every member decrypted every other member's text".into(),
        "each sender owns one outbound Megolm session and sent its key to the 3 other devices over pairwise Olm (9 to-device messages for 3 senders)".into(),
    ])
}

fn substituted_endpoint() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, _pb, _cp, _tab) = family();
    let mut evil = Device::new_unlisted("evil");
    // keys/query for child-phone now returns keys the server holds.
    server.substitute_keys("child-phone", &mut evil);
    pa.send_with(&mut server, "SYNTH-CANARY meet at the gate", true, false, true)?;
    for t in server.take_to_device("child-phone") {
        let _ = evil.receive_to_device(&t);
    }
    evil.check_sender_in_roster = false;
    let leaked: Vec<String> = server.timeline.clone().iter().filter_map(|e| evil.decrypt_event(e).ok()).collect();
    if leaked.is_empty() {
        return Err("expected the substituted endpoint to read the text".into());
    }
    notes.push("without a binding check the sender trusts keys/query, shares its Megolm key with the server-held identity key and that endpoint reads the text (measured)".into());

    let (mut server, mut pa, _pb, _cp, _tab) = family();
    let mut evil = Device::new_unlisted("evil");
    server.substitute_keys("child-phone", &mut evil);
    match pa.send(&mut server, "SYNTH-CANARY meet at the gate") {
        Err(e) if e.starts_with("roster") => notes.push(format!("with the roster check the share is refused: {e}")),
        other => return Err(format!("expected a roster refusal, got {other:?}")),
    }
    notes.push("Matrix's own answer is cross-signing plus user verification; with the Plainphone household log as the source of truth, cross-signing duplicates the log and must be mapped or disabled".into());

    // A forged room key claiming to come from parent B.
    let (mut server, _pa, _pb, mut cp, _tab) = family();
    let mut forger = Device::new_unlisted("parent-b-phone");
    server.upload_keys(&mut forger);
    let real_b = server.roster.borrow()["parent-b-phone"];
    server.directory.insert("parent-b-phone".into(), real_b);
    let cp_keys = server.query("child-phone").unwrap();
    let otk = server.claim("child-phone").unwrap();
    let mut s = forger
        .account
        .create_outbound_session(vodozemac::olm::SessionConfig::version_1(), cp_keys.0, otk)
        .map_err(|e| e.to_string())?;
    let m = s.encrypt("{\"session_id\":\"x\",\"session_key\":\"y\"}").map_err(|e| e.to_string())?;
    server.send_to_device("parent-b-phone", "child-phone", forger.account.curve25519_key(), m);
    cp.sync(&mut server);
    if !cp.last_errors.iter().any(|e| e.starts_with("roster")) {
        return Err("child accepted a forged room key".into());
    }
    notes.push(format!("the child refuses a to-device room key from an identity key the log does not list: {}", cp.last_errors[0]));
    Ok(notes)
}

fn stale_roster() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family();
    pb.send(&mut server, "SYNTH-CANARY before")?;
    tab.sync(&mut server);
    // Revoked in the household log; the server keeps listing the tablet to
    // parent B (stale member list) and B trusts the server's list.
    server.roster.borrow_mut().remove("parent-a-tablet");
    pb.send_with(&mut server, "SYNTH-CANARY after the revocation", false, true, true)?;
    tab.check_sender_in_roster = false;
    let read = tab.sync(&mut server);
    if !read.iter().any(|t| t.contains("after the revocation")) {
        return Err("expected the revoked tablet to read B's text".into());
    }
    notes.push("parent B builds recipients from a stale server member list: its existing Megolm session stays shared with the revoked tablet, which reads B's next text (measured)".into());
    server.room_devices.retain(|d| d != "parent-a-tablet");
    pb.send(&mut server, "SYNTH-CANARY recipients from the log")?;
    let read = tab.sync(&mut server);
    if !read.is_empty() {
        return Err("tablet read after B used the log".into());
    }
    pa.sync(&mut server);
    cp.sync(&mut server);
    notes.push("taking recipients from the verified household log makes B notice the removal, rotate, and the tablet reads nothing; a server that withholds log entries can still delay this, exactly as with MLS".into());
    Ok(notes)
}

fn revoke_then_send() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family();
    pa.send(&mut server, "SYNTH-CANARY 1")?;
    pb.send(&mut server, "SYNTH-CANARY 2")?;
    tab.send(&mut server, "SYNTH-CANARY 0 from the tablet")?;
    tab.sync(&mut server);
    cp.sync(&mut server);
    let a_before = pa.outbound_session_id();
    revoke(&mut server, "parent-a-tablet");
    pa.send(&mut server, "SYNTH-CANARY A after revoke")?;
    if pa.outbound_session_id() == a_before {
        return Err("A did not rotate".into());
    }
    // B does not rotate: models a client without matrix-sdk's rotation rule.
    pb.send_with(&mut server, "SYNTH-CANARY B after revoke, no rotation", true, true, false)?;
    tab.check_sender_in_roster = false;
    let read = tab.sync(&mut server);
    notes.push(format!(
        "A rotates its Megolm session on removal and the tablet cannot read A ({}); B keeps its old session and the tablet reads B's post-revocation text ({}): every sender must rotate on every removal",
        !read.iter().any(|t| t.contains("A after")),
        read.iter().any(|t| t.contains("B after"))
    ));
    if read.iter().any(|t| t.contains("A after")) || !read.iter().any(|t| t.contains("B after")) {
        return Err("unexpected revocation result".into());
    }
    pb.send(&mut server, "SYNTH-CANARY B after rotation")?;
    if tab.sync(&mut server).iter().any(|t| t.contains("B after rotation")) {
        return Err("tablet read after B rotated".into());
    }
    let got = cp.sync(&mut server);
    notes.push(format!("after B also rotates, the child reads all {} texts and the tablet none", got.len()));
    // The revoked tablet still sends with its old session.
    tab.send_with(&mut server, "SYNTH-CANARY from the revoked tablet", false, false, false)?;
    let got = cp.sync(&mut server);
    if !got.is_empty() {
        return Err("child accepted a revoked sender".into());
    }
    notes.push(format!("the revoked tablet can still encrypt with the session it shared before the revocation; the child rejects it only because the app checks the sender against the log ({})", cp.last_errors.join(" | ")));
    let (mut s2, _a2, _b2, mut c2, mut t2) = family();
    t2.send(&mut s2, "SYNTH-CANARY warm-up")?;
    c2.sync(&mut s2);
    revoke(&mut s2, "parent-a-tablet");
    t2.send_with(&mut s2, "SYNTH-CANARY from the revoked tablet", false, false, false)?;
    c2.check_sender_in_roster = false;
    let got = c2.sync(&mut s2);
    notes.push(format!("without that app check the child accepts {} text(s) from the revoked tablet (measured)", got.len()));
    Ok(notes)
}

fn lost_device() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, _cp, mut tab) = family();
    pa.send(&mut server, "SYNTH-CANARY before the loss")?;
    let old_sid = pa.outbound_session_id().unwrap();
    pb.sync(&mut server);
    tab.sync(&mut server);
    revoke(&mut server, "child-phone");
    let mut cp2 = Device::new("child-phone-2", &mut server);
    pa.send(&mut server, "SYNTH-CANARY after re-enrollment")?;
    let got = cp2.sync(&mut server);
    notes.push(format!(
        "the re-enrolled phone reads {} of 2 texts: new sessions reach it, the pre-loss session does not ({})",
        got.len(),
        cp2.last_errors.join(" | ")
    ));
    if got.len() != 1 {
        return Err("unexpected history access".into());
    }
    // History via key forwarding / backup, the Matrix way.
    let k = pa.export_history_for(&old_sid).ok_or("no session to export")?;
    cp2.import_history("parent-a-phone", &old_sid, &k);
    let got = cp2.sync(&mut server);
    notes.push(format!(
        "if parent A forwards (or a key backup restores) the old Megolm session, the new phone also reads the old text ({} more): Matrix makes history access possible, and so a policy decision",
        got.len()
    ));
    Ok(notes)
}

fn retry_reordering() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, _pb, mut cp, _tab) = family();
    for i in 1..=5 {
        pa.send(&mut server, &format!("SYNTH-CANARY {i}"))?;
    }
    for t in server.take_to_device("child-phone") {
        cp.receive_to_device(&t)?;
    }
    let ev = server.new_events("child-phone");
    let mut ok = 0;
    for i in [2usize, 0, 4, 1, 3] {
        if cp.decrypt_event(&ev[i]).is_ok() {
            ok += 1;
        }
    }
    notes.push(format!("5 texts delivered as 3,1,5,2,4: {ok}/5 decrypted"));
    let dup = cp.decrypt_event(&ev[0]);
    notes.push(format!("the same event delivered twice: vodozemac decrypts it again; only the app's (session, index) check rejects it ({})", dup.err().unwrap_or_default()));
    cp.detect_replays = false;
    let dup2 = cp.decrypt_event(&ev[1]);
    notes.push(format!("with that check off the duplicate is accepted ({})", dup2.is_ok()));
    for i in 1..=12 {
        pa.send(&mut server, &format!("SYNTH-CANARY far {i}"))?;
    }
    let ev = server.new_events("child-phone");
    cp.detect_replays = true;
    let late = cp.decrypt_event(&ev[11]).is_ok();
    let early = cp.decrypt_event(&ev[0]).is_ok();
    notes.push(format!(
        "12 texts, newest first then the oldest: newest {late}, oldest {early}: an inbound Megolm session keeps every earlier index decryptable (no forward secrecy inside a session until it rotates)"
    ));
    Ok(notes)
}

fn concurrent_changes() -> Res {
    let (mut server, mut pa, mut pb, mut cp, _tab) = family();
    revoke(&mut server, "parent-a-tablet");
    pa.send(&mut server, "SYNTH-CANARY A rotates")?;
    pb.send(&mut server, "SYNTH-CANARY B rotates at the same time")?;
    let got = cp.sync(&mut server);
    let a = pa.sync(&mut server);
    let b = pb.sync(&mut server);
    if got.len() != 2 || a.len() != 1 || b.len() != 1 {
        return Err("concurrent rotations did not converge".into());
    }
    Ok(vec!["both parents rotate in parallel after a removal; nothing to order, every member reads both: per-sender sessions have no shared epoch to fork".into()])
}

fn offline_catch_up() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, _tab) = family();
    pa.send(&mut server, "SYNTH-CANARY 1")?;
    pb.send(&mut server, "SYNTH-CANARY 2")?;
    revoke(&mut server, "parent-a-tablet");
    pa.send(&mut server, "SYNTH-CANARY 3")?;
    pb.send(&mut server, "SYNTH-CANARY 4")?;
    let got = cp.sync(&mut server);
    notes.push(format!("child offline across 2 rotations and 4 texts reads {} of 4 once it syncs", got.len()));
    // Timeline arrives before the room key (separate queues).
    let (mut server, mut pa, _pb, mut cp, _tab) = family();
    server.withhold_from.push("child-phone".into());
    pa.send(&mut server, "SYNTH-CANARY key arrives late")?;
    let first = cp.sync(&mut server);
    let utd = cp.last_errors.clone();
    server.withhold_from.clear();
    let second = cp.sync(&mut server);
    notes.push(format!(
        "timeline before the to-device key: {} read ({}), retried after the key arrived: {} read; the app needs an 'unable to decrypt yet' state and a retry queue",
        first.len(),
        utd.join(" | "),
        second.len()
    ));
    Ok(notes)
}

fn local_storage() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, _pb, mut cp, _tab) = family();
    pa.send(&mut server, "SYNTH-CANARY before restart")?;
    cp.send(&mut server, "SYNTH-CANARY hello")?;
    let p = cp.pickle();
    notes.push(format!(
        "child phone state (account, 3 Olm sessions, own and inbound Megolm sessions) as encrypted pickles: {} bytes",
        p.total_len()
    ));
    notes.push("vodozemac pickles are encrypted with an app-supplied 32-byte key (the matrix-sdk stores add their own store cipher); the app still has to keep that key in Android Keystore / SecureStore".into());
    let mut restored = Device::unpickle("child-phone", server.roster.clone(), &p)?;
    if restored.sync(&mut server).len() != 1 {
        return Err("restored device could not read".into());
    }
    notes.push("a restart from the pickles continues the conversation".into());
    // Rolled-back outbound Megolm session encrypts at an index already used.
    restored.send(&mut server, "SYNTH-CANARY from the live state")?;
    let mut rolled = Device::unpickle("child-phone", server.roster.clone(), &p)?;
    rolled.send(&mut server, "SYNTH-CANARY from the rolled-back copy")?;
    let n = server.timeline.len();
    let a = MegolmMessage::from_bytes(&server.timeline[n - 2].body).map_err(|e| e.to_string())?;
    let b = MegolmMessage::from_bytes(&server.timeline[n - 1].body).map_err(|e| e.to_string())?;
    let same_index = a.message_index() == b.message_index();
    let same_block = a.ciphertext()[..16] == b.ciphertext()[..16];
    notes.push(format!(
        "live state and a rolled-back copy both encrypt at Megolm index {} (same index: {same_index}); the first AES-CBC block is identical: {same_block} (both texts start with the same 16 bytes), so a restored backup leaks plaintext equality",
        a.message_index()
    ));
    let got = pa.sync(&mut server);
    notes.push(format!(
        "parent A reads {} of the 2 and rejects the second as a replay ({})",
        got.iter().filter(|t| t.contains("from the")).count(),
        pa.last_errors.join(" | ")
    ));
    if !same_index {
        return Err("expected index reuse after rollback".into());
    }
    Ok(notes)
}

fn server_inspection() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family();
    for t in &TEXTS[..3] {
        pa.send(&mut server, t)?;
    }
    cp.send(&mut server, TEXTS[3])?;
    revoke(&mut server, "parent-a-tablet");
    pb.send(&mut server, TEXTS[4])?;
    for d in [&mut pa, &mut pb, &mut cp, &mut tab] {
        d.sync(&mut server);
    }
    let all = server.everything_seen();
    let leaks = all.iter().filter(|b| b.windows(12).any(|w| w == b"SYNTH-CANARY")).count();
    if leaks > 0 {
        return Err(format!("{leaks} blobs contain plaintext"));
    }
    notes.push(format!("{} server-visible blobs (to-device Olm, Megolm events, push payloads): no plaintext canary", all.len()));
    let sizes = server.timeline_sizes();
    let lens: Vec<usize> = TEXTS.iter().map(|t| t.len()).collect();
    notes.push(format!(
        "Megolm event sizes for texts of {lens:?} bytes: {sizes:?}: no padding, so the server learns each text's length to 16 bytes"
    ));
    let first = MegolmMessage::from_bytes(&server.timeline[1].body).map_err(|e| e.to_string())?;
    notes.push(format!(
        "cleartext per event: sender device, session id and the message index ({} for A's second text); per to-device message: sender, recipient, sender identity key and Olm message type. The server sees who shares keys with whom and when each sender rotates",
        first.message_index()
    ));
    Ok(notes)
}
