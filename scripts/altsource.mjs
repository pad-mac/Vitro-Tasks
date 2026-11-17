// Writes the SideStore / AltStore source for a release to stdout.
// usage: node scripts/altsource.mjs <path to VitroTasks.ipa> <tag>
// Add https://github.com/<repo>/releases/latest/download/vitro-tasks.altsource.json
// as a source in SideStore to get updates there.
import fs from "node:fs";

const [ipaPath, tagArg] = process.argv.slice(2);
const conf = JSON.parse(fs.readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const ios = JSON.parse(fs.readFileSync(new URL("../src-tauri/tauri.ios.conf.json", import.meta.url), "utf8"));
const repo = process.env.GITHUB_REPOSITORY ?? "pad-mac/Vitro-Tasks";
const tag = tagArg ?? `v${conf.version}`;
const base = `https://github.com/${repo}`;
const source = {
  name: "Vitro Tasks",
  identifier: `${conf.identifier}.source`,
  subtitle: "Tasks and calendar",
  description: "Builds of Vitro Tasks for iPhone, published with each release.",
  sourceURL: `${base}/releases/latest/download/vitro-tasks.altsource.json`,
  website: base,
  iconURL: `https://raw.githubusercontent.com/${repo}/main/src-tauri/icons/ios-icon.png`,
  tintColor: "#8A9099",
  apps: [
    {
      name: "Vitro Tasks",
      bundleIdentifier: conf.identifier,
      developerName: repo.split("/")[0],
      subtitle: "Tasks and calendar",
      localizedDescription: "Lists, smart views, board and timeline modes, a calendar and hard deadlines. Syncs with your own server.",
      iconURL: `https://raw.githubusercontent.com/${repo}/main/src-tauri/icons/ios-icon.png`,
      tintColor: "#8A9099",
      category: "productivity",
      versions: [
        {
          version: conf.version,
          buildVersion: conf.version,
          date: new Date().toISOString().slice(0, 10),
          localizedDescription: `Vitro Tasks ${conf.version}. Changes: ${base}/releases/tag/${tag}`,
          downloadURL: `${base}/releases/download/${tag}/VitroTasks.ipa`,
          size: fs.statSync(ipaPath).size,
          minOSVersion: ios.bundle?.iOS?.minimumSystemVersion ?? "15.0",
        },
      ],
      appPermissions: { entitlements: [], privacy: {} },
    },
  ],
  news: [],
};
process.stdout.write(JSON.stringify(source, null, 2) + "\n");
