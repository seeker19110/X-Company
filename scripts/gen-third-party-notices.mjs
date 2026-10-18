// THIRD_PARTY_NOTICES.md sinh từ package-lock.json (CMP-LIC-001): phụ thuộc production (không dev) — tên, phiên bản, license.
// `node scripts/gen-third-party-notices.mjs` ghi tệp; `--check` chỉ so (exit 1 khi lệch). Kết quả tất định (sắp xếp, không ngày giờ).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "THIRD_PARTY_NOTICES.md");

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

export function render(lock) {
  const rows = new Map();
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (path === "" || p.link || p.dev) continue;
    const name = path.split("node_modules/").pop();
    rows.set(`${name}@${p.version}`, { name, version: p.version, license: p.license || "UNKNOWN" });
  }
  const list = [...rows.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en", { numeric: true }),
  );
  return [
    "# Thông báo phần mềm bên thứ ba",
    "",
    "<!-- Sinh tự động bởi scripts/gen-third-party-notices.mjs từ package-lock.json — KHÔNG sửa tay (CI: git diff --exit-code). -->",
    "",
    "Sản phẩm X-Company dùng các thành phần mã nguồn mở dưới đây (phụ thuộc production, gồm cả gián tiếp). Mỗi thành phần thuộc",
    "bản quyền của tác giả và được cấp phép theo license ghi bên cạnh; toàn văn license nằm trong gói tương ứng ở `node_modules/`.",
    "Chính sách chấp nhận license: `license-policy.yaml`. SBOM CycloneDX của mỗi build: artifact CI `sbom`.",
    "",
    `Tổng: ${list.length} thành phần.`,
    "",
    "| Thành phần | Phiên bản | License |",
    "| --- | --- | --- |",
    ...list.map((r) => `| ${esc(r.name)} | ${esc(r.version)} | ${esc(r.license)} |`),
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = render(JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8")));
  if (process.argv.includes("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur !== text) {
      console.error("THIRD_PARTY_NOTICES.md lệch package-lock.json — chạy `npm run -s notices` rồi commit.");
      process.exit(1);
    }
    console.log("THIRD_PARTY_NOTICES.md: khớp lockfile");
  } else {
    writeFileSync(OUT, text);
    console.log("Đã ghi THIRD_PARTY_NOTICES.md");
  }
}
