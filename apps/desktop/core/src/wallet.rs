/// A Solana address is base58 for exactly 32 bytes. The app only ever asks for the
/// public address, never a seed phrase or private key.
pub fn is_solana_address(s: &str) -> bool {
    let s = s.trim();
    (32..=44).contains(&s.len()) && matches!(bs58::decode(s).into_vec(), Ok(b) if b.len() == 32)
}

/// Rig ids end up in the pool worker name, so keep them short and safe.
pub fn is_rig_id(s: &str) -> bool {
    (1..=24).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Short pool worker id for this wallet's rig: "h" + the first 10 base32 characters of
/// SHA-256("wallet:rigId"). Same as the server's `workerId` (packages/switcher/src/wallet.ts), so
/// the app can check an assignment's pool login is its own without the wallet in the worker name.
pub fn worker_id(wallet: &str, rig_id: &str) -> String {
    use sha2::{Digest, Sha256};
    const BASE32: &[u8] = b"abcdefghijklmnopqrstuvwxyz234567";
    let hash = Sha256::digest(format!("{wallet}:{rig_id}").as_bytes());
    let mut out = String::from("h");
    let (mut value, mut bits) = (0u32, 0u32);
    for byte in hash {
        value = ((value << 8) | byte as u32) & 0xffff;
        bits += 8;
        while bits >= 5 && out.len() < 11 {
            out.push(BASE32[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
        if out.len() >= 11 { break; }
    }
    out
}

/// Turn a computer name into a valid rig id.
pub fn rig_id_from_hostname(host: &str) -> String {
    let id: String = host
        .chars()
        .filter_map(|c| match c {
            c if c.is_ascii_alphanumeric() => Some(c.to_ascii_lowercase()),
            '-' | '_' | ' ' | '.' => Some('-'),
            _ => None,
        })
        .take(24)
        .collect();
    let id = id.trim_matches('-').to_string();
    if id.is_empty() { "rig".into() } else { id }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses() {
        assert!(is_solana_address("4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF"));
        assert!(!is_solana_address("not a wallet"));
        assert!(!is_solana_address("0OIl1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF"));
    }

    #[test]
    fn worker_ids_match_the_server() {
        // Same vectors as packages/switcher/test/switcher.test.ts.
        assert_eq!(worker_id("4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF", "gamingpc"), "hvrq3qmrph6");
        assert_eq!(worker_id("4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF", "pc1"), "hwac5yjdrn2");
    }

    #[test]
    fn rig_ids() {
        assert_eq!(rig_id_from_hostname("DESKTOP-AB12.local"), "desktop-ab12-local");
        assert_eq!(rig_id_from_hostname("ñ"), "rig");
        assert!(is_rig_id(&rig_id_from_hostname("My Gaming PC!!")));
    }
}
