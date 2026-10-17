// Site settings. Anything left null shows a clearly labeled placeholder.
// After a change: commit and push; Cloudflare Pages redeploys the site by itself (docs/HOSTING.md).
window.HASHCOIN = Object.assign({
  // The site's own address, no trailing slash. The same domain is in the pages' <head>, robots.txt,
  // sitemap.xml and token/hash.json; change it everywhere with `node apps/web/scripts/set_domain.mjs <domain>`.
  site: "https://hashcoin.app",
  // The API (services/api on the backend PC, reached through the Cloudflare Tunnel).
  api: "https://api.hashcoin.app",
  // ISO 8601 launch time, e.g. "2026-12-01T17:00:00Z". null shows "to be announced".
  launchAt: null,
  // Token contract address. Published on this site first, at launch. Never before.
  ca: null,
  // true opens the waitlist form (it posts to <api>/v1/waitlist). Turn it on once the API answers
  // at <api>/v1/health. false shows "coming soon" and collects nothing.
  waitlist: false,
  // The Windows installer, from the GitHub release. null shows "coming soon".
  // { url: "https://github.com/<owner>/<repo>/releases/download/desktop-v0.1.0/HashcoinMiner-0.1.0-setup.exe",
  //   version: "0.1.0", sha256: "<64 hex characters from the release's SHA256SUMS.txt>" }
  download: null,
  // Social links. null shows "coming soon".
  x: "https://x.com/HashcoinSOL",
  discord: null,
  github: null,
}, window.HASHCOIN || {});
