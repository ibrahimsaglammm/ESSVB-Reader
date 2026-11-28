import { describe, expect, it } from "vitest";
import { buildPwaChapterSrcDoc, parseBrowserBookFile, sanitizeHtmlChapter } from "./pwaBookParser";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i] ?? 0;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const item of entries) {
    const nameBytes = enc.encode(item.name);
    const dataBytes = enc.encode(item.content);
    const sum = crc32(dataBytes);

    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true);
    lhv.setUint16(4, 20, true);
    lhv.setUint16(8, 0, true);
    lhv.setUint32(14, sum, true);
    lhv.setUint32(18, dataBytes.length, true);
    lhv.setUint32(22, dataBytes.length, true);
    lhv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint32(16, sum, true);
    cdv.setUint32(20, dataBytes.length, true);
    cdv.setUint32(24, dataBytes.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    localParts.push(lh, dataBytes);
    cdParts.push(cd);
    offset += lh.length + dataBytes.length;
  }

  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const totalLen = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of [...localParts, ...cdParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

describe("pwaBookParser", () => {
  it("strips dangerous scripts/handlers/remote URLs and enforces strict CSP", () => {
    const dirty = `<h1>Merhaba Dünya</h1><p onclick="alert(1)">Türkçe içerik</p><script>fetch("https://evil.example")</script><img src="https://evil.example/a.png" />`;
    const clean = sanitizeHtmlChapter(dirty);
    expect(clean.bodyHtml).not.toContain("<script");
    expect(clean.bodyHtml).not.toContain("onclick");
    expect(clean.bodyHtml).not.toContain("https://evil.example");
    expect(clean.plainText).toContain("Türkçe içerik");

    const doc = buildPwaChapterSrcDoc("Test", clean.bodyHtml, "body { color: #111; }");
    expect(doc).toContain("default-src 'none'");
  });

  it("parses a stored EPUB archive offline including Turkish metadata", async () => {
    const zipBytes = makeStoredZip([
      {
        name: "META-INF/container.xml",
        content: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      },
      {
        name: "OEBPS/content.opf",
        content: `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Çevrimdışı iPad Kitabı</dc:title><dc:creator>Örnek Yazar</dc:creator><dc:language>tr</dc:language></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
      },
      {
        name: "OEBPS/ch1.xhtml",
        content: `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Giriş</h1><p>İstanbul sabahı sessizdi.</p></body></html>`,
      },
    ]);

    const parsed = await parseBrowserBookFile("ipad-test.epub", zipBytes);
    expect(parsed.title).toBe("Çevrimdışı iPad Kitabı");
    expect(parsed.author).toBe("Örnek Yazar");
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]?.plainText).toContain("İstanbul sabahı sessizdi.");
  });
});
