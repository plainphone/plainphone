//! Synthetic OpenMLS experiment for Plainphone issue #120.
//!
//! Four synthetic endpoints (parent A, parent B, child phone and a parent
//! tablet that gets revoked) talk through an in-process fake delivery server.
//! Nothing here touches the network, the app or the real server. Every name and
//! message is invented. Run with `cargo run --release` (see ../README.md).
//!
//! Each scenario returns notes that become the measured lines in
//! docs/research/e2ee-recommendation.md. A failed expectation aborts with a
//! non-zero exit code.

use mls_harness::{cross, world};

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
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("cross") {
        // Cross-runtime steps, one process per step: see cross.rs.
        if let Err(e) = cross::run_dir(&args[2..]) {
            eprintln!("cross step failed: {e}");
            std::process::exit(1);
        }
        return;
    }

    let scenarios: Vec<(&str, fn() -> Res)> = vec![
        ("encrypt/decrypt between all members", encrypt_decrypt),
        ("substituted endpoint", substituted_endpoint),
        ("stale roster", stale_roster),
        ("revoke then send", revoke_then_send),
        ("lost device", lost_device),
        ("retry and reordering", retry_reordering),
        ("concurrent commits need server ordering", concurrent_commits),
        ("offline child catches up in server order", offline_catch_up),
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

/// Parent A creates the family group and adds parent B, the child phone and
/// parent A's tablet.
fn family() -> Result<(Server, Device, Device, Device, Device), String> {
    let mut server = Server::new();
    let mut pa = Device::new("parent-a-phone", &server.roster);
    let mut pb = Device::new("parent-b-phone", &server.roster);
    let mut cp = Device::new("child-phone", &server.roster);
    let mut tab = Device::new("parent-a-tablet", &server.roster);
    for d in [&pb, &cp, &tab] {
        server.publish_key_package(d);
    }
    pa.create_group(&mut server)?;
    let kps = ["parent-b-phone", "child-phone", "parent-a-tablet"]
        .iter()
        .map(|id| server.fetch_key_package(id))
        .collect::<Result<Vec<_>, _>>()?;
    pa.add(&mut server, &kps)?;
    for d in [&mut pb, &mut cp, &mut tab] {
        d.sync(&mut server)?;
    }
    Ok((server, pa, pb, cp, tab))
}

fn encrypt_decrypt() -> Res {
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family()?;
    pa.send(&mut server, "SYNTH-CANARY dinner at six")?;
    cp.send(&mut server, "SYNTH-CANARY I'm home")?;
    pb.send(&mut server, "SYNTH-CANARY ok")?;
    let mut notes = vec![];
    for d in [&mut pa, &mut pb, &mut cp, &mut tab] {
        let got = d.sync(&mut server)?;
        let want = if d.id == "parent-a-phone" || d.id == "parent-b-phone" || d.id == "child-phone" {
            2
        } else {
            3
        };
        if got.len() != want {
            return Err(format!("{} decrypted {} of {want}", d.id, got.len()));
        }
    }
    let same = [&pb, &cp, &tab]
        .iter()
        .all(|d| d.group().epoch_authenticator().as_slice() == pa.group().epoch_authenticator().as_slice());
    if !same {
        return Err("epoch authenticators differ".into());
    }
    notes.push(format!(
        "4 devices, epoch {}, every member decrypted every other member's text; epoch authenticators match",
        pa.group().epoch().as_u64()
    ));
    notes.push(format!(
        "ciphersuite {:?}: X25519 and Ed25519 as in docs/encryption.md, but AES-128-GCM where the spec uses AES-256-GCM (RFC 9420 has no X25519 + AES-256 suite)",
        CIPHERSUITE
    ));
    Ok(notes)
}

fn substituted_endpoint() -> Res {
    let mut notes = vec![];
    let mut server = Server::new();
    let mut pa = Device::new("parent-a-phone", &server.roster);
    let cp = Device::new("child-phone", &server.roster);
    // A malicious server publishes its own key package for "child-phone": same
    // identity string, fresh keys the server holds.
    let mut evil = Device::new_unlisted("child-phone");
    server.publish_key_package(&cp);
    server.substitute_key_package("child-phone", &evil);
    pa.create_group(&mut server)?;
    let kp = server.fetch_key_package("child-phone")?;

    // 1. OpenMLS alone accepts it: the credential is only a label.
    let mut naive = pa.clone_for_experiment()?;
    naive.add_unchecked(&mut server, &[kp.clone()])?;
    evil.sync(&mut server)?;
    naive.send(&mut server, "SYNTH-CANARY meet at the gate")?;
    let leaked = evil.sync(&mut server)?;
    if leaked.is_empty() {
        return Err("expected the substituted endpoint to read the naive group".into());
    }
    notes.push("without a roster check OpenMLS admits the substituted key package and the server-held endpoint reads the text (measured): BasicCredential is only a label".into());

    // 2. With the roster binding the add is refused.
    match pa.add(&mut server, &[kp]) {
        Err(e) if e.contains("roster") => notes.push(format!("with the roster check the add is refused: {e}")),
        Err(e) => return Err(format!("unexpected error {e}")),
        Ok(()) => return Err("roster check let a substituted key package through".into()),
    }

    // 3. A joiner checks the members of a Welcome against its own roster.
    let mut server2 = Server::new();
    let mut pa2 = Device::new("parent-a-phone", &server2.roster);
    let mut cp2 = Device::new("child-phone", &server2.roster);
    let intruder = Device::new_unlisted("parent-b-phone");
    server2.publish_key_package(&cp2);
    server2.key_packages.insert("intruder".into(), intruder.key_package());
    pa2.create_group(&mut server2)?;
    let kps = vec![server2.fetch_key_package("child-phone")?, server2.fetch_key_package("intruder")?];
    pa2.add_unchecked(&mut server2, &kps)?;
    match cp2.sync(&mut server2) {
        Err(e) if e.contains("roster") => notes.push(format!("the child phone refuses a Welcome whose member list does not match its roster: {e}")),
        Err(e) => return Err(format!("unexpected error {e}")),
        Ok(_) => return Err("joiner accepted an unknown member".into()),
    }
    Ok(notes)
}

fn stale_roster() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, tab) = family()?;
    // The tablet was stolen. Whoever holds it keeps its pre-removal state and
    // never applies the removal; the server colludes and withholds the
    // removal commit from parent B only.
    let mut stolen = tab.clone_for_experiment()?;
    server.withhold_from.push("parent-b-phone".into());
    pa.remove(&mut server, &["parent-a-tablet"])?;
    cp.sync(&mut server)?;
    let _ = server.take_queue("parent-a-tablet");
    // Parent B, still in the old epoch, sends.
    pb.send(&mut server, "SYNTH-CANARY sent from a stale epoch")?;
    let mut tab_read = vec![];
    for it in server.take_queue("parent-a-tablet") {
        if let Ok(Some(t)) = stolen.process_raw(&it.body) {
            tab_read.push(t);
        }
    }
    let cp_read = cp.sync(&mut server);
    notes.push(format!(
        "server withholds the removal from parent B; B's next text is in epoch {} while A and the child are in {}",
        pb.group().epoch().as_u64(),
        pa.group().epoch().as_u64()
    ));
    if tab_read.iter().any(|t| t.contains("stale epoch")) {
        notes.push("a stolen copy of the revoked tablet that ignores its removal decrypts B's stale-epoch text (measured): a lagging sender leaks to a removed device until it catches up".into());
    } else {
        return Err("expected the revoked tablet to read the stale-epoch text".into());
    }
    match cp_read {
        Ok(v) if v.is_empty() => notes.push(format!("the child phone (max_past_epochs = 0) cannot open the stale text ({})", cp.last_errors.join(" | "))),
        Ok(v) => return Err(format!("child read stale text {v:?}")),
        Err(e) => notes.push(format!("the child phone rejects it: {e}")),
    }
    // Defence: the server refuses application messages for an old epoch,
    // and the sender syncs before sending.
    server.withhold_from.clear();
    server.reject_stale_epoch = true;
    let mut pb_fresh = pb;
    let before = server.rejected;
    let r = pb_fresh.send(&mut server, "SYNTH-CANARY second try");
    notes.push(format!(
        "with the server-side epoch check the stale send is refused ({}), B syncs, sees the removal and resends in epoch {}",
        r.err().unwrap_or_default(),
        {
            pb_fresh.sync(&mut server)?;
            pb_fresh.send(&mut server, "SYNTH-CANARY second try")?;
            pb_fresh.group().epoch().as_u64()
        }
    ));
    if server.rejected != before + 1 {
        return Err("server did not reject the stale send".into());
    }
    let mut tab_after = vec![];
    for it in server.take_queue("parent-a-tablet") {
        if let Ok(Some(t)) = stolen.process_raw(&it.body) {
            tab_after.push(t);
        }
    }
    if !tab_after.is_empty() {
        return Err("revoked tablet read the resent text".into());
    }
    notes.push("the server-side check is only a mitigation: a malicious server can still withhold, so the client must also refuse to send while its roster head is behind the household log (docs/encryption.md §3)".into());
    Ok(notes)
}

