// Serves the static export in out/ the way Cloudflare does (clean URLs, 404 page),
// and proxies /api/ai to a running APOS deployment for local testing.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../out/", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const API_ORIGIN = process.env.APOS_API_ORIGIN ?? "https://apos.nxtgensec.org";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

const existing = async (path) => {
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
};

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/api/ai") {
    const body = await new Promise((resolve) => {
      let data = "";
      request.on("data", (chunk) => (data += chunk));
      request.on("end", () => resolve(data));
    });
    const upstream = await fetch(`${API_ORIGIN}/api/ai`, {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: request.method === "GET" ? undefined : body,
    });
    response.writeHead(upstream.status, { "content-type": "application/json" });
    response.end(await upstream.text());
    return;
  }

  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(ROOT, path), join(ROOT, `${path}.html`), join(ROOT, path, "index.html"), join(ROOT, `${path}.txt`)]) {
    const file = await existing(candidate);
    if (file) {
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      response.end(await readFile(file));
      return;
    }
  }
  let notFound;
  try {
    notFound = await readFile(join(ROOT, "404.html"));
  } catch {
    // A build can briefly replace out/ while the preview server is running.
    // Keep serving a simple 404 instead of crashing the whole test server.
    notFound = Buffer.from("<!doctype html><html lang=\"en\"><title>Not found</title><h1>404 — Not found</h1></html>");
  }
  response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  response.end(notFound);
}).listen(PORT, () => console.log(`Static export served at http://localhost:${PORT}`));
