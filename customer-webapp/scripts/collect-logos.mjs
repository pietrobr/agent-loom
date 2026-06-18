// Collect per-customer bot logos into the static public/ folder at build time.
//
// Single source of truth: each customer's animated SVG lives next to its other
// content at `sample-customers/<org_id>/logo.svg`. This script copies them to
// `public/bots/<org_id>.svg`, which Vite serves statically and the seed
// references as `logo_url = /bots/<org_id>.svg`.
//
// Path note: npm runs this with cwd = the customer-webapp package dir, so
// `../sample-customers` resolves both locally (repo/sample-customers) and in the
// Docker build (where the Dockerfile copies sample-customers to /sample-customers,
// i.e. /app/../sample-customers).
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "..", "sample-customers");
const DEST = join(process.cwd(), "public", "bots");

if (!existsSync(SRC)) {
  console.warn(`[collect-logos] source folder not found: ${SRC} — skipping`);
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });

let copied = 0;
for (const entry of readdirSync(SRC)) {
  const orgDir = join(SRC, entry);
  if (!statSync(orgDir).isDirectory()) continue;
  const logo = join(orgDir, "logo.svg");
  if (existsSync(logo)) {
    copyFileSync(logo, join(DEST, `${entry}.svg`));
    copied++;
  }
}
console.log(`[collect-logos] copied ${copied} customer logo(s) to public/bots/`);