fn revoke_then_send() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family()?;
    let old_epoch = pa.group().epoch().as_u64();
    pa.remove(&mut server, &["parent-a-tablet"])?;
    tab.sync(&mut server)?;
    pb.sync(&mut server)?;
    cp.sync(&mut server)?;
    if tab.group().is_active() {
        return Err("removed tablet still thinks it is active".into());
    }
    notes.push(format!(
        "removal commit moves the group from epoch {old_epoch} to {}; the tablet processes its own removal and its group turns inactive",
        pa.group().epoch().as_u64()
    ));
    pa.send(&mut server, "SYNTH-CANARY after revoke")?;
    let read = tab.sync(&mut server).unwrap_or_default();
    if !read.is_empty() {
        return Err("revoked tablet read a post-revocation text".into());
    }
    if pb.sync(&mut server)?.len() != 1 || cp.sync(&mut server)?.len() != 1 {
        return Err("remaining members could not read".into());
    }
    notes.push("text sent after the removal: parent B and the child read it, the revoked tablet cannot".into());
    match tab.send(&mut server, "SYNTH-CANARY from revoked tablet") {
        Err(e) => notes.push(format!("the revoked tablet cannot create a message any more: {e}")),
        Ok(()) => {
            let got = cp.sync(&mut server).unwrap_or_default();
            if !got.is_empty() {
                return Err("child accepted a message from the revoked tablet".into());
            }
            notes.push("a message the revoked tablet creates is refused by the remaining members".into());
        }
    }
    // A stolen tablet kept a copy of its pre-removal state.
    notes.push("the removed tablet still holds every text it decrypted before the removal; MLS gives no remote wipe (document in the UI)".into());
    Ok(notes)
}

