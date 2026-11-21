//! Library half of the Matrix-crypto harness.

pub mod world;

/// Two devices exchange one text each way over Olm-shared Megolm sessions.
/// Exported over the C ABI so the Android size build keeps the whole path
/// and a later real-device probe can call it.
pub fn selftest() -> Result<(), String> {
    let mut server = world::Server::default();
    let mut a = world::Device::new("parent-a-phone", &mut server);
    let mut c = world::Device::new("child-phone", &mut server);
    a.send(&mut server, "SYNTH-CANARY hello")?;
    if c.sync(&mut server).len() != 1 {
        return Err(format!("child could not read: {:?}", c.last_errors));
    }
    c.send(&mut server, "SYNTH-CANARY reply")?;
    if a.sync(&mut server).len() != 1 {
        return Err(format!("parent could not read: {:?}", a.last_errors));
    }
    let p = c.pickle();
    world::Device::unpickle("child-phone", server.roster.clone(), &p)?;
    Ok(())
}

#[no_mangle]
pub extern "C" fn plainphone_matrix_selftest() -> i32 {
    match selftest() {
        Ok(()) => 0,
        Err(_) => 1,
    }
}
