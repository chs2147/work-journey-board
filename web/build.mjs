/* global URL */
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const output = new URL("./.vercel/output/", import.meta.url);
const bundle = new URL("functions/web.func/", output);
const runtimeFiles = [
  "api/index.js",
  "package.json",
  "server.mjs",
  "pages.mjs",
  "session-store.mjs",
  "upstream.mjs",
  "public/app.js",
  "public/style.css",
  "public/workspace.css",
  "workspace.mjs",
  "public/workspace.js",
];

function copy(source, destination) {
  const target = fileURLToPath(new URL(destination, bundle));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(new URL(source, import.meta.url), target);
}

rmSync(output, { recursive: true, force: true });
for (const file of runtimeFiles) copy(file, "web/" + file);
for (const file of ["icon.svg", "wordmark.svg"]) copy("../site/" + file, "site/" + file);
for (const file of ["tokens.css", "palette.ts", "fonts/GowunDodum-Regular.woff2"])
  copy("../src/shared/" + file, "src/shared/" + file);
copy("../public/licenses/GowunDodum-OFL-1.1.txt", "public/licenses/GowunDodum-OFL-1.1.txt");
copy("../poc/v2-cloud/cloud-environment.mjs", "poc/v2-cloud/cloud-environment.mjs");
cpSync(new URL("./node_modules/postgres/", import.meta.url), new URL("web/node_modules/postgres/", bundle), {
  recursive: true,
});

writeFileSync(
  new URL(".vc-config.json", bundle),
  JSON.stringify({
    runtime: "nodejs24.x",
    handler: "web/api/index.js",
    launcherType: "Nodejs",
    maxDuration: 60,
    regions: ["icn1"],
    shouldAddHelpers: true,
  }),
);
writeFileSync(
  new URL("config.json", output),
  JSON.stringify({ version: 3, routes: [{ src: "^/.*$", dest: "/web" }] }),
);
