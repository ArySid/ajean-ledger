#!/usr/bin/env node
/**
 * Cloudflare Workers build (OpenNext adapter). `npm run cf:build`. See docs/HOSTING.md.
 *
 * 1. `next build`
 * 2. Size patch: @x402/core loads the optional browser paywall (`@x402/paywall`, ~7.6 MiB of wallet UI
 *    for humans) with a guarded `import("@x402/paywall")`. On Workers we replace that import with a
 *    rejected promise, so x402 core serves its built-in minimal "Payment Required" HTML to browsers.
 *    Agents are unaffected (they read the PAYMENT-REQUIRED header + JSON body). Worker: 18 MiB → ~10 MiB.
 * 3. `opennextjs-cloudflare build --skipNextBuild`
 * 4. Secret hygiene: OpenNext copies the values of .env / .env.local / .env.production(.local) into
 *    `.open-next/cloudflare/next-env.mjs`, which is bundled INTO the Worker. This repo keeps wallet keys in
 *    .env.local, so the file is emptied here; runtime config comes only from wrangler `vars` + `wrangler
 *    secret put`. Then the output is scanned for any secret-looking value from local env files: the build
 *    fails if one is found.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// 1. Next build, in OpenNext's standalone mode (what `opennextjs-cloudflare build` sets itself)
run("npx", ["next", "build"], { NEXT_PRIVATE_STANDALONE: "true", NEXT_PRIVATE_OUTPUT_TRACE_ROOT: root });

// 2. Drop the browser paywall from the server output
const PAYWALL_IMPORT = /import\(\s*["']@x402\/paywall["']\s*\)/g;
const STUB = 'Promise.reject(new Error("@x402/paywall is not bundled in the Cloudflare Workers build"))';
let patched = 0;
const serverDirs = [path.join(root, ".next", "server"), path.join(root, ".next", "standalone", ".next", "server")];
for (const f of serverDirs.filter(existsSync).flatMap((d) => [...walk(d)])) {
  if (!/\.(c|m)?js$/.test(f)) continue;
  const src = readFileSync(f, "utf8");
  if (!src.includes("@x402/paywall")) continue;
  const out = src.replace(PAYWALL_IMPORT, () => (patched++, STUB));
  if (out !== src) writeFileSync(f, out);
}
console.log(`[cf-build] @x402/paywall imports replaced: ${patched}${patched === 0 ? " (none found: Worker will be ~7.6 MiB larger)" : ""}`);

// 3. OpenNext adapter
run("npx", ["opennextjs-cloudflare", "build", "--skipNextBuild"]);

// 4a. Never ship .env* values inside the Worker bundle
const envMjs = path.join(root, ".open-next", "cloudflare", "next-env.mjs");
if (existsSync(envMjs)) {
  const dropped = new Set();
  for (const m of readFileSync(envMjs, "utf8").matchAll(/"([A-Z0-9_]+)":/g)) dropped.add(m[1]);
  writeFileSync(
    envMjs,
    "// Emptied by scripts/cf-build.mjs: runtime config comes from wrangler vars/secrets only.\n" +
      "export const production = {};\nexport const development = {};\nexport const test = {};\n",
  );
  if (dropped.size) console.log(`[cf-build] removed .env* values from the Worker bundle (names only): ${[...dropped].join(", ")}`);
}

// 4b. Scan the output for secret-looking values from local env files
const SECRETISH = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL|POSTGRES_URL|REST_URL)/i;
const secrets = [];
for (const f of [".env", ".env.local", ".env.production", ".env.production.local", ".dev.vars"]) {
  const p = path.join(root, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*["']?([^"'#\s]+)/);
    if (m && SECRETISH.test(m[1]) && m[2].length >= 16) secrets.push({ name: m[1], file: f, value: m[2] });
  }
}
const leaks = [];
if (secrets.length) {
  for (const f of walk(path.join(root, ".open-next"))) {
    if (statSync(f).size > 64 * 1024 * 1024) continue;
    const buf = readFileSync(f);
    for (const s of secrets) if (buf.includes(s.value)) leaks.push(`${s.name} (${s.file}) found in ${path.relative(root, f)}`);
  }
}
if (leaks.length) {
  console.error(`[cf-build] SECRET LEAK — refusing to continue:\n  ${leaks.join("\n  ")}`);
  process.exit(1);
}
console.log(`[cf-build] secret scan OK (${secrets.length} local secret value(s) checked, none in .open-next/)`);
