// Generates placeholder PNG icons (no image deps) for the extension action.
// A dark rounded tile with a red "y3" wordmark feel — flat, but valid PNGs.
// Run once: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "icons");
mkdirSync(outDir, { recursive: true });

const BG = [18, 18, 18, 255]; // near-black
const FG = [224, 52, 75, 255]; // y3s red

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
  const r = size * 0.22; // corner radius
  const inset = size * 0.5; // mark band
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const rounded = inCorner(x, y, size, r);
      // simple diagonal red accent band through the middle
      const band = Math.abs(x - y) < inset * 0.34 && x > size * 0.18 && x < size * 0.82;
      const color = rounded ? [0, 0, 0, 0] : band ? FG : BG;
      raw[p++] = color[0];
      raw[p++] = color[1];
      raw[p++] = color[2];
      raw[p++] = color[3];
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

// Returns true if (x,y) is outside the rounded-rectangle (transparent corner).
function inCorner(x, y, size, r) {
  const cx = Math.min(x, size - 1 - x);
  const cy = Math.min(y, size - 1 - y);
  if (cx >= r || cy >= r) return false;
  const dx = r - cx;
  const dy = r - cy;
  return dx * dx + dy * dy > r * r;
}

for (const size of [16, 48, 128]) {
  writeFileSync(resolve(outDir, `icon${size}.png`), png(size));
  console.log(`wrote icons/icon${size}.png`);
}
