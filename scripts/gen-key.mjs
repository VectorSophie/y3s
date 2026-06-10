// Pins a stable Chrome extension ID by generating an RSA key pair and deriving
// the manifest "key" (public SPKI, safe to commit) + the resulting extension
// ID. The private key (key.pem) is kept locally and gitignored — it's only
// needed later to pack a .crx, not to load unpacked.
//
// Re-running is idempotent: if key.pem exists, the same key (and ID) is reused.
//
//   node scripts/gen-key.mjs            # print key + id
//   node scripts/gen-key.mjs --write    # also patch manifest.json "key"
import { createPublicKey, createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = resolve(root, "key.pem");
const manifestPath = resolve(root, "manifest.json");

// Reuse an existing private key so the ID never changes; otherwise create one.
let privateKeyPem;
if (existsSync(keyPath)) {
  privateKeyPem = readFileSync(keyPath, "utf8");
} else {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  privateKeyPem = privateKey;
  writeFileSync(keyPath, privateKeyPem);
  console.log("wrote key.pem (gitignored — keep it private)");
}

// Public key in DER/SPKI form: this is exactly what Chrome hashes for the ID
// and what goes into manifest "key" (base64).
const pubDer = createPublicKey(privateKeyPem).export({ type: "spki", format: "der" });
const manifestKey = pubDer.toString("base64");

// Extension ID = first 128 bits of SHA-256(pubDer), hex digits mapped 0-f → a-p.
const hash = createHash("sha256").update(pubDer).digest();
const HEX = "0123456789abcdef";
const MAP = "abcdefghijklmnop";
const id = [...hash.subarray(0, 16)]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("")
  .split("")
  .map((c) => MAP[HEX.indexOf(c)])
  .join("");

console.log("\nExtension ID:", id);
console.log("\nmanifest \"key\":\n" + manifestKey + "\n");

if (process.argv.includes("--write")) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.key = manifestKey;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("patched manifest.json with \"key\".");
}
