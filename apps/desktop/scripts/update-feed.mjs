// Write the desktop app's update feed (Tauri's static update manifest) for one signed installer.
// Used by the release workflow and scripts/build-local-test.ps1. The API serves this file at
// /v1/app/update/... (services/api, HASH_APP_UPDATE or config/app-update.json).
//
//   node update-feed.mjs <installer.exe> <version> <download url> [notes] > latest.json
//
// Reads the updater signature from <installer.exe>.sig (made by `tauri build` with the update key).
import { readFileSync } from "node:fs";

const [installer, version, url, notes = ""] = process.argv.slice(2);
if (!installer || !version || !url) {
  console.error("usage: node update-feed.mjs <installer.exe> <version> <download url> [notes]");
  process.exit(1);
}
const signature = readFileSync(`${installer}.sig`, "utf8").trim();
const feed = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": { signature, url } },
};
process.stdout.write(JSON.stringify(feed, null, 2) + "\n");
