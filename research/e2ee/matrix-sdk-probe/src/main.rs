//! Scenarios that measure matrix-sdk-crypto's own defaults. See lib.rs.

use matrix_sdk_crypto::CollectStrategy;
use matrix_sdk_probe::*;

type Res = Result<Vec<String>, String>;

fn main() {
    let scenarios: Vec<(&str, fn() -> Res)> = vec![
        ("SDK roundtrip, 3 users / 4 devices", roundtrip),
        ("SDK rotation after a device is deleted", rotation),
        ("SDK default sharing with a server-injected device", injected_device),
        ("SDK unable-to-decrypt, then retry", utd_retry),
        ("SDK duplicate and replayed events", replay),
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

struct Family {
    hs: Homeserver,
    pa: Client,
    tab: Client,
    pb: Client,
    cp: Client,
    members: Vec<ruma::OwnedUserId>,
}

fn family() -> Family {
    let mut hs = Homeserver::default();
    let pa = hs.new_client("parent-a", "PAPHONE");
    let tab = hs.new_client("parent-a", "PATABLET");
    let pb = hs.new_client("parent-b", "PBPHONE");
    let cp = hs.new_client("child", "CHILDPHONE");
    let members = vec![user("parent-a"), user("parent-b"), user("child")];
    Family { hs, pa, tab, pb, cp, members }
}

fn roundtrip() -> Res {
    let mut f = family();
    let e1 = f.hs.send(&f.pa, &f.members, "SYNTH-CANARY dinner at six", CollectStrategy::AllDevices);
    let e2 = f.hs.send(&f.cp, &f.members, "SYNTH-CANARY I'm home", CollectStrategy::AllDevices);
    for c in [&f.pb, &f.cp, &f.tab] {
        f.hs.sync(c);
        f.hs.decrypt(c, &e1)?;
    }
    for c in [&f.pa, &f.pb, &f.tab] {
        f.hs.sync(c);
        f.hs.decrypt(c, &e2)?;
    }
    let leaks = f.hs.seen.iter().filter(|s| s.contains("SYNTH-CANARY")).count();
    if leaks > 0 {
        return Err(format!("{leaks} server-visible items contain plaintext"));
    }
    Ok(vec![format!(
        "OlmMachine 0.19.1 with MemoryStore, driven only through its public API against an in-process homeserver: every device read both texts; {} server-visible items, no plaintext canary",
        f.hs.seen.len()
    )])
}

fn rotation() -> Res {
    let mut f = family();
    let e1 = f.hs.send(&f.pb, &f.members, "SYNTH-CANARY 1", CollectStrategy::AllDevices);
    f.hs.sync(&f.tab);
    f.hs.decrypt(&f.tab, &e1)?;
    f.hs.delete_device(&user("parent-a"), "PATABLET");
    let e2 = f.hs.send(&f.pb, &f.members, "SYNTH-CANARY 2 after the tablet is gone", CollectStrategy::AllDevices);
    let rotated = session_id(&e1) != session_id(&e2);
    f.hs.sync(&f.tab);
    let tab_reads = f.hs.decrypt(&f.tab, &e2).is_ok();
    f.hs.sync(&f.cp);
    f.hs.decrypt(&f.cp, &e2)?;
    if !rotated || tab_reads {
        return Err(format!("rotated {rotated}, tablet reads {tab_reads}"));
    }
    Ok(vec![
        "after the server deletes the tablet and announces the device-list change, parent B's next share rotates the Megolm session (new session id) and the tablet cannot read the new text (measured)".into(),
        "the trigger is the server's device list: a server that keeps listing the tablet keeps it in the share, the same stale-roster gap the vodozemac harness shows".into(),
    ])
}

fn injected_device() -> Res {
    let mut notes = vec![];
    // 1. Another user's device keys listed under the child: refused.
    let mut f = family();
    let attacker = f.hs.new_client("attacker", "CHILDPHONE2");
    f.hs.inject_device(&user("child"), &attacker);
    let ev = f.hs.send(&f.pa, &f.members, "SYNTH-CANARY meet at the gate", CollectStrategy::AllDevices);
    f.hs.sync(&attacker);
    let leaked = f.hs.decrypt(&attacker, &ev).is_ok();
    notes.push(format!(
        "server lists another user's signed device keys under the child's user ID: the SDK ignores them (the user and device IDs are inside the signed keys); attacker reads: {leaked}"
    ));
    if leaked {
        return Err("cross-user injection leaked".into());
    }

    // 2. The operator logs in as the child and adds a device: shared.
    let mut f = family();
    let attacker = f.hs.new_client("child", "CHILDPHONE2");
    let ev = f.hs.send(&f.pa, &f.members, "SYNTH-CANARY meet at the gate", CollectStrategy::AllDevices);
    f.hs.sync(&attacker);
    let leaked = f.hs.decrypt(&attacker, &ev).is_ok();
    notes.push(format!(
        "the homeserver operator registers a new device on the child's own account: with the SDK default (CollectStrategy::AllDevices) parent A shares the room key with it, and the server-held device reads: {leaked} (measured)"
    ));
    if !leaked {
        return Err("expected the default strategy to share with a new device of the child".into());
    }

    // 3. Roster-based trust.
    let mut f = family();
    f.hs.sync(&f.pa);
    let _ = f.hs.send(&f.pa, &f.members, "SYNTH-CANARY warm-up", CollectStrategy::OnlyTrustedDevices);
    for (u, d) in [("parent-a", "PATABLET"), ("parent-b", "PBPHONE"), ("child", "CHILDPHONE")] {
        trust(&f.pa, &user(u), d);
    }
    let attacker = f.hs.new_client("child", "CHILDPHONE2");
    let ev = f.hs.send(&f.pa, &f.members, "SYNTH-CANARY meet at the gate", CollectStrategy::OnlyTrustedDevices);
    f.hs.sync(&attacker);
    let leaked = f.hs.decrypt(&attacker, &ev).is_ok();
    f.hs.sync(&f.cp);
    let child_reads = f.hs.decrypt(&f.cp, &ev).is_ok();
    notes.push(format!(
        "with CollectStrategy::OnlyTrustedDevices and parent A marking exactly the household-log devices as locally verified, the injected device reads: {leaked}, the real child reads: {child_reads}. This is the integration hook for the Plainphone roster"
    ));
    if leaked || !child_reads {
        return Err("roster-based trust did not hold".into());
    }
    Ok(notes)
}

fn utd_retry() -> Res {
    let mut f = family();
    let ev = f.hs.send(&f.pa, &f.members, "SYNTH-CANARY key arrives late", CollectStrategy::AllDevices);
    let first = f.hs.decrypt(&f.cp, &ev);
    f.hs.sync(&f.cp);
    let second = f.hs.decrypt(&f.cp, &ev);
    if first.is_ok() || second.is_err() {
        return Err("unexpected UTD behaviour".into());
    }
    Ok(vec![format!(
        "decrypt before the to-device key: error ({}); after the sync: ok. The app must keep and retry undecryptable events",
        first.unwrap_err()
    )])
}

fn replay() -> Res {
    let mut f = family();
    let ev = f.hs.send(&f.pa, &f.members, "SYNTH-CANARY once", CollectStrategy::AllDevices);
    f.hs.sync(&f.cp);
    f.hs.decrypt(&f.cp, &ev)?;
    let same = f.hs.decrypt(&f.cp, &ev);
    let replayed = ev.replace("\"$ev1\"", "\"$ev99\"").replace("1000001", "1000099");
    let other = f.hs.decrypt(&f.cp, &replayed);
    Ok(vec![
        format!("the same event (same event id) decrypted again: {}", if same.is_ok() { "ok, idempotent".to_string() } else { same.unwrap_err() }),
        format!(
            "the same ciphertext re-sent by the server under a new event id: {}",
            match other {
                Ok(_) => "accepted (measured): the app must dedupe by session id and message index".to_string(),
                Err(e) => format!("rejected ({e})"),
            }
        ),
    ])
}