fn lost_device() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, cp, mut tab) = family()?;
    pa.send(&mut server, "SYNTH-CANARY before the loss")?;
    pb.sync(&mut server)?;
    tab.sync(&mut server)?;
    let old_ciphertexts = server.all_ciphertexts_for("child-phone");
    // The child phone is reset: state and keys are gone. It re-enrolls with a
    // new device ID, visibly, through the household log.
    drop(cp);
    let mut cp2 = Device::new("child-phone-2", &server.roster);
    server.roster.borrow_mut().remove("child-phone");
    server.publish_key_package(&cp2);
    let kp = server.fetch_key_package("child-phone-2")?;
    pa.replace(&mut server, "child-phone", kp)?;
    let first = cp2.sync(&mut server)?;
    pb.sync(&mut server)?;
    tab.sync(&mut server)?;
    notes.push(format!(
        "parent A replaces the lost leaf with the re-enrolled phone in one commit (remove + add, epoch {}); the new phone joins from the Welcome",
        pa.group().epoch().as_u64()
    ));
    if !first.is_empty() {
        return Err("new device read old history from the Welcome".into());
    }
    let mut readable = 0;
    for c in &old_ciphertexts {
        if cp2.try_decrypt_raw(c).is_ok() {
            readable += 1;
        }
    }
    if readable > 0 {
        return Err("new device decrypted old ciphertext".into());
    }
    notes.push(format!(
        "the re-enrolled phone cannot open any of the {} ciphertexts queued before the loss: no history without a separate backup design",
        old_ciphertexts.len()
    ));
    pb.send(&mut server, "SYNTH-CANARY after re-enrollment")?;
    if cp2.sync(&mut server)?.len() != 1 {
        return Err("new device cannot read new text".into());
    }
    notes.push("text sent after re-enrollment reaches the new phone".into());
    Ok(notes)
}

