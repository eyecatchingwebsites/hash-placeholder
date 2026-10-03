use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

/// Signed list of miner programs (services/api/config/miners.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerManifest {
    pub version: u32,
    pub miners: Vec<MinerSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerSpec {
    pub id: String,
    pub version: String,
    pub algos: Vec<String>,
    #[serde(default)]
    pub dev_fee: f64,
    pub builds: HashMap<String, MinerBuild>,
    /// Argument template with {algo} {pool} {user} {pass} {device} {apiPort} placeholders.
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinerBuild {
    pub url: String,
    pub sha256: String,
    /// Executable path inside the archive.
    pub exe: String,
}

/// Build key for this machine, e.g. "windows-x86_64".
pub fn platform_key() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

impl MinerManifest {
    pub fn find(&self, id: &str) -> Option<&MinerSpec> {
        self.miners.iter().find(|m| m.id == id)
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Refuse to use a download unless it matches the hash in the signed manifest.
pub fn verify_download(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    let got = sha256_hex(bytes);
    if got.eq_ignore_ascii_case(expected_hex.trim()) { Ok(()) } else { Err(format!("hash mismatch: expected {expected_hex}, got {got}")) }
}

/// Extract a verified .zip into `dest`, refusing entries that would escape it.
pub fn extract_zip(bytes: &[u8], dest: &Path) -> Result<Vec<PathBuf>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut written = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let rel = PathBuf::from(entry.name());
        if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(format!("unsafe path in archive: {}", entry.name()));
        }
        let out = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, buf).map_err(|e| e.to_string())?;
        written.push(out);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_with(name: &str, data: &[u8]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        let mut w = zip::ZipWriter::new(&mut buf);
        w.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
        w.finish().unwrap();
        buf.into_inner()
    }

    #[test]
    fn hash_check() {
        let h = sha256_hex(b"miner");
        assert!(verify_download(b"miner", &h.to_uppercase()).is_ok());
        assert!(verify_download(b"miner!", &h).is_err());
    }

    #[test]
    fn extracts_and_blocks_path_traversal() {
        let dir = std::env::temp_dir().join(format!("hashcoin-test-{}", std::process::id()));
        let files = extract_zip(&zip_with("bin/miner.exe", b"x"), &dir).unwrap();
        assert!(files[0].ends_with("bin/miner.exe"));
        assert!(extract_zip(&zip_with("../evil.exe", b"x"), &dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parses_api_manifest() {
        let m: MinerManifest = serde_json::from_str(include_str!("../../../../services/api/config/miners.json")).unwrap();
        assert!(m.find("prl-miner").unwrap().builds.contains_key("windows-x86_64"));
    }
}
