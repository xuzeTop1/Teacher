//! AlertTime single-phone LAN sync extension (optional, user-authorized).
//!
//! Architecture boundary: HTTPS server, authentication, SQLite access,
//! transactions and keychain live in Rust. The Vue frontend only talks to
//! Tauri commands with explicit DTOs and never binds ports, opens SQLite
//! directly, stores pairing tokens or handles certificate private keys.
//!
//! See docs/decisions/2026-08-03-alerttime-lan-sync.md and
//! sync/protocol/protocol.md for the governing contracts.

pub(crate) mod commands;
pub(crate) mod db;
pub(crate) mod protocol;
pub(crate) mod server;
pub(crate) mod tls;