fn retry_reordering() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, _pb, mut cp, _tab) = family()?;
    for i in 1..=5 {
        pa.send(&mut server, &format!("SYNTH-CANARY {i}"))?;
    }
    let mut msgs = server.take_queue("child-phone");
    let order = [2usize, 0, 4, 1, 3];
    let mut out = vec![];
    for i in order {
        out.push(cp.process_raw(&msgs[i].body)?);
    }
    notes.push(format!(
        "5 texts delivered as 3,1,5,2,4 inside one epoch: {}/5 decrypted (default SenderRatchetConfiguration: out_of_order_tolerance 5, maximum_forward_distance 1000)",
        out.iter().filter(|o| o.is_some()).count()
    ));
    // Duplicate delivery of the same ciphertext.
    let dup = cp.process_raw(&msgs[0].body);
    match dup {
        Err(e) => notes.push(format!("the same ciphertext delivered twice fails the second time ({e}); dedupe by the server's message id before decrypting and do not treat this error as tampering")),
        Ok(_) => return Err("duplicate ciphertext decrypted twice".into()),
    }
    // Retry after a lost acknowledgement: the sender re-encrypts.
    pa.send(&mut server, "SYNTH-CANARY id=42")?;
    pa.send(&mut server, "SYNTH-CANARY id=42")?;
    let got = cp.sync(&mut server)?;
    notes.push(format!(
        "a sender retry after a lost acknowledgement re-encrypts: the receiver decrypts both copies ({}), so the client message id must sit inside the plaintext and be deduplicated by the app",
        got.len()
    ));
    // Reordering beyond the tolerance.
    for i in 1..=12 {
        pa.send(&mut server, &format!("SYNTH-CANARY far {i}"))?;
    }
    msgs = server.take_queue("child-phone");
    let late = cp.process_raw(&msgs[11].body)?;
    let early = cp.process_raw(&msgs[0].body);
    notes.push(format!(
        "12 texts, newest first then the oldest: newest {} and oldest {} (11 generations behind with tolerance 5)",
        if late.is_some() { "decrypts" } else { "fails" },
        match early {
            Ok(Some(_)) => "decrypts".to_string(),
            Ok(None) => "fails".to_string(),
            Err(e) => format!("fails: {e}"),
        }
    ));
    Ok(notes)
}

