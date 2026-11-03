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
    // Manifest 由 PowerShell 生成，而 Windows PowerShell 5.1 的
    // `Set-Content -Encoding UTF8` 会写出**带 BOM** 的 UTF-8；serde_json 不接受
    // 前导 BOM，会报"格式无效"。这里剥离 BOM —— 读取端容错比要求每个生成脚本各自小心更可靠。
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);
    let manifest = serde_json::from_str(content)
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

    /// 发布产物目录。`cargo test` 的工作目录是包根（`src-tauri/`），
    /// 因此这里用相对路径，避免把构建机绝对路径写进测试二进制。
    fn release_dir() -> std::path::PathBuf {
        std::path::Path::new("target").join("release")
    }

    /// 正对照：未篡改的真实发布 sidecar 必须通过 release 策略校验。
    ///
    /// 没有这条，下面"篡改被拒"的断言可能是恒真的——如果 manifest 与产物
    /// 本来就对不上，任何副本都会被拒，篡改与否根本不影响判定。
    #[test]
    fn shipped_release_sidecar_matches_shipped_manifest() {
        let dir = release_dir();
        let sidecar = dir.join("code-worker.exe");
        if !sidecar.exists() || !dir.join("sidecar-hashes.json").exists() {
            eprintln!("[skip] 未构建 target/release，跳过真实产物负向验收");
            return;
        }
        verify_sidecar_integrity_with_policy(&sidecar, "code-worker.exe", false, false)
            .expect("未篡改的发布 sidecar 未通过校验：manifest 与产物不一致，篡改判定失去意义");
    }

    /// 篡改真实发布 sidecar 的一个字节：release 策略与真实入口都必须拒绝。
    #[test]
    fn tampered_real_sidecar_is_rejected() {
        let dir = release_dir();
        let real = dir.join("code-worker.exe");
        if !real.exists() || !dir.join("sidecar-hashes.json").exists() {
            eprintln!("[skip] 未构建 target/release，跳过真实产物篡改验收");
            return;
        }

        let work = std::env::temp_dir().join(format!("sidecar-tamper-{}", std::process::id()));
        std::fs::create_dir_all(&work).unwrap();
        std::fs::copy(
            dir.join("sidecar-hashes.json"),
            work.join("sidecar-hashes.json"),
        )
        .unwrap();
        let victim = work.join("code-worker.exe");
        std::fs::copy(&real, &victim).unwrap();

        // 副本未篡改时先过一次，确保后续拒绝不是"目录搬错了"
        verify_sidecar_integrity_with_policy(&victim, "code-worker.exe", false, false)
            .expect("未篡改的副本未通过校验，篡改判定不可信");

        let mut bytes = std::fs::read(&victim).unwrap();
        let mid = bytes.len() / 2;
        bytes[mid] ^= 0xff;
        std::fs::write(&victim, &bytes).unwrap();

        let policy_err =
            verify_sidecar_integrity_with_policy(&victim, "code-worker.exe", false, false)
                .expect_err("release 策略未拒绝被篡改的真实 sidecar");
        assert!(
            policy_err.contains("篡改"),
            "错误信息未指明篡改: {policy_err}"
        );

        let entry_err = verify_sidecar_integrity(&victim, "code-worker.exe")
            .expect_err("真实入口未拒绝被篡改的 sidecar");
        assert!(
            entry_err.contains("篡改"),
            "错误信息未指明篡改: {entry_err}"
        );

        let _ = std::fs::remove_dir_all(&work);
    }

    /// Release 下 manifest 缺失时必须拒绝，且两个绕过开关同时打开也不生效。
    ///
    /// 只在 `cargo test --release` 下存在；它被执行即证明测试目标用的是
    /// `debug_assertions = false` 的 release 配置。
    #[cfg(not(debug_assertions))]
    #[test]
    fn release_missing_manifest_rejects_even_with_both_bypass_switches() {
        let work =
            std::env::temp_dir().join(format!("sidecar-release-noManifest-{}", std::process::id()));
        std::fs::create_dir_all(&work).unwrap();
        let sidecar = work.join("code-worker.exe");
        std::fs::write(&sidecar, b"content").unwrap();

        std::env::set_var(ALLOW_UNVERIFIED_SIDECARS_ENV, "1");
        std::env::set_var(ALLOW_UNVERIFIED_SIDECARS_UI_ENV, "1");

        let err = verify_sidecar_integrity(&sidecar, "code-worker.exe")
            .expect_err("release 构建在 manifest 缺失时未拒绝");
        assert!(
            err.contains("未找到 sidecar-hashes.json"),
            "错误信息不符: {err}"
        );

        std::env::remove_var(ALLOW_UNVERIFIED_SIDECARS_ENV);
        std::env::remove_var(ALLOW_UNVERIFIED_SIDECARS_UI_ENV);
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn bom_prefixed_manifest_is_accepted() {
        // 回归：PowerShell 5.1 的 `Set-Content -Encoding UTF8` 写出带 BOM 的 JSON，
        // 读取端必须容忍——否则 App 导入文档时直接报"manifest 格式无效"（已实际发生）。
        let dir = std::env::temp_dir().join(format!("sidecar-bom-manifest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sidecar_path = dir.join("worker.exe");
        std::fs::write(&sidecar_path, b"content").unwrap();

        let hash = compute_file_sha256(&sidecar_path).unwrap();
        let manifest_json = format!("{{\"worker.exe\":\"{hash}\"}}");
        std::fs::write(
            dir.join("sidecar-hashes.json"),
            format!("\u{feff}{manifest_json}"),
        )
        .unwrap();

        assert!(
            verify_sidecar_integrity_with_policy(&sidecar_path, "worker.exe", false, false).is_ok()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
