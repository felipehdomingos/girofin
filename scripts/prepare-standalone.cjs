const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const staticDir = path.join(root, ".next", "static");
const standaloneStaticDir = path.join(standalone, ".next", "static");
const publicDir = path.join(root, "public");
const standalonePublicDir = path.join(standalone, "public");

if (!fs.existsSync(standalone)) {
  throw new Error("Standalone build nao encontrado em .next/standalone.");
}

fs.cpSync(staticDir, standaloneStaticDir, { recursive: true });
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, standalonePublicDir, { recursive: true });
}
