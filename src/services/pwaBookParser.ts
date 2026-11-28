import type { TocItem } from "../types/models";
import type { StoredBookPayload, StoredChapterEntry } from "./pwaStorage";

const MAX_ZIP_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024;
const CHAPTER_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';";

export interface ParsedPwaBook {
  title: string;
  author: string;
  language: string;
  publisher: string;
  description: string;
  formatLabel: string;
  toc: TocItem[];
  chapters: StoredChapterEntry[];
  pageMap: number[];
  fileHash: string;
}

interface ZipCentralEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeZipEntryPath(name: string): string | null {
  const norm = name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!norm || norm.includes("..") || norm.includes("\0")) return null;
  return norm;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Tarayıcı DecompressionStream API desteklemiyor.");
  }
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function readZipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const minTail = Math.max(0, bytes.length - 65557);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= minTail; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Geçerli bir ZIP/EPUB arşivi bulunamadı.");
  }

  const totalEntries = readUint16LE(bytes, eocdOffset + 10);
  const cdOffset = readUint32LE(bytes, eocdOffset + 16);
  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error("Arşiv dosya sayısı güvenlik sınırını aşıyor.");
  }

  const entries: ZipCentralEntry[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let cursor = cdOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries && cursor + 46 <= bytes.length; i += 1) {
    const sig = readUint32LE(bytes, cursor);
    if (sig !== 0x02014b50) break;

    const compressionMethod = readUint16LE(bytes, cursor + 10);
    const compressedSize = readUint32LE(bytes, cursor + 20);
    const uncompressedSize = readUint32LE(bytes, cursor + 24);
    const nameLen = readUint16LE(bytes, cursor + 28);
    const extraLen = readUint16LE(bytes, cursor + 30);
    const commentLen = readUint16LE(bytes, cursor + 32);
    const localHeaderOffset = readUint32LE(bytes, cursor + 42);

    const rawName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    const safeName = sanitizeZipEntryPath(rawName);
    if (!safeName || safeName.endsWith("/")) continue;

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error("Arşiv boyutu güvenlik sınırını (50 MiB) aşıyor.");
    }

    entries.push({
      fileName: safeName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
  }

  const out = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const lh = entry.localHeaderOffset;
    if (lh + 30 > bytes.length || readUint32LE(bytes, lh) !== 0x04034b50) continue;
    const localNameLen = readUint16LE(bytes, lh + 26);
    const localExtraLen = readUint16LE(bytes, lh + 28);
    const dataStart = lh + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.length) continue;

    const slice = bytes.subarray(dataStart, dataEnd);
    if (entry.compressionMethod === 0) {
      out.set(entry.fileName, slice);
    } else if (entry.compressionMethod === 8) {
      const inflated = await inflateRawBytes(slice);
      out.set(entry.fileName, inflated);
    }
  }
  return out;
}

export function sanitizeHtmlChapter(rawHtml: string): { bodyHtml: string; plainText: string } {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    doc
      .querySelectorAll("script, iframe, object, embed, link[rel='stylesheet'], base, form, meta")
      .forEach((el) => el.remove());

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const el = node as Element;
      for (const attr of Array.from(el.attributes)) {
        const lower = attr.name.toLowerCase();
        const val = attr.value.trim().toLowerCase();
        if (lower.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (
          (lower === "src" || lower === "href" || lower === "poster") &&
          (val.startsWith("javascript:") ||
            val.startsWith("vbscript:") ||
            val.startsWith("http://") ||
            val.startsWith("https://"))
        ) {
          el.removeAttribute(attr.name);
        }
      }
      node = walker.nextNode();
    }

    const bodyHtml = doc.body.innerHTML.trim() || "<p></p>";
    const plainText = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
    return { bodyHtml, plainText };
  }

  const stripped = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/on[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, "");
  return {
    bodyHtml: stripped,
    plainText: stripped
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

export function buildPwaChapterSrcDoc(title: string, bodyHtml: string, themeCss: string): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CHAPTER_CSP}" />
<title>${escapeHtml(title)}</title>
<style>${themeCss}</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function resolveRelativePath(baseFile: string, href: string): string {
  const cleanHref = href.split("#")[0]?.split("?")[0] ?? "";
  const baseParts = baseFile.split("/").slice(0, -1);
  for (const seg of cleanHref.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      baseParts.pop();
    } else {
      baseParts.push(seg);
    }
  }
  return baseParts.join("/");
}