fn concurrent_commits() -> Res {
    let mut notes = vec![];
    // Without ordering: both parents commit in the same epoch and the server
    // forwards both.
    let (mut server, mut pa, mut pb, mut cp, _tab) = family()?;
    server.order_commits = false;
    let e = pa.group().epoch().as_u64();
    pa.remove(&mut server, &["parent-a-tablet"])?;
    pb.self_update(&mut server)?;
    cp.sync(&mut server)?;
    notes.push(format!(
        "no ordering: A's removal and B's key update both target epoch {e}; the child applies the first and rejects the second ({})",
        cp.last_errors.join(" | ")
    ));
    pb.sync(&mut server)?;
    pa.sync(&mut server)?;
    let fork = pb.group().epoch_authenticator().as_slice() != pa.group().epoch_authenticator().as_slice();
    notes.push(format!(
        "A merged its own removal, B merged its own update; each then rejects the other's commit ({} / {}); A and B {}",
        pa.last_errors.join(" | "),
        pb.last_errors.join(" | "),
        if fork { "now disagree on the epoch (fork) and cannot read each other" } else { "agree" }
    ));
    if !fork {
        return Err("expected a fork without server ordering".into());
    }

    // With ordering: the server accepts one commit per epoch and answers 409.
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family()?;
    pa.remove(&mut server, &["parent-a-tablet"])?;
    match pb.self_update(&mut server) {
        Err(e) if e.contains("409") => {}
        other => return Err(format!("expected 409, got {other:?}")),
    }
    pb.sync(&mut server)?;
    pb.self_update(&mut server)?;
    for d in [&mut pa, &mut cp, &mut tab] {
        d.sync(&mut server)?;
    }
    if pb.group().epoch_authenticator().as_slice() != pa.group().epoch_authenticator().as_slice()
        || cp.group().epoch_authenticator().as_slice() != pa.group().epoch_authenticator().as_slice()
    {
        return Err("members disagree after ordered commits".into());
    }
    notes.push(format!(
        "with one accepted commit per epoch (409 for the loser, which clears its pending commit, syncs and retries) all members agree at epoch {}",
        pa.group().epoch().as_u64()
    ));
    Ok(notes)
}

fn offline_catch_up() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family()?;
    // The child is offline while the parents send and change membership.
    pa.send(&mut server, "SYNTH-CANARY 1")?;
    pb.sync(&mut server)?;
    pb.self_update(&mut server)?;
    pa.sync(&mut server)?;
    tab.sync(&mut server)?;
    pb.send(&mut server, "SYNTH-CANARY 2")?;
    pa.remove(&mut server, &["parent-a-tablet"])?;
    pb.sync(&mut server)?;
    pa.send(&mut server, "SYNTH-CANARY 3")?;
    pa.self_update(&mut server)?;
    pb.sync(&mut server)?;
    pb.send(&mut server, "SYNTH-CANARY 4")?;
    let queued = server.queue_len("child-phone");
    let got = cp.sync(&mut server)?;
    if got.len() != 4 {
        return Err(format!("child read {} of 4 after catching up", got.len()));
    }
    notes.push(format!(
        "child offline across 3 commits and 4 texts ({queued} queued items): read all 4 in server order with max_past_epochs = 0"
    ));
    // Same queue, but the server delivers the texts after the commits.
    let (mut server, mut pa, mut pb, mut cp, _tab) = family()?;
    server.deliver_handshakes_first = true;
    pa.send(&mut server, "SYNTH-CANARY 1")?;
    pb.sync(&mut server)?;
    pb.self_update(&mut server)?;
    pa.sync(&mut server)?;
    let got = cp.sync(&mut server)?;
    notes.push(format!(
        "if delivery puts the commit before an older text the child reads {} of 1 with max_past_epochs = 0: the queue must keep one total order per conversation",
        got.len()
    ));
    let (mut server, mut pa, mut pb, mut cp, _tab) = family_with_past_epochs(1)?;
    server.deliver_handshakes_first = true;
    pa.send(&mut server, "SYNTH-CANARY 1")?;
    pb.sync(&mut server)?;
    pb.self_update(&mut server)?;
    pa.sync(&mut server)?;
    let got = cp.sync(&mut server)?;
    notes.push(format!(
        "with max_past_epochs = 1 the same out-of-order delivery reads {} of 1, at the cost of keeping one old epoch's keys",
        got.len()
    ));
    Ok(notes)
}

fn family_with_past_epochs(n: usize) -> Result<(Server, Device, Device, Device, Device), String> {
    world::set_past_epochs(n);
    let r = family();
    world::set_past_epochs(0);
    r
}

