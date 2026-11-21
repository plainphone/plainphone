//! Library half of the OpenMLS harness, shared by the native binary and the
//! wasm32 build used for the cross-runtime check.

pub mod cross;
pub mod world;

/// Two devices: keygen, create, join, read, reply, read, all in memory.
/// Exported over the C ABI so the Android size build keeps the whole path
/// and a later real-device probe can call it.
pub fn selftest() -> Result<(), String> {
    let mut f = cross::Files::new();
    let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    cross::run(&s(&["keygen", "parent-a-phone"]), &mut f)?;
    cross::run(&s(&["keygen", "child-phone"]), &mut f)?;
    cross::run(&s(&["create", "parent-a-phone", "child-phone"]), &mut f)?;
    cross::run(&s(&["reply", "child-phone", "parent-a-phone"]), &mut f)?;
    cross::run(&s(&["read", "parent-a-phone"]), &mut f)?;
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
#[no_mangle]
pub extern "C" fn plainphone_mls_selftest() -> i32 {
    match selftest() {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(target_family = "wasm")]
mod wasm {
    use wasm_bindgen::prelude::*;

    /// Run one cross-runtime step. `files` and the result use
    /// `cross::encode`; the result starts with a u32-length-prefixed log line.
    #[wasm_bindgen]
    pub fn cross_step(args: Vec<String>, files: &[u8]) -> Result<Vec<u8>, JsValue> {
        let mut f = crate::cross::decode(files);
        let log = crate::cross::run(&args, &mut f).map_err(|e| JsValue::from_str(&e))?;
        let mut out = (log.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(log.as_bytes());
        out.extend_from_slice(&crate::cross::encode(&f));
        Ok(out)
    }
}
