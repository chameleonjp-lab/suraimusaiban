// Disposable LOCAL ONLY PostgreSQL/REST and the real anonymous Edge handler.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHmac, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, openSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const restImage = "docker.io/postgrest/postgrest@sha256:1347d7552b88f17832912c06afbf7c43209af6eeeb60834b04aae12c9bd9d5cc";
const postgresImage = "postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb";
const action = process.argv[2] ?? "test";
const root = "/tmp/slime-trial-db";
mkdirSync(root, { recursive: true });
const secret = "local-tests-only-slime-trial-jwt-secret-at-least-32-characters";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(role) {
  const data = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: "supabase", role, iat: 1, exp: 4102444800 })}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}
const anon = jwt("anon");
const service = jwt("service_role");
const docker = (...args) => execFileSync("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
const names = ["slime-trial-kong", "slime-trial-rest", "slime-trial-auth", "slime-trial-postgres"];
function stop() {
  const pidPath = `${root}/gateway.pid`;
  if (existsSync(pidPath)) {
    const pid = Number(readFileSync(pidPath, "utf8"));
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("local-anonymous-gateway.mjs")) process.kill(pid, "SIGTERM");
    } catch {}
  }
  for (const name of names) { try { docker("rm", "-f", "-v", name); } catch {} }
  try { docker("network", "rm", "slime-trial-test"); } catch {}
}
function run(name, image, args, env = {}) {
  docker("run", "-d", "--name", name, "--network", "slime-trial-test", ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]), ...args, image);
}
async function connect() {
  const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await client.connect(); return client;
}
async function retry(work) {
  let error;
  for (let i = 0; i < 60; i++) {
    try { return await work(); } catch (caught) { error = caught; await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  throw error;
}
if (action === "stop") { stop(); process.exit(); }
if (action === "start") {
  stop(); docker("network", "create", "slime-trial-test");
  run("slime-trial-postgres", postgresImage, ["-p", "127.0.0.1:54322:5432"], { POSTGRES_PASSWORD: "postgres" });
  const client = await retry(connect);
  await client.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login noinherit password 'local-authenticator'; grant anon,authenticated,service_role to authenticator;
    create schema auth; create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
  await client.end();
  run("slime-trial-rest", restImage, ["-p", "127.0.0.1:54324:3000"], {
    PGRST_DB_URI: "postgres://authenticator:local-authenticator@slime-trial-postgres:5432/postgres", PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: secret,
  });
  writeFileSync(`${root}/server.json`, JSON.stringify({ supabaseUrl: "http://127.0.0.1:54321", restUrl: "http://127.0.0.1:54324", serviceKey: service, publicKeys: [anon], allowedOrigins: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"] }), { mode: 0o600 });
  const log = openSync(`${root}/gateway.log`, "a", 0o600);
  const gateway = spawn(process.execPath, [resolve("scripts/local-anonymous-gateway.mjs"), `${root}/server.json`], { cwd: process.cwd(), detached: true, stdio: ["ignore", log, log] });
  gateway.unref(); writeFileSync(`${root}/gateway.pid`, String(gateway.pid), { mode: 0o600 });
  // Public local-only settings; service JWT stays in server.json.
  writeFileSync(`${root}/public.env`, `SUPABASE_TEST_URL=http://127.0.0.1:54321\nSUPABASE_TEST_ANON_KEY=${anon}\nVITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=${anon}\n`, { mode: 0o600 });
  await retry(async () => { const response = await fetch("http://127.0.0.1:54321/healthz"); if (!response.ok) throw Error(`Gateway HTTP ${response.status}`); });
  await retry(async () => { const response = await fetch("http://127.0.0.1:54324/"); if (!response.ok) throw Error(`REST HTTP ${response.status}`); });
  console.log("Local PostgreSQL, PostgREST and anonymous gateway ready; no Auth service is started.");
}
if (action === "reset" || action === "migrate") {
  const client = await connect();
  try {
    if (action === "reset") await client.query("drop schema public cascade; drop schema if exists slime_trial_private cascade; drop schema if exists slime_harness cascade; create schema public authorization postgres; grant usage on schema public to anon, authenticated;");
    await client.query("create schema if not exists slime_harness; create table if not exists slime_harness.applied_migrations(name text primary key, checksum text not null)");
    for (const name of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
      const sql = readFileSync(`supabase/migrations/${name}`, "utf8"); if (!sql.trim()) continue;
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = await client.query("select checksum from slime_harness.applied_migrations where name=$1", [name]);
      if (previous.rowCount) { if (previous.rows[0].checksum !== checksum) throw Error(`Applied migration changed: ${name}; reset disposable local fixture`); continue; }
      await client.query("begin");
      try { await client.query(sql); await client.query("insert into slime_harness.applied_migrations values ($1,$2)", [name, checksum]); await client.query("commit"); }
      catch (error) { await client.query("rollback"); throw error; }
    }
    await client.query("notify pgrst,'reload schema'");
  } finally { await client.end(); }
  console.log("Local migrations applied.");
}
if (action === "test") {
  const vars = Object.fromEntries(readFileSync(`${root}/public.env`, "utf8").trim().split("\n").map((line) => { const split = line.indexOf("="); return [line.slice(0, split), line.slice(split + 1)]; }));
  const result = spawnSync("npm", ["run", "test:db", "--", ...process.argv.slice(3)], { env: { ...process.env, ...vars }, stdio: "inherit" }); process.exit(result.status ?? 1);
}
