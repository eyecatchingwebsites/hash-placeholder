// Tauri config overlay that code-signs the app and its installer with Azure Artifact Signing
// (formerly Trusted Signing), for `tauri build --config <this file>`. Used by the release workflow
// when the repository variable WINDOWS_SIGNING is "azure".
//
//   AZURE_SIGNING_ENDPOINT=https://eus.codesigning.azure.net AZURE_SIGNING_ACCOUNT=... \
//   AZURE_SIGNING_PROFILE=... node signing-config.mjs > signing.conf.json
//
// artifact-signing-cli reads AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_TENANT_ID from the
// environment at build time; none of them go in this file.
const need = ["AZURE_SIGNING_ENDPOINT", "AZURE_SIGNING_ACCOUNT", "AZURE_SIGNING_PROFILE"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing: ${missing.join(", ")}`);
  process.exit(1);
}
const { AZURE_SIGNING_ENDPOINT: endpoint, AZURE_SIGNING_ACCOUNT: account, AZURE_SIGNING_PROFILE: profile } = process.env;
const overlay = {
  bundle: {
    windows: {
      // Object form, so the description can hold a space. %1 is the file Tauri asks to sign
      // (the app, then the installer), before it makes the update signature.
      signCommand: { cmd: "artifact-signing-cli", args: ["-e", endpoint, "-a", account, "-c", profile, "-d", "Hashcoin Miner", "%1"] },
    },
  },
};
process.stdout.write(JSON.stringify(overlay, null, 2) + "\n");
