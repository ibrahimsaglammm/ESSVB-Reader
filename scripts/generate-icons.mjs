import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const outDir = path.resolve("src-tauri/icons");
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function renderLogoPixels(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const corner = size * 0.22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const nx = x / size;
      const ny = y / size;

      // Rounded square badge
      const dx = Math.max(corner - x, 0, x - (size - 1 - corner));
      const dy = Math.max(corner - y, 0, y - (size - 1 - corner));
      const dist = Math.hypot(dx, dy);

      if (dist > corner) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
        continue;
      }

      // Deep slate-teal gradient background
      let r = Math.round(20 + ny * 18);
      let g = Math.round(62 + ny * 38);
      let b = Math.round(82 + nx * 24);
      let a = 255;

      // Crisp inner book motif (two open pages + bookmark ribbon)
      const inBookBox = nx >= 0.22 && nx <= 0.78 && ny >= 0.24 && ny <= 0.76;
      const spineGap = Math.abs(nx - 0.5) < 0.025;
      if (inBookBox && !spineGap) {
        const leftPage = nx < 0.5;
        const pageTopCurve = 0.26 + Math.sin(((nx - 0.22) / 0.56) * Math.PI) * 0.03;
        const pageBotCurve = 0.74 - Math.sin(((nx - 0.22) / 0.56) * Math.PI) * 0.02;
        if (ny >= pageTopCurve && ny <= pageBotCurve) {
          r = leftPage ? 246 : 234;
          g = leftPage ? 244 : 231;
          b = leftPage ? 236 : 220;

          // Subtle text lines on pages
          const linePhase = (ny - 0.34) * 18;
          const onLineBand = linePhase > 0 && linePhase < 6 && Math.abs(linePhase - Math.round(linePhase)) < 0.22;
          const insideMargin = (nx > 0.27 && nx < 0.44) || (nx > 0.56 && nx < 0.73);
          if (onLineBand && insideMargin) {
            r = 120;
            g = 142;
            b = 152;
          }
        }
      }

      // Coral-amber bookmark ribbon on right page
      if (nx >= 0.61 && nx <= 0.68 && ny >= 0.22 && ny <= 0.46) {
        const notch = ny > 0.40 && Math.abs(nx - 0.645) < (ny - 0.40) * 0.6;
        if (!notch) {
          r = 214;
          g = 94;
          b = 58;
        }
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = a;
    }
  }
  return rgba;
}

function encodePng(size) {
  const rgba = renderLogoPixels(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(pngEntries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngEntries.length, 4);

  const dirs = [];
  let offset = 6 + pngEntries.length * 16;
  for (const { size, buf } of pngEntries) {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(buf.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += buf.length;
    dirs.push(dir);
  }
  return Buffer.concat([header, ...dirs, ...pngEntries.map((e) => e.buf)]);
}

const p32 = encodePng(32);
const p64 = encodePng(64);
const p128 = encodePng(128);
const p256 = encodePng(256);

fs.writeFileSync(path.join(outDir, "32x32.png"), p32);
fs.writeFileSync(path.join(outDir, "128x128.png"), p128);
fs.writeFileSync(path.join(outDir, "128x128@2x.png"), p256);
fs.writeFileSync(path.join(outDir, "icon.png"), p256);
fs.writeFileSync(
  path.join(outDir, "icon.ico"),
  encodeIco([
    { size: 32, buf: p32 },
    { size: 64, buf: p64 },
    { size: 128, buf: p128 },
    { size: 256, buf: p256 },
  ]),
);

console.log("Generated ESSVB-Reader icons in", outDir);
