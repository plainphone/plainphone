//! The one entry point every binding uses: a JSON request in, a JSON response out.
//!
//! Keeping the binding surface to `call(bytes) -> bytes` means the JNI layer
//! (src/jni.rs), the demo CLI (src/bin/pp-mls.rs) and a future Expo or
//! wasm-bindgen module are each a few lines, and the reviewer has one API to
//! read. Requests: `{"op": "...", ...}`. Responses: `{"ok": true, ...}` or
//! `{"ok": false, "error": code, "detail": text}`. Byte fields are base64url.
//! Panics are caught and reported as `{"ok":false,"error":"panic"}`.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::b64;
use crate::client::Client;
use crate::error::Error;
use crate::roster::{binding_input, EntryIn};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
enum Request {
    NewClient {
        device_id: String,
    },
    BindingInput {
        device_id: String,
        mls_sign_pub: String,
    },
    SetRoster {
        handle: u64,
        version: u64,
        roster: Vec<EntryIn>,
    },
    KeyPackages {
        handle: u64,
        count: usize,
        #[serde(default)]
        last_resort: bool,
    },
    CreateGroup {
        handle: u64,
    },
    AddMembers {
        handle: u64,
        group_id: String,
        key_packages: Vec<String>,
    },
    RemoveMembers {
        handle: u64,
        group_id: String,
        device_ids: Vec<String>,
    },
    Update {
        handle: u64,
        group_id: String,
    },
    MergePending {
        handle: u64,
        group_id: String,
    },
    ClearPending {
        handle: u64,
        group_id: String,
    },
    Encrypt {
        handle: u64,
        group_id: String,
        message_id: String,
        text: String,
    },
    Process {
        handle: u64,
        message: String,
    },
    Members {
        handle: u64,
        group_id: String,
    },
    ExportState {
        handle: u64,
    },
    ImportState {
        state: String,
    },
    Free {
        handle: u64,
    },
    Selftest {},
}

struct Registry {
    next: u64,
    clients: HashMap<u64, Client>,
}

fn registry() -> &'static Mutex<Registry> {
    static R: OnceLock<Mutex<Registry>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Registry { next: 1, clients: HashMap::new() }))
}

fn with_client<T>(handle: u64, f: impl FnOnce(&mut Client) -> Result<T, Error>) -> Result<T, Error> {
    let mut r = registry().lock().map_err(|_| Error::new("internal", "registry lock poisoned"))?;
    let c = r.clients.get_mut(&handle).ok_or_else(|| Error::new("bad_request", "unknown handle"))?;
    f(c)
}

fn insert(client: Client) -> Result<u64, Error> {
    let mut r = registry().lock().map_err(|_| Error::new("internal", "registry lock poisoned"))?;
    let h = r.next;
    r.next += 1;
    r.clients.insert(h, client);
    Ok(h)
}

fn json_of<T: serde::Serialize>(v: T) -> Result<Value, Error> {
    serde_json::to_value(v).map_err(|_| Error::new("internal", "serialize"))
}

fn handle(req: Request) -> Result<Value, Error> {
    Ok(match req {
        Request::NewClient { device_id } => {
            let c = Client::new(&device_id)?;
            let pk = b64::encode(&c.mls_sign_pub());
            json!({ "handle": insert(c)?, "mlsSignPub": pk })
        }
        Request::BindingInput { device_id, mls_sign_pub } => {
            json!({ "input": b64::encode(&binding_input(&device_id, &b64::decode(&mls_sign_pub)?)?) })
        }
        Request::SetRoster { handle, version, roster } => {
            json!({ "accepted": with_client(handle, |c| c.set_roster(version, &roster))? })
        }
        Request::KeyPackages { handle, count, last_resort } => {
            let (kps, resort) = with_client(handle, |c| c.key_packages(count, last_resort))?;
            json!({ "keyPackages": kps, "lastResort": resort })
        }
        Request::CreateGroup { handle } => {
            let (group_id, epoch, members) = with_client(handle, |c| c.create_group())?;
            json!({ "groupId": group_id, "epoch": epoch, "members": members })
        }
        Request::AddMembers { handle, group_id, key_packages } => {
            json_of(with_client(handle, |c| c.add_members(&group_id, &key_packages))?)?
        }
        Request::RemoveMembers { handle, group_id, device_ids } => {
            json_of(with_client(handle, |c| c.remove_members(&group_id, &device_ids))?)?
        }
        Request::Update { handle, group_id } => json_of(with_client(handle, |c| c.update(&group_id))?)?,
        Request::MergePending { handle, group_id } => {
            let (epoch, members) = with_client(handle, |c| c.merge_pending(&group_id))?;
            json!({ "epoch": epoch, "members": members })
        }
        Request::ClearPending { handle, group_id } => {
            with_client(handle, |c| c.clear_pending(&group_id))?;
            json!({})
        }
        Request::Encrypt { handle, group_id, message_id, text } => {
            let (message, epoch) = with_client(handle, |c| c.encrypt(&group_id, &message_id, &text))?;
            json!({ "message": message, "epoch": epoch })
        }
        Request::Process { handle, message } => json_of(with_client(handle, |c| c.process(&message))?)?,
        Request::Members { handle, group_id } => {
            let (epoch, members, not_in_roster, trusted) = with_client(handle, |c| c.members(&group_id))?;
            json!({ "epoch": epoch, "members": members, "notInRoster": not_in_roster, "trusted": trusted })
        }
        Request::ExportState { handle } => json!({ "state": with_client(handle, |c| c.export_state())? }),
        Request::ImportState { state } => {
            let c = Client::import_state(&state)?;
            let device_id = c.device_id.clone();
            json!({ "handle": insert(c)?, "deviceId": device_id })
        }
        Request::Free { handle } => {
            let mut r = registry().lock().map_err(|_| Error::new("internal", "registry lock poisoned"))?;
            r.clients.remove(&handle);
            json!({})
        }
        Request::Selftest {} => {
            crate::selftest()?;
            json!({})
        }
    })
}

/// Handle one request. Never panics and never returns invalid JSON.
pub fn call(request: &[u8]) -> Vec<u8> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let req: Request = serde_json::from_slice(request).map_err(|_| Error::new("bad_request", "unknown op or fields"))?;
        handle(req)
    }));
    let value = match result {
        Ok(Ok(mut v)) => {
            if let Value::Object(m) = &mut v {
                m.insert("ok".into(), Value::Bool(true));
            }
            v
        }
        Ok(Err(e)) => json!({ "ok": false, "error": e.code, "detail": e.detail }),
        Err(_) => json!({ "ok": false, "error": "panic", "detail": "internal error" }),
    };
    serde_json::to_vec(&value).unwrap_or_else(|_| br#"{"ok":false,"error":"internal"}"#.to_vec())
}
