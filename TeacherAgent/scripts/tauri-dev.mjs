import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const env = { ...process.env }
// Already-running terminals may predate a Windows environment-variable change.
// Read only the two Rust paths, preserving explicit session overrides.
if (process.platform === "win32" && (!env.RUSTUP_HOME || !env.CARGO_HOME)) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "@{ RUSTUP_HOME=[Environment]::GetEnvironmentVariable('RUSTUP_HOME','User'); CARGO_HOME=[Environment]::GetEnvironmentVariable('CARGO_HOME','User') } | ConvertTo-Json -Compress",
  ], { encoding: "utf8", windowsHide: true })
  if (result.status === 0) {
    try {
      const paths = JSON.parse(result.stdout.replace(/^\uFEFF/, ""))
      for (const name of ["RUSTUP_HOME", "CARGO_HOME"]) {
        if (!env[name] && paths[name]) env[name] = paths[name]
      }
    } catch (error) {
      console.warn("Could not read Windows Rust environment paths:", error.message)
    }
  }
}
const require = createRequire(import.meta.url)
const result = spawnSync(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), "dev", ...process.argv.slice(2)], {
  stdio: "inherit", env,
})
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1
