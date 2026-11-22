//! Line-delimited JSON driver around `plainphone_mls::call`, for the scripted
//! demo (scripts/e2ee-prototype-demo.sh). One request per stdin line, one
//! response per stdout line. It never logs anything itself.
//!
//! `pp-mls selftest` runs the built-in two-device check and exits 0 on success.

use std::io::{BufRead, Write};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("selftest") {
        match plainphone_mls::selftest() {
            Ok(()) => println!("selftest ok"),
            Err(e) => {
                eprintln!("selftest failed: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let out = plainphone_mls::call(line.as_bytes());
        if stdout.write_all(&out).and_then(|_| stdout.write_all(b"\n")).and_then(|_| stdout.flush()).is_err() {
            break;
        }
    }
}
