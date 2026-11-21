//! Cross-runtime steps: one process per step, state passed as files.
//!
//! `scripts/cross-runtime.sh` runs the same steps alternately in the native
//! binary and in the wasm32 build (wasm-bindgen, OpenMLS `js` feature) under
//! Node, so a group created in one runtime is joined, read and answered in
//! the other. This is the closest Linux-only stand-in for "Kotlin phone and
//! browser/Expo parent run the same Rust core". It does not exercise Android,
//! iOS, a browser or their key storage.
//!
//! Steps:
//!   keygen <id>              new device, publish a key package
//!   create <id> <peer>       create a group, add peer, send a text
//!   reply  <id> <peer>       join from the Welcome, read, answer
//!   read   <id>              read the answer

use std::collections::BTreeMap;

use crate::world::*;

/// File name -> content. The native CLI maps it to a directory; the wasm
/// export receives and returns it as bytes.
pub type Files = BTreeMap<String, Vec<u8>>;

fn runtime() -> &'static str {
    if cfg!(target_family = "wasm") {
        "wasm32 in Node"
    } else {
        "native"
    }
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex")).collect()
}

/// `[u32 name len][name][u32 data len][data]...`
pub fn encode(files: &Files) -> Vec<u8> {
    let mut out = vec![];
    for (k, v) in files {
        out.extend_from_slice(&(k.len() as u32).to_be_bytes());
        out.extend_from_slice(k.as_bytes());
        out.extend_from_slice(&(v.len() as u32).to_be_bytes());
        out.extend_from_slice(v);
    }
    out
}

pub fn decode(b: &[u8]) -> Files {
    let mut files = Files::new();
    let mut i = 0;
    let take = |i: &mut usize| {
        let n = u32::from_be_bytes(b[*i..*i + 4].try_into().expect("len")) as usize;
        let v = b[*i + 4..*i + 4 + n].to_vec();
        *i += 4 + n;
        v
    };
    while i < b.len() {
        let k = String::from_utf8(take(&mut i)).expect("name");
        let v = take(&mut i);
        files.insert(k, v);
    }
    files
}

fn load_roster(files: &Files) -> Roster {
    let r = Roster::default();
    if let Some(s) = files.get("roster.txt") {
        for line in String::from_utf8_lossy(s).lines() {
            if let Some((id, k)) = line.split_once(' ') {
                r.borrow_mut().insert(id.to_string(), unhex(k));
            }
        }
    }
    r
}

fn save_roster(files: &mut Files, r: &Roster) {
    let mut lines: Vec<String> = r.borrow().iter().map(|(id, k)| format!("{id} {}", hex(k))).collect();
    lines.sort();
    files.insert("roster.txt".into(), (lines.join("\n") + "\n").into_bytes());
}

fn deliver(files: &mut Files, server: &mut Server, to: &str) {
    for it in server.take_queue(to) {
        files.insert(format!("inbox-{to}-{:06}.bin", it.seq), it.body);
    }
}

fn receive(files: &mut Files, d: &mut Device) -> Result<Vec<String>, String> {
    let prefix = format!("inbox-{}-", d.id);
    let names: Vec<String> = files.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
    let mut texts = vec![];
    for n in names {
        let body = files.remove(&n).expect("present");
        if let Some(t) = d.process_raw(&body)? {
            texts.push(t);
        }
    }
    Ok(texts)
}

/// Run one step against `files`; returns a log line.
pub fn run(args: &[String], files: &mut Files) -> Result<String, String> {
    let step = args.first().ok_or("missing step")?.as_str();
    let id = args.get(1).ok_or("missing id")?.clone();
    let roster = load_roster(files);
    let log = match step {
        "keygen" => {
            let d = Device::new(&id, &roster);
            save_roster(files, &roster);
            files.insert(format!("kp-{id}.bin"), d.key_package());
            d.save(files);
            format!("[{}] {id}: keys and key package written", runtime())
        }
        "create" => {
            let peer = args.get(2).ok_or("missing peer")?;
            let mut d = Device::load(files, &id, &roster)?;
            let mut server = Server::new();
            server.roster = roster.clone();
            let kp = files.get(&format!("kp-{peer}.bin")).ok_or("no peer key package")?.clone();
            server.key_packages.insert(peer.clone(), kp);
            d.create_group(&mut server)?;
            let kp = server.fetch_key_package(peer)?;
            d.add(&mut server, &[kp])?;
            d.send(&mut server, &format!("SYNTH-CANARY hello from {}", runtime()))?;
            deliver(files, &mut server, peer);
            d.save(files);
            format!("[{}] {id}: group created, {peer} added after the roster check, text sent", runtime())
        }
        "reply" => {
            let peer = args.get(2).ok_or("missing peer")?;
            let mut d = Device::load(files, &id, &roster)?;
            let texts = receive(files, &mut d)?;
            if !texts.iter().any(|t| t.starts_with("SYNTH-CANARY hello from")) {
                return Err(format!("expected a hello, got {texts:?}"));
            }
            let mut server = Server::new();
            server.roster = roster.clone();
            d.send(&mut server, &format!("SYNTH-CANARY reply from {}", runtime()))?;
            deliver(files, &mut server, peer);
            d.save(files);
            format!("[{}] {id}: joined from the Welcome, read {texts:?}, replied", runtime())
        }
        "read" => {
            let mut d = Device::load(files, &id, &roster)?;
            let texts = receive(files, &mut d)?;
            if !texts.iter().any(|t| t.starts_with("SYNTH-CANARY reply from")) {
                return Err(format!("expected a reply, got {texts:?}"));
            }
            d.save(files);
            format!("[{}] {id}: read {texts:?}", runtime())
        }
        other => return Err(format!("unknown step {other}")),
    };
    Ok(log)
}

/// Native CLI: `cross <dir> <step> <id> [peer]`.
#[cfg(not(target_family = "wasm"))]
pub fn run_dir(args: &[String]) -> Result<(), String> {
    use std::fs;
    let dir = std::path::PathBuf::from(args.first().ok_or("missing dir")?);
    let mut files = Files::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let p = e.map_err(|e| e.to_string())?.path();
        files.insert(p.file_name().unwrap().to_string_lossy().to_string(), fs::read(&p).map_err(|e| e.to_string())?);
    }
    let before: Vec<String> = files.keys().cloned().collect();
    let log = run(&args[1..], &mut files)?;
    for name in before {
        if !files.contains_key(&name) {
            fs::remove_file(dir.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    for (k, v) in &files {
        fs::write(dir.join(k), v).map_err(|e| e.to_string())?;
    }
    println!("{log}");
    Ok(())
}
