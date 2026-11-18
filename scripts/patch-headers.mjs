// Adds the configured processing-server origin to the Content-Security-Policy
// connect-src list so the browser may call it. Run after `next build`.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const apiUrl = (process.env.NEXT_PUBLIC_APOS_API_URL ?? "").trim();
if (!apiUrl) {
  console.log("patch-headers: NEXT_PUBLIC_APOS_API_URL is empty, headers unchanged");
  process.exit(0);
}

let origin;
try {
  origin = new URL(apiUrl).origin;
} catch {
  console.error(`patch-headers: ${apiUrl} is not a valid URL`);
  process.exit(1);
}

const path = join(process.cwd(), "out", "_headers");
const text = await readFile(path, "utf8");
if (text.includes(origin)) {
  console.log(`patch-headers: ${origin} already allowed`);
  process.exit(0);
}

const patched = text.replace(/(connect-src[^;]*)/, (match) => `${match} ${origin}`);
if (patched === text) {
  console.error("patch-headers: no connect-src directive found");
  process.exit(1);
}

await writeFile(path, patched, "utf8");
console.log(`patch-headers: added ${origin} to connect-src`);
