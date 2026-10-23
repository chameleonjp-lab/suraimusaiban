// Disposable LOCAL ONLY harness: real PostgreSQL + official Supabase Auth/REST.
// The upstream Postgres image avoids Supabase's much larger vfs storage demand.
import { execFileSync, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { Client } from "pg";
// Official Docker Hub manifests match the previously verified ECR images.
// Digest pins keep the runtime identical while avoiding the ECR quota failure.
const authImage =
  "docker.io/supabase/gotrue@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b"; // GoTrue v2.197.0
const restImage =
  "docker.io/postgrest/postgrest@sha256:1347d7552b88f17832912c06afbf7c43209af6eeeb60834b04aae12c9bd9d5cc"; // PostgREST v16.5
const gatewayImage =
  "docker.io/library/kong@sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d"; // Kong 2.8.1
const action = process.argv[2] ?? "test";
const root = "/tmp/slime-trial-db";
mkdirSync(root, { recursive: true });
const secret = "local-tests-only-slime-trial-jwt-secret-at-least-32-characters";
const encoded = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const head = encoded({ alg: "HS256", typ: "JWT" }),
  payload = encoded({ iss: "supabase", role: "anon", iat: 1, exp: 4102444800 });
const anon = `${head}.${payload}.${createHmac("sha256", secret).update(`${head}.${payload}`).digest("base64url")}`;
const docker = (...args) =>
  execFileSync("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
const names = [
  "slime-trial-kong",
  "slime-trial-rest",
  "slime-trial-auth",
  "slime-trial-postgres",
];
function run(name, image, args, env = {}) {
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "slime-trial-test",
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    ...args,
    image,
  );
}
async function connect() {
  const c = new Client({
    connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await c.connect();
  return c;
}
async function retry(fn) {
  let error;
  for (let i = 0; i < 60; i++) {
    try {
      return await fn();
    } catch (e) {
      error = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw error;
}
if (action === "stop") {
  for (const n of names) {
    try {
      docker("rm", "-f", "-v", n);
    } catch {}
  }
  try {
    docker("network", "rm", "slime-trial-test");
  } catch {}
  process.exit();
}
if (action === "start") {
  try {
    docker("network", "inspect", "slime-trial-test");
  } catch {
    docker("network", "create", "slime-trial-test");
  }
  run(
    names[3],
    "postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb",
    ["-p", "127.0.0.1:54322:5432"],
    { POSTGRES_PASSWORD: "postgres" },
  );
  const c = await retry(connect);
  await c.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login noinherit password 'local-authenticator'; grant anon,authenticated,service_role to authenticator;
    create role supabase_auth_admin login createrole password 'local-auth-admin';
    create schema auth authorization supabase_auth_admin;
    create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    alter function auth.uid() owner to supabase_auth_admin;
    grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
  await c.end();
  run(names[2], authImage, [], {
    GOTRUE_API_HOST: "0.0.0.0",
    GOTRUE_API_PORT: "9999",
    API_EXTERNAL_URL: "http://127.0.0.1:54321/auth/v1",
    GOTRUE_SITE_URL: "http://localhost:5173",
    GOTRUE_URI_ALLOW_LIST: "http://localhost:5173,http://127.0.0.1:5173",
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL:
      "postgres://supabase_auth_admin:local-auth-admin@slime-trial-postgres:5432/postgres?search_path=auth",
    GOTRUE_DB_NAMESPACE: "auth",
    GOTRUE_JWT_SECRET: secret,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: "true",
    GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: "10000",
    GOTRUE_RATE_LIMIT_HEADER: "X-Forwarded-For",
    GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
  });
  run(names[1], restImage, [], {
    PGRST_DB_URI:
      "postgres://authenticator:local-authenticator@slime-trial-postgres:5432/postgres",
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: secret,
  });
  writeFileSync(
    `${root}/kong.yml`,
    `_format_version: "2.1"\nservices:\n  - name: auth\n    url: http://slime-trial-auth:9999\n    routes:\n      - name: auth-route\n        paths: ["/auth/v1/"]\n        strip_path: true\n  - name: rest\n    url: http://slime-trial-rest:3000\n    routes:\n      - name: rest-route\n        paths: ["/rest/v1/"]\n        strip_path: true\nplugins:\n  - name: cors\n    config:\n      origins: ["*"]\n      headers: ["Authorization", "apikey", "Content-Type", "X-Client-Info", "Prefer", "Accept-Profile", "Content-Profile", "x-supabase-api-version"]\n      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS", "HEAD"]\n      exposed_headers: ["Content-Range"]\n`,
  );
  chmodSync(`${root}/kong.yml`, 0o644);
  docker(
    "create",
    "--name",
    names[0],
    "--network",
    "slime-trial-test",
    "-p",
    "127.0.0.1:54321:8000",
    "-e",
    "KONG_DATABASE=off",
    "-e",
    "KONG_DECLARATIVE_CONFIG=/tmp/kong.yml",
    "-e",
    "KONG_PROXY_LISTEN=0.0.0.0:8000",
    "-e",
    "KONG_ADMIN_LISTEN=off",
    gatewayImage,
  );
  docker("cp", `${root}/kong.yml`, `${names[0]}:/tmp/kong.yml`);
  docker("start", names[0]);
  writeFileSync(
    `${root}/public.env`,
    `SUPABASE_TEST_URL=http://127.0.0.1:54321\nSUPABASE_TEST_ANON_KEY=${anon}\nVITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=${anon}\n`,
    { mode: 0o600 },
  );
  await retry(async () => {
    const r = await fetch("http://127.0.0.1:54321/auth/v1/health");
    if (!r.ok) throw Error(`Auth not ready: ${r.status}`);
  });
  console.log(
    "Local PostgreSQL, Supabase Auth and REST ready. Public-only test/browser env: /tmp/slime-trial-db/public.env",
  );
}
if (action === "reset") {
  const c = await connect();
  try {
    await c.query(
      "drop schema public cascade; drop schema private cascade; create schema public authorization postgres; grant usage on schema public to anon, authenticated;",
    );
  } finally {
    await c.end();
  }
}
if (action === "migrate" || action === "reset") {
  const c = await connect();
  try {
    for (const file of readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql"))
      .sort())
      await c.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await c.query("notify pgrst,'reload schema'");
  } finally {
    await c.end();
  }
  console.log("Local migrations applied.");
}
if (action === "test") {
  const vars = Object.fromEntries(
    readFileSync(`${root}/public.env`, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
  const r = spawnSync(
    "npm",
    ["run", "test:db", "--", ...process.argv.slice(3)],
    { env: { ...process.env, ...vars }, stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}