fn local_storage() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, _pb, cp, _tab) = family()?;
    pa.send(&mut server, "SYNTH-CANARY before restart")?;
    let (bytes, contains_sig_key) = cp.snapshot();
    notes.push(format!(
        "child phone state after joining a 4-member group: {} bytes in openmls_memory_storage's serialization",
        bytes.len()
    ));
    if contains_sig_key {
        notes.push("the serialized store contains the raw Ed25519 private signature key (measured): the app must encrypt the store at rest (Android Keystore AES-GCM, Expo SecureStore-wrapped key) exactly as docs/encryption.md requires for H/R/L keys".into());
    }
    let mut restored = Device::restore(&cp, &bytes)?;
    let got = restored.sync(&mut server)?;
    if got.len() != 1 {
        return Err("restored device could not read".into());
    }
    notes.push("a process restart from the serialized store continues the conversation".into());
    // Rollback: an old snapshot comes back (OS backup restore, cloned app
    // data) while the live state has moved on.
    restored.send(&mut server, "SYNTH-CANARY from the live state")?;
    let mut rolled = Device::restore(&cp, &bytes)?;
    rolled.send(&mut server, "SYNTH-CANARY from the rolled-back copy")?;
    let read = pa.sync(&mut server)?;
    notes.push(format!(
        "live state and a rolled-back copy each send one text from the same sender-ratchet generation: parent A reads {} of 2 and rejects the other ({}); MLS's reuse_guard keeps the AES-GCM nonces apart, but the second text is lost",
        read.len(),
        pa.last_errors.join(" | ")
    ));
    pa.self_update(&mut server)?;
    restored.sync(&mut server)?;
    pa.send(&mut server, "SYNTH-CANARY after the epoch moved")?;
    let r = rolled.sync(&mut server)?;
    notes.push(format!(
        "once the group moves to a new epoch the rolled-back copy reads {} texts ({}): it is stuck and must be re-added; keep MLS state out of OS backups",
        r.len(),
        rolled.last_errors.join(" | ")
    ));
    Ok(notes)
}

fn server_inspection() -> Res {
    let mut notes = vec![];
    let (mut server, mut pa, mut pb, mut cp, mut tab) = family()?;
    for t in &TEXTS[..3] {
        pa.send(&mut server, t)?;
    }
    cp.sync(&mut server)?;
    cp.send(&mut server, TEXTS[3])?;
    pa.remove(&mut server, &["parent-a-tablet"])?;
    pb.sync(&mut server)?;
    pb.send(&mut server, TEXTS[4])?;
    for d in [&mut tab, &mut pa, &mut cp] {
        d.sync(&mut server)?;
    }
    let all = server.everything_seen();
    let leaks = all.iter().filter(|b| contains(b, b"SYNTH-CANARY")).count();
    if leaks > 0 {
        return Err(format!("{leaks} server-visible blobs contain plaintext"));
    }
    notes.push(format!(
        "{} server-visible blobs (key packages, commits, welcomes, texts, push payloads): no plaintext canary in any of them",
        all.len()
    ));
    let (kp_leaks, msg_leaks) = server.label_visibility(b"child-phone");
    notes.push(format!(
        "the device label 'child-phone' is visible in {kp_leaks} published key package(s) and {msg_leaks} queued commits/Welcomes/texts: PURE_CIPHERTEXT commits and the encrypted Welcome hide the roster, but key packages are public by design, so the MLS identity must be an opaque device ID"
    ));
    let meta = server.cleartext_headers();
    notes.push(format!("PrivateMessage cleartext header the server can parse: {meta}"));
    let sizes = server.text_sizes();
    let lens: Vec<usize> = TEXTS.iter().map(|t| t.len()).collect();
    notes.push(format!(
        "ciphertext sizes for texts of {lens:?} bytes with padding_size 64: {sizes:?}; length leaks only in 64-byte steps, and the sender's leaf index is inside the encrypted sender data"
    ));
    notes.push("push payloads carry only the conversation id and queue cursor".into());
    Ok(notes)
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}
