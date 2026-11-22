//! Canonical unpadded base64url, as in docs/encryption.md §2.

use base64ct::{Base64UrlUnpadded, Encoding};

use crate::error::Error;

pub fn encode(bytes: &[u8]) -> String {
    Base64UrlUnpadded::encode_string(bytes)
}

/// Rejects padding, the standard alphabet and non-canonical trailing bits.
pub fn decode(text: &str) -> Result<Vec<u8>, Error> {
    let bytes = Base64UrlUnpadded::decode_vec(text).map_err(|_| Error::new("bad_request", "invalid base64url"))?;
    if encode(&bytes) != text {
        return Err(Error::new("bad_request", "non-canonical base64url"));
    }
    Ok(bytes)
}
