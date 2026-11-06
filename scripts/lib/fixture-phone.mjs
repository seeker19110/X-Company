// check:docs (CMP-PRIV): số điện thoại VN dạng thật trong fixture test. Ranh giới hai đầu không phải chữ/số — chuỗi hex
// (chữ ký SigV4, sha256 trong test) có thể chứa đoạn 10 chữ số bắt đầu bằng 08… mà không phải số điện thoại.
const PHONE = /(?<![\dA-Za-z])(?:\+84|84|0)[35789]\d{8}(?![\dA-Za-z])/g;

/** Mọi chuỗi trông như số di động VN trong văn bản. */
export function phoneMatches(text) {
  return [...text.matchAll(PHONE)].map((m) => m[0]);
}
