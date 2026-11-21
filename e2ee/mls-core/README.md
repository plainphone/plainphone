# plainphone-mls: OpenMLS core (E2EE phase 0 prototype)

Prototype for issue #120. Test data only. The design, threat model and gaps
are in [docs/e2ee-prototype.md](../../docs/e2ee-prototype.md). No release build
links this crate.

One entry point, `plainphone_mls::call(request: &[u8]) -> Vec<u8>`: a JSON
request with an `op`, a JSON response with `ok`. Byte fields are unpadded
base64url. Every binding is a thin wrapper around it.

| File | What it holds |
|---|---|
| `src/api.rs` | The request types and the dispatcher; catches panics |
| `src/client.rs` | One MLS device: group settings and every Plainphone check |
| `src/roster.rs` | The roster and the `mls-leaf` binding signature |
| `src/error.rs` | Error codes that never carry keys or plaintext |
| `src/jni.rs` | `Java_org_plainphone_app_e2ee_MlsCore_call` (feature `jni`) |
| `src/bin/pp-mls.rs` | Line-delimited JSON over stdin/stdout, for the demo |
| `tests/scenarios.rs` | 14 scenarios through `call` |
| `tests/vectors.rs` | Checks (and with `PLAINPHONE_WRITE_VECTORS=1` rewrites) `docs/encryption-test-vectors/mls-prototype.json` |
| `scripts/build-android.sh` | arm64-v8a `.so` for the debug APK |

## Operations

| `op` | Fields | Answer |
|---|---|---|
| `new_client` | `deviceId` | `handle`, `mlsSignPub` |
| `binding_input` | `deviceId`, `mlsSignPub` | `input`: the bytes the household-log key signs |
| `set_roster` | `handle`, `version`, `roster: [{deviceId, role, logSignPub, mlsSignPub, binding}]` | `accepted` |
| `key_packages` | `handle`, `count`, `lastResort?` | `keyPackages`, `lastResort` |
| `create_group` | `handle` | `groupId`, `epoch`, `members` |
| `add_members` | `handle`, `groupId`, `keyPackages` | pending commit: `epoch`, `commit`, `welcome`, `members`, `added`, `removed` |
| `remove_members` | `handle`, `groupId`, `deviceIds` | pending commit |
| `update` | `handle`, `groupId` | pending commit (key rotation) |
| `merge_pending` / `clear_pending` | `handle`, `groupId` | after the server's 201 / 409 |
| `encrypt` | `handle`, `groupId`, `messageId`, `text` | `message`, `epoch` |
| `process` | `handle`, `message` | an event: `joined`, `commit`, `removed`, `text` or `duplicate` |
| `members` | `handle`, `groupId` | `epoch`, `members`, `notInRoster`, `trusted` |
| `export_state` / `import_state` | `handle` / `state` | the whole device state, **private keys in clear** |
| `free`, `selftest` | | |

## Build and test

```sh
cargo test --locked --release
cargo clippy --locked --release --all-targets --features jni
cargo fmt --check
```

Versions are pinned with `=` and `Cargo.lock` is committed. The tree is the
research harness's (research/e2ee/mls-harness), including its pinned-back
crates, plus `jni-sys` 0.3.0 for the JNI types. The phone uses a hand-written
JNI function instead of the recommendation's UniFFI; the reasons are in
[docs/e2ee-prototype.md](../../docs/e2ee-prototype.md#design-as-built)
("Why JNI and not UniFFI").
