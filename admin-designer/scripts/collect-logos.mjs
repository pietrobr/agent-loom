// Collect per-customer bot logos into the static public/ folder at build time.
//
// The admin console renders each customer's logo in the Customers list. The
// demo customers reference `logo_url = /bots/<org_id>.svg`, so the admin app
// must serve those files too (otherwise they 404 here while working in the
// customer-webapp). Single source of truth: `sample-customers/<org_id>/logo.svg`.
//
// npm runs this with cwd = the admin-designer package dir, so `../sample-customers`
// resolves both locally and in the Docker build (sample-customers copied to
// /sample-customers, i.e. /app/../sample-customers).
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
