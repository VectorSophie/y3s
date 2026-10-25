// Generates the extension's PNG icons (no image deps): a YouTube-red rounded
// tile with a play mark and playlist lines, one split off like a phase divider.
// Antialiased by supersampling. Run: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "icons");
mkdirSync(outDir, { recursive: true });

const RED = [255, 0, 51]; // YouTube red #FF0033
const SS = 4; // samples per pixel per axis

// Shapes in unit coordinates (0..1).
const capsule = (x, y, x0, x1, cy, r) => {
  const dx = x - Math.max(x0, Math.min(x1, x));
  return dx * dx + (y - cy) ** 2 <= r * r;
};
const triangle = (x, y) => x >= 0.22 && x - 0.22 <= (0.12 - Math.abs(y - 0.3)) * 1.45;
const dashes = (x, y) => [0.22, 0.425, 0.63].some((x0) => capsule(x, y, x0 + 0.025, x0 + 0.165, 0.6, 0.025));

/** [alpha of the tile, alpha of white on top] at a point. */
function sample(x, y) {
  if (!inRounded(x, y, 0.22)) return [0, 0];
  const bar = 0.045;
  if (triangle(x, y) || capsule(x, y, 0.46, 0.78, 0.3, bar) || capsule(x, y, 0.265, 0.78, 0.45, bar) || capsule(x, y, 0.265, 0.78, 0.75, bar))
    return [1, 1];
  if (dashes(x, y)) return [1, 0.75];
  return [1, 0];
}

function inRounded(x, y, r) {
  const cx = Math.min(x, 1 - x);
  const cy = Math.min(y, 1 - y);
  if (cx >= r || cy >= r) return true;
  return (r - cx) ** 2 + (r - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let white = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const [t, w] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          tile += t;
          white += t * w;
        }
      const a = tile / (SS * SS);
      const w = tile ? white / tile : 0;
      for (const c of RED) raw[p++] = Math.round(c + (255 - c) * w);
      raw[p++] = Math.round(a * 255);
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(resolve(outDir, `icon${size}.png`), png(size));
  console.log(`wrote icons/icon${size}.png`);
}
