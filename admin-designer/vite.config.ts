import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// major.minor come from package.json (e.g. "1.0.0" -> "1.0").
const pkgVersion: string = require("./package.json").version ?? "1.0.0";
const [major = "1", minor = "0"] = pkgVersion.split(".");

// Build number = total git commit count (auto-increments on every commit).
// In CI/Docker builds .git is absent, so it is injected via the APP_BUILD
// env var (set from the host); fall back to git locally, then "0".
let build = process.env.APP_BUILD?.trim() || "";
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
