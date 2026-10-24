// LOCAL TEST HARNESS ONLY. Never publish server.json or this gateway.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const address of [config.supabaseUrl, config.restUrl]) {
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(address).hostname)) throw new Error("Local gateway refuses non-loopback backends");
}
let handler;
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? "/", config.supabaseUrl);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined && !["host", "connection", "transfer-encoding"].includes(key)) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    headers.set("x-forwarded-for", incoming.socket.remoteAddress ?? "127.0.0.1");
    const origin = headers.get("origin");
    const cors = origin && config.allowedOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS,HEAD", "Access-Control-Expose-Headers": "content-range", Vary: "Origin" } : {};
    if (url.pathname === "/healthz") { outgoing.writeHead(200, {"Content-Type":"application/json"}); outgoing.end('{"ok":true}'); return; }
    const isBody = !["GET", "HEAD"].includes(incoming.method ?? "GET");
    const request = new Request(url, { method: incoming.method, headers, ...(isBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}) });
    let response;
    if (url.pathname.startsWith("/rest/v1/")) {
      if (incoming.method === "OPTIONS") response = new Response(null, {status:204});
      else response = await fetch(`${config.restUrl}/${url.pathname.slice("/rest/v1/".length)}${url.search}`, request);
      for (const [key, value] of Object.entries(cors)) outgoing.setHeader(key, value);
    } else if (url.pathname === "/functions/v1/slime-trial-submit") {
      if (!handler) { const module = await import("../supabase/functions/slime-trial-submit/handler.ts"); handler = module.createSubmitHandler(config); }
      response = await handler(request);
    } else response = new Response('{"error":"NOT_FOUND"}', {status:404,headers:{"Content-Type":"application/json"}});
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => { if (!["transfer-encoding", "connection", "content-encoding"].includes(key)) outgoing.setHeader(key, value); });
    const bytes = Buffer.from(await response.arrayBuffer());
    outgoing.setHeader("Content-Length", String(bytes.byteLength));
    outgoing.end(bytes);
  } catch {
    outgoing.writeHead(503, {"Content-Type":"application/json","Cache-Control":"no-store"}); outgoing.end('{"error":"LOCAL_GATEWAY_UNAVAILABLE"}');
  }
});
server.listen(54321, "127.0.0.1", () => writeFileSync(join(dirname(process.argv[2]), "gateway.pid"), String(process.pid), {mode:0o600}));
process.on("SIGTERM", () => server.close(() => process.exit()));
