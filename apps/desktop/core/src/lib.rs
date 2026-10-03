//! Platform-independent logic for the Hashcoin miner app.
//!
//! The Tauri shell (`src-tauri`) handles windows, the tray and settings; everything
//! that decides *what* runs lives here so it can be unit tested on any machine.

pub mod agent;
pub mod gpu;
pub mod manifest;
pub mod miner;
pub mod signed;
pub mod wallet;

pub use agent::{plan, Action};
pub use gpu::{Gpu, Vendor};
pub use manifest::{MinerBuild, MinerManifest, MinerSpec};
pub use signed::{Assignment, Envelope, KeyRing};
