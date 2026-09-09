//! Sidecar integrity verification via SHA-256.
//!
//! Security model:
//! - At build time, a manifest (`sidecar-hashes.json`) is generated containing
//!   the SHA-256 digest of each sidecar binary.
//! - At spawn time, the actual file digest is computed and compared.
//! - Mismatch → refuse to spawn, return a clear error.
//! - Debug builds also fail closed unless an explicit development-only opt-in
//!   is present.
//!
//! Limitations (documented, not hidden):
//! - Embedded digests can be modified by an advanced attacker with file access.
//!   This raises tampering cost, it is NOT an absolute trust root.
//! - Windows Authenticode code signing requires a certificate; without one,
//!   this is the best available integrity check. Recorded as external release
//!   blocker for production distribution.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;

const ALLOW_UNVERIFIED_SIDECARS_ENV: &str = "TEACHER_AGENT_ALLOW_UNVERIFIED_SIDECARS";
const ALLOW_UNVERIFIED_SIDECARS_UI_ENV: &str = "VITE_ALLOW_UNVERIFIED_SIDECARS";

/// Compute SHA-256 hex digest of a file.
pub(crate) fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("无法读取 sidecar 文件: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hex::encode(hasher.finalize()))
}

/// Load the sidecar hash manifest from the given directory.
/// Returns None only when the manifest does not exist. Malformed or unreadable
/// manifests are integrity failures and can never be bypassed as "missing".
fn load_hash_manifest(dir: &Path) -> Result<Option<HashMap<String, String>>, String> {
    let manifest_path = dir.join("sidecar-hashes.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|_| "sidecar 完整性校验失败：manifest 无法读取。".to_string())?;
    let manifest = serde_json::from_str(&content)
        .map_err(|_| "sidecar 完整性校验失败：manifest 格式无效。".to_string())?;
    Ok(Some(manifest))
}

/// Verify sidecar integrity before spawn.
///
/// - If a `sidecar-hashes.json` manifest exists in the same directory as the
///   sidecar, the file's SHA-256 is computed and compared against the expected
///   digest. Mismatch returns Err.
/// - If no manifest exists (dev mode), verification is skipped and Ok is returned.
///
/// The `sidecar_name` should be the base name used in the manifest
/// (e.g., "code-worker-x86_64-pc-windows-msvc.exe").
pub(crate) fn verify_sidecar_integrity(
    sidecar_path: &Path,
    sidecar_name: &str,
) -> Result<(), String> {
    verify_sidecar_integrity_with_policy(
        sidecar_path,
        sidecar_name,
        cfg!(debug_assertions),
        std::env::var(ALLOW_UNVERIFIED_SIDECARS_ENV).as_deref() == Ok("1")
            && std::env::var(ALLOW_UNVERIFIED_SIDECARS_UI_ENV).as_deref() == Ok("1"),
    )
}

fn verify_sidecar_integrity_with_policy(
    sidecar_path: &Path,
    sidecar_name: &str,
    debug_build: bool,
    explicit_debug_opt_in: bool,
) -> Result<(), String> {
    let dir = sidecar_path
        .parent()
        .ok_or_else(|| "无法确定 sidecar 目录".to_string())?;

    let manifest = match load_hash_manifest(dir)? {
        Some(m) => m,
        None => {
            if debug_build && explicit_debug_opt_in {
                eprintln!(
                    "[TeacherAgent][SECURITY WARNING] Debug 开发模式显式允许未校验 sidecar；禁止分发此构建"
                );
                return Ok(());
            }
            return Err(format!(
                "sidecar 完整性校验失败：未找到 sidecar-hashes.json。Debug 开发需同时设置 {ALLOW_UNVERIFIED_SIDECARS_ENV}=1 与 {ALLOW_UNVERIFIED_SIDECARS_UI_ENV}=1；Release 不允许绕过。({sidecar_name})"
            ));
        }
    };

    let expected_hash = manifest.get(sidecar_name).ok_or_else(|| {
        format!(
            "sidecar 完整性校验失败：manifest 中未找到 \"{sidecar_name}\" 的预期摘要。请重新构建安装包。"
        )
    })?;

    let actual_hash = compute_file_sha256(sidecar_path)?;

    if &actual_hash != expected_hash {
        return Err(format!(
            "sidecar 完整性校验失败：\"{sidecar_name}\" 的文件摘要与预期不符。文件可能已被篡改。请重新安装。"
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn compute_sha256_known_value() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("sha256-test-{}.bin", std::process::id()));
        {
            let mut f = std::fs::File::create(&path).unwrap();
            f.write_all(b"hello world").unwrap();
        }
        let hash = compute_file_sha256(&path).unwrap();
        // SHA-256 of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn verify_passes_with_correct_manifest() {
        let dir = std::env::temp_dir().join(format!("sidecar-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // Create a fake sidecar
        let sidecar_path = dir.join("test-worker.exe");
        std::fs::write(&sidecar_path, b"fake binary content").unwrap();

        // Compute its hash and write manifest
        let hash = compute_file_sha256(&sidecar_path).unwrap();
        let manifest: HashMap<String, String> = [("test-worker.exe".to_string(), hash)]
            .into_iter()
            .collect();
        let manifest_json = serde_json::to_string(&manifest).unwrap();
        std::fs::write(dir.join("sidecar-hashes.json"), manifest_json).unwrap();

        // Verification should pass
        assert!(verify_sidecar_integrity(&sidecar_path, "test-worker.exe").is_ok());

        // Tamper with the file
        std::fs::write(&sidecar_path, b"tampered content").unwrap();
        let result = verify_sidecar_integrity(&sidecar_path, "test-worker.exe");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("篡改"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_rejects_when_no_manifest_by_default() {
        let dir = std::env::temp_dir().join(format!("sidecar-nomanifest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let sidecar_path = dir.join("worker.exe");
        std::fs::write(&sidecar_path, b"content").unwrap();

        assert!(
            verify_sidecar_integrity_with_policy(&sidecar_path, "worker.exe", true, false).is_err()
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn debug_requires_explicit_opt_in_and_release_never_bypasses() {
        let dir = std::env::temp_dir().join(format!("sidecar-debug-policy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sidecar_path = dir.join("worker.exe");
        std::fs::write(&sidecar_path, b"content").unwrap();

        assert!(
            verify_sidecar_integrity_with_policy(&sidecar_path, "worker.exe", true, true).is_ok()
        );
        assert!(
            verify_sidecar_integrity_with_policy(&sidecar_path, "worker.exe", false, true).is_err()
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_manifest_is_never_treated_as_missing() {
        let dir =
            std::env::temp_dir().join(format!("sidecar-malformed-manifest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sidecar_path = dir.join("worker.exe");
        std::fs::write(&sidecar_path, b"content").unwrap();
        std::fs::write(dir.join("sidecar-hashes.json"), b"not-json").unwrap();

        assert!(
            verify_sidecar_integrity_with_policy(&sidecar_path, "worker.exe", true, true)
                .unwrap_err()
                .contains("格式无效")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
