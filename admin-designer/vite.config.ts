import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// major.minor come from package.json (e.g. "1.0.0" -> "1.0").
const pkgVersion: string = require("./package.json").version ?? "1.0.0";
const [major = "1", minor = "0"] = pkgVersion.split(".");

// Build number = total git commit count (auto-increments on every commit).
// Resolution order (most reliable first):
//   1. APP_BUILD env var (set on the host / passed as a Docker build-arg);
//   2. a build-number.txt file written by the azd `prepackage` hook — this is
//      what makes Docker builds correct, since `.git` is NOT in the build
//      context and azd resolves build-args from the OS env (not the .env file);
//   3. a live `git rev-list` when building locally with a .git dir;
//   4. "0" as a last resort.
let build = process.env.APP_BUILD?.trim() || "";
if (!build) {
  try {
    const f = fileURLToPath(new URL("./build-number.txt", import.meta.url));
    build = readFileSync(f, "utf8").trim();
  } catch {
    build = "";
  }
}
if (!build) {
  try {
    build = execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim();
  } catch {
    build = "0";
  }
}
if (!build) build = "0";

const appVersion = `${major}.${minor}.${build}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: { port: 5173 },
  preview: { port: 80, host: true },
  build: { outDir: "dist", sourcemap: false },
});
