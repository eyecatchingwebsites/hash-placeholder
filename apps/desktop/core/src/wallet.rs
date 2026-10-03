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
    fn rig_ids() {
        assert_eq!(rig_id_from_hostname("DESKTOP-AB12.local"), "desktop-ab12-local");
        assert_eq!(rig_id_from_hostname("ñ"), "rig");
        assert!(is_rig_id(&rig_id_from_hostname("My Gaming PC!!")));
    }
}
