// Build script for the y3s Chrome extension.
//
// Bundles the TypeScript sources with esbuild into /dist and copies static
// assets (manifest, icons). No framework, no webpack config — just two entry
// points and a copy step.
//
//   node scripts/build.mjs          one-off build
//   node scripts/build.mjs --watch  rebuild on change
//
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");

/** Shared esbuild options. CSS is loaded as a raw string so it can be injected
 *  into the drawer's shadow root instead of a stylesheet link. */
const common = {
  bundle: true,
  sourcemap: true,
  target: "chrome114",
  logLevel: "info",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
};

const entries = [
  // Content script: classic IIFE so it runs directly when injected.
  {
    entryPoints: [resolve(root, "src/content/content-script.ts")],
    outfile: resolve(dist, "content.js"),
    format: "iife",
  },
  // Service worker: ES module worker (manifest declares "type":"module").
  {
    entryPoints: [resolve(root, "src/background/service-worker.ts")],
    outfile: resolve(dist, "service-worker.js"),
    format: "esm",
  },
];

async function copyStatic() {
  await cp(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
  const icons = resolve(root, "icons");
  if (existsSync(icons)) {
    await cp(icons, resolve(dist, "icons"), { recursive: true });
  }
}

async function run() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  if (watch) {
    const ctxs = await Promise.all(
      entries.map((e) => context({ ...common, ...e })),
    );
    await Promise.all(ctxs.map((c) => c.watch()));
    await copyStatic();
    console.log("[y3s] watching for changes…");
  } else {
    await Promise.all(entries.map((e) => build({ ...common, ...e })));
    await copyStatic();
    console.log("[y3s] build complete → dist/");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
