//! Which antivirus is active, from Windows Security Center's product list (`root\SecurityCenter2`,
//! `AntiVirusProduct`: `displayName` and `productState`), so the "stopped mining" message can name it.
//! The shell reads the list; this decides. Read-only: the app never changes any antivirus settings.

/// One entry of Security Center's antivirus list.
#[derive(Debug, Clone, PartialEq)]
pub struct Product {
    pub name: String,
    /// Security Center's `productState`, e.g. 0x061100 = on and up to date.
    pub state: u32,
}

impl Product {
    /// Real-time protection is on (bits 12-15 = 1; 0 = off, 2 = snoozed, 3 = expired).
    pub fn enabled(&self) -> bool { (self.state >> 12) & 0xF == 1 }
    /// Signatures are current (bits 4-7 = 0; 1 = out of date).
    pub fn up_to_date(&self) -> bool { (self.state >> 4) & 0xF == 0 }
    pub fn is_defender(&self) -> bool { is_defender(&self.name) }
}

/// Microsoft Defender, under any of the names Windows has used for it.
pub fn is_defender(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("defender") && (n.contains("windows") || n.contains("microsoft"))
}

/// The antivirus that's doing the protecting: an enabled third-party product first (with one
/// installed, Defender steps back to passive), else enabled Defender. None when nothing is
/// enabled or the list couldn't be read; the message then says "your antivirus".
pub fn active(products: &[Product]) -> Option<String> {
    let on = products.iter().filter(|p| p.enabled() && !p.name.trim().is_empty());
    let (third_party, defender): (Vec<_>, Vec<_>) = on.partition(|p| !p.is_defender());
    third_party.first().or(defender.first()).map(|p| p.name.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(name: &str, state: u32) -> Product { Product { name: name.into(), state } }

    #[test]
    fn reads_product_state_bits() {
        let on = p("Windows Defender", 0x061100); // 397568, the usual "on and up to date"
        assert!(on.enabled() && on.up_to_date());
        let passive = p("Windows Defender", 0x060100); // 393472, off: another antivirus is active
        assert!(!passive.enabled());
        let stale = p("Avast Antivirus", 0x041110);
        assert!(stale.enabled() && !stale.up_to_date());
        assert!(!p("Norton", 0x062100).enabled(), "snoozed");
        assert!(!p("McAfee", 0x063100).enabled(), "expired");
    }

    #[test]
    fn picks_the_product_that_is_actually_on() {
        // A third-party antivirus is on and Defender is passive: name the third party.
        assert_eq!(active(&[p("Windows Defender", 0x060100), p("Avast Antivirus", 0x041100)]).as_deref(), Some("Avast Antivirus"));
        // Both report on (Defender in limited periodic scanning): still the third party.
        assert_eq!(active(&[p("Windows Defender", 0x061100), p("Bitdefender Antivirus", 0x041000)]).as_deref(), Some("Bitdefender Antivirus"));
        // Only Defender.
        assert_eq!(active(&[p("Windows Defender", 0x061100)]).as_deref(), Some("Windows Defender"));
        // An expired leftover doesn't count; Defender does.
        assert_eq!(active(&[p("McAfee VirusScan", 0x063100), p("Microsoft Defender Antivirus", 0x061100)]).as_deref(), Some("Microsoft Defender Antivirus"));
        // Nothing on, or nothing listed: "your antivirus".
        assert_eq!(active(&[p("Windows Defender", 0x060100)]), None);
        assert_eq!(active(&[]), None);
        assert!(is_defender("Microsoft Defender Antivirus") && is_defender("Windows Defender") && !is_defender("Avast Antivirus"));
    }
}
