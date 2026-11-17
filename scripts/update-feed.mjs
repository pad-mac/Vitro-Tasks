// Writes the update feed (latest.json) for a release to stdout.
// usage: node scripts/update-feed.mjs <path to setup.exe.sig> <tag>
import fs from "node:fs";

const [sigPath, tag] = process.argv.slice(2);
const { version } = JSON.parse(fs.readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const repo = process.env.GITHUB_REPOSITORY ?? "pad-mac/Vitro-Tasks";
const feed = {
  version,
  notes: `Vitro Tasks ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(sigPath, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag ?? `v${version}`}/VitroTasks-setup.exe`,
    },
  },
};
process.stdout.write(JSON.stringify(feed, null, 2) + "\n");
