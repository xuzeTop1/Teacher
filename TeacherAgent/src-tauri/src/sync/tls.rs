//! TLS identity management for the LAN sync server.
//!
//! The self-signed certificate and its private key are generated on first
//! use and stored in the OS credential store (keyring), following the
//! project convention that TeacherAgent secrets live in the system keychain.
//! The pin exposed to the phone is SHA-256 of the certificate's
//! SubjectPublicKeyInfo (SPKI) DER — the same bytes Android produces from
//! `PublicKey.getEncoded()`.

use sha2::Digest;

const KEYCHAIN_SERVICE: &str = "teacher-agent:sync-tls";
const KEYCHAIN_ACCOUNT: &str = "tls-identity";

#[derive(Debug, Clone)]
pub(crate) struct TlsIdentity {
    /// DER-encoded X.509 certificate.
    pub(crate) cert_der: Vec<u8>,
    /// DER-encoded PKCS#8 private key.
    pub(crate) key_der: Vec<u8>,
    /// Hex SHA-256 of the SPKI DER (certificate pin).
    pub(crate) spki_pin_hex: String,
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|error| format!("invalid base64 in keychain: {error}"))
}

fn save_identity(identity: &TlsIdentity) -> Result<(), String> {
    let cert_b64 = base64_encode(&identity.cert_der);
    let key_b64 = base64_encode(&identity.key_der);
    let combined = format!("cert:{cert_b64}\nkey:{key_b64}");
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;
    entry
        .set_password(&combined)
        .map_err(|error| format!("failed to save TLS identity to keychain: {error}"))
}

fn load_identity_from_keychain() -> Result<Option<TlsIdentity>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("failed to open keychain entry: {error}"))?;
    let stored = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to load TLS identity from keychain: {error}"
            ))
        }
    };
    let cert_b64 = stored
        .lines()
        .find_map(|line| line.strip_prefix("cert:"))
        .ok_or_else(|| "keychain TLS identity format invalid".to_string())?;
    let key_b64 = stored
        .lines()
        .find_map(|line| line.strip_prefix("key:"))
        .ok_or_else(|| "keychain TLS identity format invalid".to_string())?;
    let cert_der = base64_decode(cert_b64)?;
    let key_der = base64_decode(key_b64)?;
    let pin = spki_pin_hex(&cert_der)?;
    Ok(Some(TlsIdentity {
        cert_der,
        key_der,
        spki_pin_hex: pin,
    }))
}

/// SHA-256 of the certificate's SubjectPublicKeyInfo (DER), lowercase hex.
pub(crate) fn spki_pin_hex(cert_der: &[u8]) -> Result<String, String> {
    let (_, cert) = x509_parser::parse_x509_certificate(cert_der)
        .map_err(|error| format!("failed to parse generated certificate: {error}"))?;
    let spki = cert.tbs_certificate.subject_pki.raw;
    let digest = sha2::Sha256::digest(spki);
    Ok(hex::encode(digest))
}

/// Generates a fresh self-signed leaf certificate (pure; no keychain I/O).
/// The phone pins the SPKI hash, so SAN contents are informational only.
pub(crate) fn generate_identity(host_hint: Option<&str>) -> Result<TlsIdentity, String> {
    let mut san: Vec<String> = vec!["localhost".to_string(), "teacher-agent.local".to_string()];
    if let Some(host) = host_hint {
        if !san.iter().any(|item| item == host) {
            san.push(host.to_string());
        }
    }
    let certified_key = rcgen::generate_simple_self_signed(san)
        .map_err(|error| format!("failed to generate self-signed certificate: {error}"))?;
    let cert_der = certified_key.cert.der().to_vec();
    let key_der: Vec<u8> = certified_key.key_pair.serialize_der();
    let pin = spki_pin_hex(&cert_der)?;
    Ok(TlsIdentity {
        cert_der,
        key_der,
        spki_pin_hex: pin,
    })
}

/// Loads the stored TLS identity or generates and persists a fresh one.
pub(crate) fn load_or_create_identity(host_hint: Option<&str>) -> Result<TlsIdentity, String> {
    if let Some(identity) = load_identity_from_keychain()? {
        return Ok(identity);
    }
    let identity = generate_identity(host_hint)?;
    save_identity(&identity)?;
    Ok(identity)
}

/// Ensures a rustls CryptoProvider is installed process-wide (idempotent).
pub(crate) fn ensure_crypto_provider() {
    if rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .is_err()
    {
        // Already installed (or another provider won the race) — fine.
    }
}

/// Builds a rustls server config from the identity.
pub(crate) fn build_server_config(identity: &TlsIdentity) -> Result<rustls::ServerConfig, String> {
    ensure_crypto_provider();
    use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

    let cert = CertificateDer::from(identity.cert_der.clone());
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(identity.key_der.clone()));
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .map_err(|error| format!("failed to configure TLS: {error}"))?;
    Ok(config)
}

/// KeyPair serialize_der convenience used by tests: parse a PKCS#8 DER into
/// an rcgen KeyPair (validates the material actually is a key).
#[cfg(test)]
pub(crate) fn validate_key_der(key_der: &[u8]) -> Result<(), String> {
    use rcgen::KeyPair;
    KeyPair::try_from(key_der)
        .map(|_| ())
        .map_err(|error| format!("invalid private key: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_identity_produces_stable_pin() {
        // Pure generation; never touches the real keychain.
        let identity = generate_identity(None).expect("identity");
        assert_eq!(identity.spki_pin_hex.len(), 64);
        validate_key_der(&identity.key_der).expect("key is valid PKCS#8");

        // The pin must be stable for the same certificate.
        let pin_again = spki_pin_hex(&identity.cert_der).expect("pin");
        assert_eq!(pin_again, identity.spki_pin_hex);
    }

    #[test]
    fn pin_is_spki_sha256_of_expected_length() {
        let identity = generate_identity(Some("192.168.1.50")).expect("identity");
        assert_eq!(identity.spki_pin_hex.len(), 64);
        // hex decode must succeed -> it really is hex.
        let bytes = hex::decode(&identity.spki_pin_hex).expect("hex");
        assert_eq!(bytes.len(), 32);
    }

    #[test]
    fn server_config_builds_from_identity() {
        ensure_crypto_provider();
        let identity = generate_identity(None).expect("identity");
        let config = build_server_config(&identity).expect("server config");
        // A freshly built config has no fragment-size override and no client
        // auth requirement (with_no_client_auth).
        assert!(config.max_fragment_size.is_none());
    }
}
