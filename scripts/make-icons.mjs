// Sinh biểu tượng PWA (PNG RGBA) không cần phụ thuộc: nền màu thương hiệu, ô vuông trắng ở giữa (vùng an toàn maskable).
// Chạy: node scripts/make-icons.mjs — kết quả commit vào public/icons/.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BRAND = [0x0f, 0x3d, 0x5e, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, inset) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const lo = Math.round(size * inset);
  const hi = size - lo;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inner = x >= lo && x < hi && y >= lo && y < hi && (x < lo + size * 0.12 || y > hi - size * 0.12);
      const px = inner ? WHITE : BRAND;
      raw.set(px, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
writeFileSync("public/icons/icon-192.png", png(192, 0.25));
writeFileSync("public/icons/icon-512.png", png(512, 0.25));
writeFileSync("public/icons/maskable-512.png", png(512, 0.3));
writeFileSync("public/icons/apple-touch-icon.png", png(180, 0.25));
console.log("Đã sinh biểu tượng trong public/icons/");
