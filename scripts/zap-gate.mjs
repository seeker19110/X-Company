// Cổng DAST (SEC-WEB-001, SEC-WEB-004): đọc báo cáo JSON của ZAP (`-J`) và thất bại khi còn cảnh báo mức Medium (riskcode ≥ 2) trở lên
// chưa nằm trong security/zap/allowlist.json. Báo cáo thiếu/hỏng/không quét site nào = thất bại (không để "không quét gì" thành xanh).
// Dùng: node scripts/zap-gate.mjs <report.json>...
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MIN_RISK = 2;
const ALLOWLIST = new URL("../security/zap/allowlist.json", import.meta.url);

/**
 * Đọc allowlist: mỗi mục phải có pluginid + reason (không lý do = không hợp lệ). `paths` (tuỳ chọn) = mảng regex đường dẫn URL:
 * khi có, mục chỉ miễn cảnh báo mà MỌI vị trí đều thuộc các đường dẫn đó (vị trí mới ngoài phạm vi → vẫn đỏ). Trả Map pluginid → RegExp[] | null.
 */
export function parseAllowlist(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.allow)) throw new Error("allowlist.json phải có mảng `allow`");
  const out = new Map();
  for (const e of data.allow) {
    if (
      typeof e?.pluginid !== "string" ||
      e.pluginid === "" ||
      typeof e?.reason !== "string" ||
      e.reason.trim() === ""
    )
      throw new Error(`mục allowlist cần pluginid và reason: ${JSON.stringify(e)}`);
    if (
      e.paths !== undefined &&
      (!Array.isArray(e.paths) ||
        e.paths.length === 0 ||
        !e.paths.every((x) => typeof x === "string" && x.startsWith("^") && x.endsWith("$")))
    )
      throw new Error(`paths phải là mảng regex neo ^…$ không rỗng: ${JSON.stringify(e)}`);
    if (e.paths?.some((x) => x.includes("|")))
      throw new Error(
        `paths không dùng "|" (mỗi đường dẫn một mục, tránh "^/a$|.*$" khớp mọi thứ): ${e.pluginid}`,
      );
    if (out.has(e.pluginid)) throw new Error(`pluginid trùng trong allowlist: ${e.pluginid}`);
    out.set(e.pluginid, e.paths === undefined ? null : e.paths.map((x) => new RegExp(x)));
  }
  return out;
}

/** Cảnh báo có được miễn không: Set (pluginid miễn hoàn toàn) hoặc Map từ parseAllowlist (có thể giới hạn theo đường dẫn). */
function isAllowed(a, allowed) {
  const id = String(a.pluginid);
  if (allowed instanceof Set) return allowed.has(id);
  if (!allowed.has(id)) return false;
  const paths = allowed.get(id);
  if (paths === null) return true;
  const inst = Array.isArray(a.instances) ? a.instances : [];
  return (
    inst.length > 0 &&
    inst.every((i) => {
      let p;
      try {
        p = new URL(String(i.uri)).pathname;
      } catch {
        return false;
      }
      return paths.some((re) => re.test(p));
    })
  );
}

/** Cảnh báo vi phạm của một báo cáo ZAP. Ném lỗi khi báo cáo không có site nào. */
export function violations(report, allowed = new Set(), minRisk = MIN_RISK) {
  const sites = report?.site;
  if (!Array.isArray(sites) || sites.length === 0)
    throw new Error("báo cáo ZAP không có site nào — không quét được gì");
  const out = [];
  for (const site of sites) {
    for (const a of site.alerts ?? []) {
      const risk = Number(a.riskcode);
      if (!Number.isFinite(risk)) throw new Error(`riskcode không đọc được: ${JSON.stringify(a.pluginid)}`);
      if (risk >= minRisk && !isAllowed(a, allowed))
        out.push({
          pluginid: String(a.pluginid),
          name: a.name ?? a.alert ?? "?",
          risk,
          count: Number(a.count ?? 0),
        });
    }
  }
  return out;
}

function main(files) {
  if (files.length === 0) throw new Error("thiếu đường dẫn báo cáo ZAP");
  const allowed = parseAllowlist(readFileSync(ALLOWLIST, "utf8"));
  let bad = 0;
  for (const f of files) {
    const found = violations(JSON.parse(readFileSync(f, "utf8")), allowed);
    for (const v of found)
      console.error(`${f}: [${v.pluginid}] ${v.name} (mức ${v.risk}, ${v.count} vị trí)`);
    bad += found.length;
  }
  if (bad > 0) {
    console.error(`ZAP: ${bad} cảnh báo mức Medium trở lên chưa duyệt`);
    process.exit(1);
  }
  console.log(`ZAP: 0 cảnh báo Medium trở lên trong ${files.length} báo cáo`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`zap-gate: ${e.message}`);
    process.exit(2);
  }
}
