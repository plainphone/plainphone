//! Errors that are safe to hand to an app, a log or a test report.
//!
//! `detail` never carries key material, plaintext or message bytes: OpenMLS
//! errors are reduced to their variant names (`mls()`), and every other
//! detail is a fixed sentence with at most a device ID in it.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub code: &'static str,
    pub detail: String,
}

impl Error {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Error {
        Error { code, detail: detail.into() }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

/// Map an OpenMLS error to its outer variant names only, e.g.
/// `ValidationError/WrongEpoch`. Anything inside braces, quotes or numbers is dropped.
pub fn mls<E: fmt::Debug>(e: E) -> Error {
    let text = format!("{e:?}");
    let mut names = vec![];
    for part in text.split('(') {
        let ident: String = part.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
        if ident.is_empty() || !ident.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
            break;
        }
        let complete = ident.len() == part.trim_end_matches(')').len();
        names.push(ident);
        if !complete || names.len() == 3 {
            break;
        }
    }
    Error::new("mls", if names.is_empty() { "OpenMLS error".to_string() } else { names.join("/") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    #[allow(dead_code)]
    enum Inner {
        WrongEpoch,
        Secret { bytes: Vec<u8> },
    }
    #[derive(Debug)]
    #[allow(dead_code)]
    enum Outer {
        ValidationError(Inner),
        Text(String),
    }

    #[test]
    fn keeps_variant_names_only() {
        assert_eq!(mls(Outer::ValidationError(Inner::WrongEpoch)).detail, "ValidationError/WrongEpoch");
        assert_eq!(mls(Outer::ValidationError(Inner::Secret { bytes: vec![1, 2, 3] })).detail, "ValidationError/Secret");
        assert_eq!(mls(Outer::Text("SYNTH-CANARY".into())).detail, "Text");
    }
}
