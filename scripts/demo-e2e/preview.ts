import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { DEMO_BASE, DIST, PREVIEW_PORT } from "./config.js";

const types: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!["GET", "HEAD"].includes(request.method ?? "") || url.search || url.hash) {
    respond(response, 404, "Not found");
    return;
  }
  const file = routeFile(url.pathname);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    respond(response, 404, "Not found");
    return;
  }
  response.statusCode = 200;
  response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  response.setHeader("cache-control", "no-store");
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
});

server.listen(PREVIEW_PORT, "127.0.0.1", () => {
  console.log(`READY http://127.0.0.1:${PREVIEW_PORT}${DEMO_BASE}`);
});

function routeFile(pathname: string): string | undefined {
  if (pathname === DEMO_BASE) return resolve(DIST, "index.html");
  const prefix = `${DEMO_BASE}assets/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const name = pathname.slice(DEMO_BASE.length);
  if (!/^assets\/[A-Za-z0-9_.-]+$/u.test(name)) return undefined;
  return resolve(DIST, name);
}

function respond(response: import("node:http").ServerResponse, status: number, text: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(text);
}

function stop(): void {
  server.close((error) => process.exit(error ? 1 : 0));
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);
