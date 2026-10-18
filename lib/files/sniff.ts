// Dò loại tệp theo NỘI DUNG (magic bytes), không tin đuôi tên hay Content-Type của client (THREAT-MODEL, §12).
export interface Sniffed {
  mime: string;
  ext: string;
}

const starts = (b: Buffer, sig: number[], offset = 0) => sig.every((x, i) => b[offset + i] === x);

export function sniff(b: Buffer): Sniffed | null {
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" };
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (starts(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8))
    return { mime: "image/webp", ext: "webp" };
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML: zip có [Content_Types].xml; phân biệt docx/xlsx theo thư mục word/ hoặc xl/ trong vùng đầu tệp.
    const head = b.subarray(0, Math.min(b.length, 64 * 1024)).toString("latin1");
    if (!head.includes("[Content_Types].xml")) return null;
    if (head.includes("word/"))
      return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    if (head.includes("xl/"))
      return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    return null;
  }
  return null;
}