async function parseEpubBytes(bytes: Uint8Array, fileName: string): Promise<ParsedPwaBook> {
  const files = await readZipEntries(bytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const containerRaw = files.get("META-INF/container.xml");
  if (!containerRaw) {
    throw new Error("EPUB içinde container.xml bulunamadı.");
  }

  const containerXml = decoder.decode(containerRaw);
  const rootPathMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  const opfPath = rootPathMatch?.[1] ?? "content.opf";
  const opfRaw = files.get(opfPath);
  if (!opfRaw) {
    throw new Error("EPUB OPF paketi okunamadı.");
  }
  const opfXml = decoder.decode(opfRaw);
  const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");

  const getMeta = (tagSuffix: string): string => {
    const els = Array.from(opfDoc.getElementsByTagName("*"));
    const match = els.find(
      (el) => el.localName === tagSuffix || el.tagName.endsWith(`:${tagSuffix}`),
    );
    return match?.textContent?.trim() ?? "";
  };

  const title = getMeta("title") || fileName.replace(/\.[^.]+$/, "");
  const author = getMeta("creator") || "Bilinmeyen Yazar";
  const language = getMeta("language") || "tr";
  const publisher = getMeta("publisher") || "";
  const description = getMeta("description") || "";

  const manifestMap = new Map<string, string>();
  for (const item of Array.from(opfDoc.getElementsByTagName("item"))) {
    const id = item.getAttribute("id") ?? "";
    const href = item.getAttribute("href") ?? "";
    if (id && href) manifestMap.set(id, resolveRelativePath(opfPath, href));
  }

  const spinePaths: string[] = [];
  for (const ref of Array.from(opfDoc.getElementsByTagName("itemref"))) {
    const idref = ref.getAttribute("idref") ?? "";
    const resolved = manifestMap.get(idref);
    if (resolved) spinePaths.push(resolved);
  }

  const chapters: StoredChapterEntry[] = [];
  const toc: TocItem[] = [];

  spinePaths.forEach((path, idx) => {
    const rawChapter = files.get(path);
    if (!rawChapter) return;
    const html = decoder.decode(rawChapter);
    const sanitized = sanitizeHtmlChapter(html);
    if (!sanitized.plainText) return;
    const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const chTitle =
      headingMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || `Bölüm ${chapters.length + 1}`;
    chapters.push({
      title: chTitle,
      bodyHtml: sanitized.bodyHtml,
      plainText: sanitized.plainText,
    });
    toc.push({
      id: `toc-${idx}`,
      title: chTitle,
      href: path,
      spineIndex: chapters.length - 1,
      depth: 0,
    });
  });

  if (chapters.length === 0) {
    chapters.push({
      title,
      bodyHtml: "<p>Bu EPUB dosyasında okunabilir metin bölümü bulunamadı.</p>",
      plainText: title,
    });
    toc.push({ id: "toc-0", title, href: "", spineIndex: 0, depth: 0 });
  }

  return {
    title,
    author,
    language,
    publisher,
    description,
    formatLabel: "EPUB (PWA)",
    toc,
    chapters,
    pageMap: chapters.map((c) => Math.max(1, c.plainText.length)),
    fileHash: `pwa-${bytes.byteLength}-${title.slice(0, 16)}`,
  };
}

async function parseDocxBytes(bytes: Uint8Array, fileName: string): Promise<ParsedPwaBook> {
  const files = await readZipEntries(bytes);
  const docRaw = files.get("word/document.xml");
  if (!docRaw) {
    throw new Error("DOCX içinde word/document.xml bulunamadı.");
  }
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(docRaw);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagName("*"))
    .filter((el) => el.localName === "p")
    .map((p) =>
      Array.from(p.getElementsByTagName("*"))
        .filter((t) => t.localName === "t")
        .map((t) => t.textContent ?? "")
        .join("")
        .trim(),
    )
    .filter(Boolean);

  const title = fileName.replace(/\.[^.]+$/, "");
  const bodyHtml =
    paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n") || `<p>${escapeHtml(title)}</p>`;
  const plainText = paragraphs.join("\n") || title;
  const chapters: StoredChapterEntry[] = [{ title, bodyHtml, plainText }];
  return {
    title,
    author: "Word Belgesi",
    language: "tr",
    publisher: "",
    description: "",
    formatLabel: "DOCX",
    toc: [{ id: "toc-0", title, href: "", spineIndex: 0, depth: 0 }],
    chapters,
    pageMap: [Math.max(1, plainText.length)],
    fileHash: `pwa-docx-${bytes.byteLength}-${title.slice(0, 16)}`,
  };
}

export async function parseBrowserBookFile(
  fileName: string,
  bytes: Uint8Array,
): Promise<ParsedPwaBook> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".epub")) {
    return parseEpubBytes(bytes, fileName);
  }
  if (lower.endsWith(".docx")) {
    return parseDocxBytes(bytes, fileName);
  }
  if (lower.endsWith(".txt")) {
    const txt = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
    const title = fileName.replace(/\.[^.]+$/, "");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const bodyHtml =
      lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n") || `<p>${escapeHtml(txt)}</p>`;
    return {
      title,
      author: "Yerel Belge",
      language: "tr",
      publisher: "",
      description: "",
      formatLabel: "TXT",
      toc: [{ id: "toc-0", title, href: "", spineIndex: 0, depth: 0 }],
      chapters: [{ title, bodyHtml, plainText: txt || title }],
      pageMap: [Math.max(1, txt.length)],
      fileHash: `pwa-txt-${bytes.byteLength}`,
    };
  }
  throw new Error(
    "Tarayıcı/PWA modunda çevrimdışı açmak için .epub veya .docx yükleyin (PDF ve .doc için Android APK veya masaüstü sürümünü kullanın).",
  );
}

export function buildStoredPayload(bookId: string, parsed: ParsedPwaBook): StoredBookPayload {
  return {
    id: bookId,
    toc: parsed.toc,
    pageMap: parsed.pageMap,
    chapters: parsed.chapters,
  };
}
