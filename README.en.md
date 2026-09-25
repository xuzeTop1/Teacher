# A Privacy-First, Multi-Device Collaborative Intelligent Learning Tutoring System

[中文](README.md) | **English**

A privacy-first, local-first AI learning companion spanning desktop and Android. **TeacherAgent** provides private-document RAG, knowledge management, and intelligent tutoring, while **AlertTime** captures learning behavior and performs on-device analysis; the two coordinate over a local-network sync protocol.

## Privacy Constraints

- Raw learning records and core business data are stored on the user's local devices by default;
- Cross-device sync happens only within the user's private LAN (home Wi-Fi / phone hotspot / USB tethering), with no cloud accounts involved;
- On-device learning analysis sends field-whitelisted data to an external model service only when the user explicitly configures one (never journal entries, notes, or secrets);
- API keys are kept in the OS credential manager; no plaintext secrets in databases or backups;
- The backup format and the sync protocol are strictly isolated and never interchangeable.

## Repository Layout

```
TeacherAgent/   Desktop app (Tauri 2.x + Vue 3 + Rust)
AlertTime/      Android app (Kotlin + Jetpack Compose + Room)
```

## Core Capabilities

### TeacherAgent (desktop)

- **Local knowledge pipeline**: LLM-generated educational content passes multi-stage format/fact/review validation before entering the local knowledge base;
- **Private-document RAG**: imported handouts and exam papers are chunked and embedded into SQLite; at the thousand-vector scale the system uses brute-force cosine similarity (~5 ms per 1,000 vectors, release build), with no external vector-database dependency;
- **BKT knowledge tracing**: maintains an interpretable mastery probability per student–knowledge-point pair as state input for suggestion generation (parameters are hand-set defaults; data fitting is left to future work);
- **LAN sync server**: HTTPS with a self-signed certificate pinned by its SPKI fingerprint in the pairing QR code, one-time pairing tokens exchanged for device credentials, strict envelope validation, and idempotent snapshots.

### AlertTime (Android)

- **Behavior capture**: focus timer, distraction detection, plan and weekly-goal management;
- **On-device learning analysis**: optionally calls a user-configured OpenAI-compatible service under a strict endpoint policy (no-auth mode allows loopback/private ranges only; key-bearing mode requires HTTPS), with automatic deterministic fallback on failure; sync reuses a cached analysis via an input-content fingerprint, so steady-state syncs never wait on the model;
- **Local backup**: full JSON export with merge-restore, fully isolated from the sync protocol.

### Sync Protocol

A single envelope format (`format` / `schemaVersion` / `messageType` / `deviceId`); endpoints are bound one-to-one to message types; unknown fields are ignored for forward compatibility; snapshots carry idempotent IDs; proposals are pulled with cursor pagination and accepted/rejected decisions are reported back. The protocol document, JSON schema, and test fixtures are stored verbatim-identical in both apps' `sync/protocol/` directories, guarded by a SHA-256 manifest check, with Rust and Kotlin parsers sharing the same fixture set.

## Quick Start

```bash
# Desktop (requires Node.js 18+ and the Rust toolchain)
cd TeacherAgent && npm install && npm run tauri dev

# Android (requires JDK 17+ and the Android SDK)
cd AlertTime && ./gradlew assembleDebug
```

Enable the LAN sync service on the desktop's "AlertTime Sync" page, generate the pairing QR code, then scan it from the phone.

## Testing & Benchmarks

- 70 Vitest files (frontend), 297 Rust unit tests (desktop), 37 JVM + 14 instrumented test files (Android);
- Dual-end protocol tests share the same valid/malformed fixture set; the SHA-256 mirror check blocks one-sided drift in CI;
- Benchmark scripts: `TeacherAgent/scripts/sync-benchmark.py` (pairing, snapshot scale, proposal loop, robustness matrix) and `TeacherAgent/scripts/rag-index-benchmark.py` (brute-force cosine vs. FAISS HNSW).

## Releases

Prebuilt installers are available on [Releases](https://github.com/xuzeTop1/Teacher/releases) (desktop setup.exe / MSI; debug-signed APK for the phone). The desktop installer is unsigned — if SmartScreen warns, choose "More info → Run anyway".

## License

All rights reserved.
