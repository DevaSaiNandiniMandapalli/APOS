// Next.js 16 static export on Windows writes RSC segment files as nested
// directories (__next.faq/__PAGE__.txt) while the client requests dotted names
// (__next.faq.__PAGE__.txt). Cloudflare/Linux builds already produce the dotted
// form. Normalize the Windows output so any static host can serve prefetches.
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../out/", import.meta.url));

async function filesUnder(directory, prefix = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...await filesUnder(join(directory, entry.name), [...prefix, entry.name]));
    } else {
      files.push({ from: join(directory, entry.name), name: [...prefix, entry.name].join(".") });
    }
  }
  return files;
}

async function flattenSegmentDirectory(parent, name) {
  const source = join(parent, name);
  const files = await filesUnder(source, [name]);
  for (const file of files) {
    const destination = join(parent, file.name);
    await rm(destination, { force: true });
    await rename(file.from, destination);
  }
  await rm(source, { recursive: true, force: true });
  return files.length;
}

async function walk(directory) {
  let moved = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(directory, entry.name);
    if (entry.name.startsWith("__next.")) {
      moved += await flattenSegmentDirectory(directory, entry.name);
    } else {
      moved += await walk(full);
    }
  }
  return moved;
}

const moved = await walk(ROOT);
if (moved > 0) {
  console.log(`Normalized ${moved} RSC export segment file(s) for static hosting.`);
}
