// Build script for the y3s Chrome extension.
//
//   node scripts/build.mjs           one-off build → dist/
//   node scripts/build.mjs --watch   rebuild on change
//   node scripts/build.mjs --e2e=http://127.0.0.1:8765
//       test build → dist-e2e/: skips Google sign-in and talks to a fake API
//       at the given base URL. Never load this one in your real browser.
//
import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const e2eArg = process.argv.find((a) => a.startsWith("--e2e="));
const e2eBase = e2eArg ? e2eArg.slice("--e2e=".length) : "";
const dist = resolve(root, e2eBase ? "dist-e2e" : "dist");

const common = {
  bundle: true,
  sourcemap: true,
  target: "chrome114",
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
    __Y3S_E2E__: e2eBase ? "true" : "false",
    __Y3S_API_BASE__: JSON.stringify(e2eBase ? `${e2eBase}/youtube/v3` : ""),
  },
};

const entries = [
  { entryPoints: [resolve(root, "src/content/content-script.ts")], outfile: resolve(dist, "content.js"), format: "iife" },
  {
    entryPoints: [resolve(root, "src/background/service-worker.ts")],
    outfile: resolve(dist, "service-worker.js"),
    format: "esm",
  },
];

async function copyStatic() {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  if (e2eBase) {
    const origin = new URL(e2eBase);
    manifest.name += " (E2E TEST BUILD)";
    manifest.host_permissions = [...manifest.host_permissions, `${origin.protocol}//${origin.hostname}/*`];
  }
  await writeFile(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
  await cp(resolve(root, "src/styles/content.css"), resolve(dist, "content.css"));
  const icons = resolve(root, "icons");
  if (existsSync(icons)) await cp(icons, resolve(dist, "icons"), { recursive: true });
}

async function run() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  if (watch) {
    const ctxs = await Promise.all(entries.map((e) => context({ ...common, ...e })));
    await Promise.all(ctxs.map((c) => c.watch()));
    await copyStatic();
    console.log("[y3s] watching for changes… (CSS and manifest copy on restart)");
  } else {
    await Promise.all(entries.map((e) => build({ ...common, ...e })));
    await copyStatic();
    console.log(`[y3s] build complete → ${dist}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
