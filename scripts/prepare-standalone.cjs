const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const staticDir = path.join(root, ".next", "static");
const standaloneStaticDir = path.join(standalone, ".next", "static");
const publicDir = path.join(root, "public");
const standalonePublicDir = path.join(standalone, "public");
const standaloneDataDir = path.join(standalone, "data");
const standalonePackageJson = path.join(standalone, "package.json");

if (!fs.existsSync(standalone)) {
  throw new Error("Standalone build nao encontrado em .next/standalone.");
}

fs.cpSync(staticDir, standaloneStaticDir, { recursive: true });
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, standalonePublicDir, { recursive: true });
}

// Output tracing can include the local SQLite file because the development
// mode resolves it at runtime. Never ship a user's financial database.
fs.rmSync(standaloneDataDir, { recursive: true, force: true });

const packageJson = JSON.parse(fs.readFileSync(standalonePackageJson, "utf8"));
packageJson.scripts = {
  ...packageJson.scripts,
  start: "node server.js",
};
fs.writeFileSync(
  standalonePackageJson,
  `${JSON.stringify(packageJson, null, 2)}\n`,
  "utf8",
);
