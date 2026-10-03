import type { Vendor } from "./types.js";

/**
 * Normalize driver-reported names to the catalog key used in revenue data.
 * "NVIDIA GeForce RTX 4070 Laptop GPU" -> "rtx4070laptop"
 * "AMD Radeon RX 7900 XTX" -> "rx7900xtx"
 */
export function gpuKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/nvidia|geforce|amd|radeon|intel\(r\)|intel|graphics|\(tm\)|\(r\)/g, " ")
    .replace(/\blaptop gpu\b/g, " laptop ")
    .replace(/\b\d+\s?gb\b/g, (m) => (/(12|16)/.test(m) ? m : " ")) // keep memory variants that matter
    .replace(/[^a-z0-9]+/g, "");
}

export function vendorOf(name: string): Vendor | null {
  const n = name.toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(n)) return "nvidia";
  if (/amd|radeon|\brx\s?\d/.test(n)) return "amd";
  if (/intel|\barc\b/.test(n)) return "intel";
  return null;
}
