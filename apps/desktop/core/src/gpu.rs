use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Vendor {
    Nvidia,
    Amd,
    Intel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    /// Device index the miner uses (`--devices`).
    pub index: u32,
    pub name: String,
    pub vendor: Vendor,
    pub memory_mb: Option<u32>,
}

pub fn vendor_of(name: &str) -> Option<Vendor> {
    let n = name.to_ascii_lowercase();
    if ["nvidia", "geforce", "rtx", "gtx", "quadro"].iter().any(|k| n.contains(k)) {
        Some(Vendor::Nvidia)
    } else if n.contains("amd") || n.contains("radeon") || n.starts_with("rx ") {
        Some(Vendor::Amd)
    } else if n.contains("intel") && n.contains("arc") {
        // Integrated Intel graphics can't mine usefully; only Arc cards count.
        Some(Vendor::Intel)
    } else {
        None
    }
}

/// Parse `nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits`.
pub fn parse_nvidia_smi(out: &str) -> Vec<Gpu> {
    out.lines()
        .filter_map(|line| {
            let mut parts = line.split(',').map(str::trim);
            let index = parts.next()?.parse().ok()?;
            let name = parts.next()?.to_string();
            let memory_mb = parts.next().and_then(|m| m.parse().ok());
            Some(Gpu { index, name, vendor: Vendor::Nvidia, memory_mb })
        })
        .collect()
}

/// Parse the names printed by
/// `Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name` (one per line),
/// keeping AMD and Intel Arc cards. NVIDIA cards come from nvidia-smi instead, which gives
/// the device index the miners use. AMD/Intel indexes count per vendor, in listed order.
/// Graphics built into the processor ("AMD Radeon(TM) Graphics", "AMD Radeon 780M Graphics"):
/// too weak to be worth mining, and not what a user means by their GPU. Discrete AMD cards carry
/// an RX / Pro / Instinct model name.
pub fn is_integrated(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("radeon") && n.trim_end().ends_with("graphics") && ![" rx ", " rx", "pro ", "instinct"].iter().any(|k| n.contains(k))
}

pub fn parse_video_controllers(out: &str) -> Vec<Gpu> {
    let mut amd = 0;
    let mut intel = 0;
    out.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter_map(|name| {
            let vendor = vendor_of(name)?;
            if is_integrated(name) { return None; }
            let index = match vendor {
                Vendor::Nvidia => return None,
                Vendor::Amd => { amd += 1; amd - 1 }
                Vendor::Intel => { intel += 1; intel - 1 }
            };
            Some(Gpu { index, name: name.to_string(), vendor, memory_mb: None })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvidia_smi() {
        let g = parse_nvidia_smi("0, NVIDIA GeForce RTX 4070, 12282\n1, NVIDIA GeForce RTX 3060 Laptop GPU, 6144\n\n");
        assert_eq!(g.len(), 2);
        assert_eq!(g[1].name, "NVIDIA GeForce RTX 3060 Laptop GPU");
        assert_eq!(g[0].memory_mb, Some(12282));
    }

    #[test]
    fn video_controllers() {
        let g = parse_video_controllers("NVIDIA GeForce RTX 4070\r\nAMD Radeon RX 7900 XTX\r\nIntel(R) UHD Graphics 770\r\nIntel(R) Arc(TM) A770 Graphics\r\n");
        assert_eq!(g.iter().map(|g| g.vendor).collect::<Vec<_>>(), vec![Vendor::Amd, Vendor::Intel]);
        assert_eq!(g[0].index, 0);
    }

    #[test]
    fn skips_graphics_built_into_the_processor() {
        let g = parse_video_controllers("AMD Radeon(TM) Graphics
AMD Radeon 780M Graphics
AMD Radeon RX 6800M
AMD Radeon Pro W7900
");
        assert_eq!(g.iter().map(|g| g.name.as_str()).collect::<Vec<_>>(), vec!["AMD Radeon RX 6800M", "AMD Radeon Pro W7900"]);
        assert!(!is_integrated("Intel(R) Arc(TM) A770 Graphics"));
    }
}
