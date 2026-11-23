// Tiny image fixtures generated in code (STU-13 / BRD-09 tests): no binary files committed.
// Plain Node (zlib only) so Vitest and Playwright can both import it.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A valid RGB PNG of `width`×`height`. `pixel(x, y)` returns [r, g, b]; the default draws a
 * two-colour diagonal so it is visibly an image in screenshots.
 */
export function makePng(
  width = 8,
  height = 8,
  pixel: (x: number, y: number) => [number, number, number] = (x, y) =>
    x + y < (width + height) / 2 ? [37, 99, 235] : [251, 191, 36],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Magic-byte headers of the other accepted types (content after the header is irrelevant). */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const GIF_BYTES = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(8)]);
export const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBPVP8 ", "ascii"),
  Buffer.alloc(8),
]);
export const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>',
);
