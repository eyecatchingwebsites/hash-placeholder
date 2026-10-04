use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;

/// A payload signed by the Hashcoin server (see packages/switcher/src/sign.ts).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub kid: String,
    pub payload: String,
    pub sig: String,
}

/// Public keys the app trusts, by key id. Compiled into the app, so a hijacked
/// server connection can't point miners at someone else's pool.
#[derive(Default, Clone)]
pub struct KeyRing(HashMap<String, VerifyingKey>);

impl KeyRing {
    pub fn add_b64(&mut self, kid: &str, raw_b64: &str) -> Result<(), String> {
        // Accept the key with or without its trailing "=" padding (it's easy to lose when copying).
        let trimmed = raw_b64.trim().trim_end_matches('=');
        let padded = format!("{trimmed}{}", "=".repeat((4 - trimmed.len() % 4) % 4));
        let bytes: [u8; 32] = B64.decode(padded).map_err(|e| e.to_string())?.try_into().map_err(|_| "key must be 32 bytes")?;
        let key = VerifyingKey::from_bytes(&bytes).map_err(|e| e.to_string())?;
        self.0.insert(kid.to_string(), key);
        Ok(())
    }

    pub fn verify<T: DeserializeOwned>(&self, env: &Envelope) -> Result<T, String> {
        let key = self.0.get(&env.kid).ok_or_else(|| format!("unknown key id {}", env.kid))?;
        let sig: [u8; 64] = B64.decode(&env.sig).map_err(|e| e.to_string())?.try_into().map_err(|_| "bad signature length")?;
        key.verify_strict(env.payload.as_bytes(), &Signature::from_bytes(&sig)).map_err(|_| "bad signature".to_string())?;
        serde_json::from_str(&env.payload).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PoolTarget {
    pub url: String,
    pub user: String,
    pub pass: String,
}

/// What one GPU should mine right now (packages/switcher/src/types.ts `Assignment`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub v: u32,
    pub rig_id: String,
    pub wallet: String,
    pub gpu_index: u32,
    pub gpu: String,
    pub coin: String,
    pub algo: String,
    pub miner_id: String,
    pub pool: PoolTarget,
    pub expected_usd_per_day: f64,
    pub reason: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

impl Assignment {
    /// Reject assignments that aren't for this wallet/rig/GPU, are stale, or point the
    /// worker somewhere it shouldn't (payouts must go to the user's own wallet).
    pub fn check(&self, wallet: &str, rig_id: &str, gpu_index: u32, now_ms: u64) -> Result<(), String> {
        if self.v != 1 { return Err(format!("unsupported assignment version {}", self.v)); }
        if self.wallet != wallet || self.rig_id != rig_id || self.gpu_index != gpu_index {
            return Err("assignment is for a different wallet, rig or GPU".into());
        }
        if now_ms >= self.expires_at { return Err("assignment expired".into()); }
        // Login is "<platform payout address>.<worker id>-<gpu>"; the worker id is derived from this
        // wallet and rig, so a login for anyone else's worker is refused.
        if !self.pool.user.ends_with(&format!(".{}-{gpu_index}", crate::wallet::worker_id(wallet, rig_id))) {
            return Err("pool worker does not belong to this wallet".into());
        }
        if !(self.pool.url.starts_with("stratum+tcp://") || self.pool.url.starts_with("stratum+ssl://")) {
            return Err("pool url must be stratum+tcp:// or stratum+ssl://".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixture produced by the TypeScript signer (tests/fixtures/make-fixture.mjs),
    /// so this proves the server and the app agree on the signature format.
    #[derive(Deserialize)]
    struct Fixture { kid: String, public_key: String, envelope: Envelope, wallet: String }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../tests/fixtures/assignment.json")).unwrap()
    }

    #[test]
    fn verifies_server_signature() {
        let f = fixture();
        let mut ring = KeyRing::default();
        ring.add_b64(&f.kid, &f.public_key).unwrap();
        let a: Assignment = ring.verify(&f.envelope).unwrap();
        assert_eq!(a.coin, "PRL");
        a.check(&f.wallet, "gamingpc", 0, a.issued_at + 1).unwrap();
        assert!(a.check(&f.wallet, "gamingpc", 0, a.expires_at).is_err());
        assert!(a.check(&f.wallet, "otherpc", 0, a.issued_at).is_err());
        // A login for someone else's worker id (or another GPU) is refused.
        let mut other = a.clone();
        other.pool.user = format!("prl1platformpayoutaddress.{}-0", crate::wallet::worker_id("SomeoneElse", "gamingpc"));
        assert!(other.check(&f.wallet, "gamingpc", 0, a.issued_at + 1).is_err());
        assert!(a.check(&f.wallet, "gamingpc", 1, a.issued_at + 1).is_err());
    }

    #[test]
    fn accepts_a_key_without_its_padding() {
        let f = fixture();
        let mut ring = KeyRing::default();
        ring.add_b64(&f.kid, f.public_key.trim_end_matches('=')).unwrap();
        assert!(ring.verify::<Assignment>(&f.envelope).is_ok());
        assert!(KeyRing::default().add_b64("x", "not a key").is_err());
    }

    #[test]
    fn rejects_tampering_and_unknown_keys() {
        let f = fixture();
        let mut ring = KeyRing::default();
        ring.add_b64(&f.kid, &f.public_key).unwrap();
        let mut bad = f.envelope.clone();
        bad.payload = bad.payload.replace("prl-us", "evil");
        assert_eq!(ring.verify::<Assignment>(&bad).unwrap_err(), "bad signature");
        assert!(KeyRing::default().verify::<Assignment>(&f.envelope).is_err());
    }
}
