import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** One waitlist sign-up. No IP, no wallet: an X handle or an email, and the GPU they picked. */
export interface WaitlistEntry { contact: string; gpu: string | null; at: string }

export interface Waitlist {
  /** "added", "exists" (same contact already on the list) or "full". */
  add(e: { contact: string; gpu: string | null }): "added" | "exists" | "full";
  count(): number;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
const HANDLE = /^@?[A-Za-z0-9_]{1,15}$/;

/** An email (lowercased) or an X handle (as "@name", lowercased), or null if it's neither. */
export function normalizeContact(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length > 254) return null;
  if (EMAIL.test(s)) return s.toLowerCase();
  if (HANDLE.test(s)) return "@" + s.replace(/^@/, "").toLowerCase();
  const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i.exec(s);
  return m ? "@" + m[1]!.toLowerCase() : null;
}

/** A GPU name from the site's list: printable, short. Anything else is dropped (the GPU is optional). */
export function normalizeGpu(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length > 0 && s.length <= 80 && /^[\w .+()\-/]+$/.test(s) ? s : null;
}

/** Append-only JSON-lines file (gitignored data/). Holds personal data: never commit or publish it. */
export function fileWaitlist(path: string, max = 100_000): Waitlist {
  const seen = new Set<string>();
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { seen.add((JSON.parse(line) as WaitlistEntry).contact); } catch { /* skip a torn line */ }
    }
  } catch { /* no file yet */ }
  return {
    add({ contact, gpu }) {
      if (seen.has(contact)) return "exists";
      if (seen.size >= max) return "full";
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify({ contact, gpu, at: new Date().toISOString() } satisfies WaitlistEntry) + "\n");
      seen.add(contact);
      return "added";
    },
    count: () => seen.size,
  };
}
