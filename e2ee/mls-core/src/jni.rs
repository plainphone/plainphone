//! JNI entry point for `org.plainphone.app.e2ee.MlsCore.call(ByteArray): ByteArray`
//! (android/app/src/debug/java/org/plainphone/app/e2ee/MlsCore.kt).
//!
//! The only unsafe code in the crate. It copies the request out of the Java
//! array, calls `api::call` (which catches panics), copies the response into
//! a new Java array and zeroes both Rust buffers. A failed JNI call returns
//! null with the Java exception left pending, which Kotlin then throws.

use std::ptr::null_mut;

use jni_sys::{jbyte, jbyteArray, jclass, jsize, JNIEnv};
use zeroize::Zeroize;

#[no_mangle]
pub extern "system" fn Java_org_plainphone_app_e2ee_MlsCore_call(
    env: *mut JNIEnv,
    _class: jclass,
    request: jbyteArray,
) -> jbyteArray {
    // SAFETY: the JVM passes a valid env and a byte[] (Kotlin declares the parameter non-null).
    // Every function pointer comes from the JVM's own interface table.
    unsafe {
        let f = &**env;
        let (Some(len_of), Some(get), Some(new), Some(set), Some(pending)) =
            (f.GetArrayLength, f.GetByteArrayRegion, f.NewByteArray, f.SetByteArrayRegion, f.ExceptionCheck)
        else {
            return null_mut();
        };
        if request.is_null() {
            return null_mut();
        }
        let len = len_of(env, request);
        let mut input = vec![0u8; len.max(0) as usize];
        get(env, request, 0, len, input.as_mut_ptr() as *mut jbyte);
        if pending(env) != 0 {
            input.zeroize();
            return null_mut();
        }
        let mut output = crate::api::call(&input);
        input.zeroize();
        let Ok(out_len) = jsize::try_from(output.len()) else {
            output.zeroize();
            return null_mut();
        };
        let array = new(env, out_len);
        if !array.is_null() {
            set(env, array, 0, out_len, output.as_ptr() as *const jbyte);
        }
        output.zeroize();
        array
    }
}
