// QA-INT-007: chặn thay đổi PHÁ VỠ hợp đồng API ở PR — so docs/api/openapi.json hiện tại với bản ở nhánh gốc
// (`git show origin/main:docs/api/openapi.json`). Thuần Node, không phụ thuộc (đóng vai oasdiff).
//
// Đỏ khi: xoá path/method · bỏ response code đã có · đổi kiểu hoặc xoá thuộc tính (hoặc bỏ "required" của thuộc tính)
// trong response · thêm field BẮT BUỘC (hoặc tham số bắt buộc, hoặc body từ tuỳ chọn thành bắt buộc) vào request ·
// thu hẹp enum/đổi kiểu của request. Thêm path/method/response/thuộc tính/field tuỳ chọn thì được.
// Miễn tường minh: `x-breaking-approved: "<lý do>"` ở operation (mới); xoá operation thì khai ở gốc tài liệu
// `x-breaking-approved-removals: { "METHOD /path": "<lý do>" }` (operation đã xoá không còn chỗ để gắn khoá).
// Thiếu bản gốc / không có git → in "bỏ qua" và exit 0.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function resolveRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let cur = doc;
  for (const raw of ref.slice(2).split("/")) {
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = cur[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Bỏ `$ref` (tới 20 tầng) → đối tượng thật; ref hỏng → {}. */
function deref(doc, node) {
  let cur = node;
  for (let i = 0; i < 20 && isObj(cur) && typeof cur.$ref === "string"; i++) cur = resolveRef(doc, cur.$ref);
  return isObj(cur) ? cur : {};
}

/** Tập kiểu của schema (gộp anyOf/oneOf/allOf; `const`/`enum` không tính). Rỗng = "bất kỳ" (không khai). */
function typeSet(doc, schema, depth = 0) {
  const s = deref(doc, schema);
  const out = new Set();
  if (typeof s.type === "string") out.add(s.type);
  else if (Array.isArray(s.type)) for (const t of s.type) out.add(t);
  if (depth < 10)
    for (const k of ["anyOf", "oneOf"]) {
      if (!Array.isArray(s[k])) continue;
      const parts = s[k].map((x) => typeSet(doc, x, depth + 1));
      if (parts.some((p) => p.size === 0)) return new Set(); // một nhánh "bất kỳ" → bất kỳ
      for (const p of parts) for (const t of p) out.add(t);
    }
  if (out.has("integer") && out.has("number")) out.delete("integer");
  return out;
}

const subset = (a, b) => [...a].every((t) => b.has(t) || (t === "integer" && b.has("number")));

/** Thuộc tính + required của schema object, gộp allOf. */
function objectShape(doc, schema, depth = 0) {
  const s = deref(doc, schema);
  const props = { ...(isObj(s.properties) ? s.properties : {}) };
  const required = new Set(Array.isArray(s.required) ? s.required : []);
  if (depth < 10 && Array.isArray(s.allOf))
    for (const part of s.allOf) {
      const sub = objectShape(doc, part, depth + 1);
      Object.assign(props, sub.props);
      for (const r of sub.required) required.add(r);
    }
  return { props, required };
}

const enumOf = (doc, schema) => {
  const s = deref(doc, schema);
  if (Array.isArray(s.enum)) return s.enum;
  if ("const" in s) return [s.const];
  return null;
};

/**
 * So schema `a` (cũ) với `b` (mới). role "response": nhà cung cấp là server — kiểu mới phải ⊆ kiểu cũ, không được mất
 * thuộc tính. role "request": client là bên gửi — kiểu mới phải ⊇ kiểu cũ, enum không thu hẹp, không thêm required.
 */
function cmpSchema(oldDoc, newDoc, a, b, role, at, out, seen = new Set(), depth = 0) {
  if (depth > 30) return;
  const ra = deref(oldDoc, a);
  const rb = deref(newDoc, b);
  const key = `${at}`;
  if (seen.has(key)) return;
  seen.add(key);

  const ta = typeSet(oldDoc, ra);
  const tb = typeSet(newDoc, rb);
  if (ta.size > 0 && tb.size > 0) {
    const ok = role === "response" ? subset(tb, ta) : subset(ta, tb);
    if (!ok) out.push(`${at}: đổi kiểu ${[...ta].join("|")} → ${[...tb].join("|")}`);
  } else if (role === "response" && ta.size > 0 && tb.size === 0) {
    out.push(`${at}: bỏ ràng buộc kiểu ${[...ta].join("|")}`);
  }

  const ea = enumOf(oldDoc, ra);
  const eb = enumOf(newDoc, rb);
  if (role === "request" && ea && eb) {
    const missing = ea.filter((v) => !eb.some((w) => JSON.stringify(w) === JSON.stringify(v)));
    if (missing.length > 0)
      out.push(`${at}: thu hẹp enum, mất ${missing.map((v) => JSON.stringify(v)).join(", ")}`);
  }
  if (role === "request" && !ea && eb) out.push(`${at}: thêm enum (thu hẹp giá trị chấp nhận)`);

  const sa = objectShape(oldDoc, ra);
  const sb = objectShape(newDoc, rb);
  for (const [name, pa] of Object.entries(sa.props)) {
    const pb = sb.props[name];
    const here = `${at}.${name}`;
    if (pb === undefined) {
      if (role === "response") out.push(`${here}: thuộc tính bị xoá khỏi response`);
      continue;
    }
    if (role === "response" && sa.required.has(name) && !sb.required.has(name))
      out.push(`${here}: thuộc tính response không còn bắt buộc`);
    cmpSchema(oldDoc, newDoc, pa, pb, role, here, out, seen, depth + 1);
  }
  if (role === "request")
    for (const name of sb.required) {
      if (!sa.required.has(name)) out.push(`${at}.${name}: thêm field BẮT BUỘC vào request`);
    }
  if (ta.has("array") || tb.has("array")) {
    if (ra.items !== undefined && rb.items !== undefined)
      cmpSchema(oldDoc, newDoc, ra.items, rb.items, role, `${at}[]`, out, seen, depth + 1);
  }
}

function paramsOf(doc, item, op) {
  const all = [
    ...(Array.isArray(item.parameters) ? item.parameters : []),
    ...(Array.isArray(op.parameters) ? op.parameters : []),
  ];
  const map = new Map();
  for (const p of all) {
    const d = deref(doc, p);
    map.set(`${d.in}:${String(d.name).toLowerCase()}`, d);
  }
  return map;
}

function contentSchemas(doc, holder) {
  const h = deref(doc, holder);
  const out = new Map();
  if (isObj(h.content))
    for (const [ct, v] of Object.entries(h.content))
      if (isObj(v) && v.schema !== undefined) out.set(ct, v.schema);
  return out;
}

/** Danh sách thay đổi phá vỡ giữa hai tài liệu (đã trừ phần được miễn). */
export function compareOpenApi(oldDoc, newDoc) {
  const breaking = [];
  const approved = [];
  const removalApprovals = isObj(newDoc["x-breaking-approved-removals"])
    ? newDoc["x-breaking-approved-removals"]
    : {};
  const oldPaths = isObj(oldDoc.paths) ? oldDoc.paths : {};
  const newPaths = isObj(newDoc.paths) ? newDoc.paths : {};

  for (const [p, oldItem] of Object.entries(oldPaths)) {
    const newItem = newPaths[p];
    for (const m of METHODS) {
      if (!isObj(oldItem) || !isObj(oldItem[m])) continue;
      const at = `${m.toUpperCase()} ${p}`;
      const found = [];
      const newOp = isObj(newItem) && isObj(newItem[m]) ? newItem[m] : null;
      if (newOp === null) {
        found.push(`${at}: xoá ${newItem === undefined ? "path" : "method"}`);
        const why = removalApprovals[at];
        if (typeof why === "string" && why.trim() !== "") approved.push(`${found[0]} (miễn: ${why.trim()})`);
        else breaking.push(...found);
        continue;
      }
      const oldOp = oldItem[m];

      // response
      const oldRes = isObj(oldOp.responses) ? oldOp.responses : {};
      const newRes = isObj(newOp.responses) ? newOp.responses : {};
      for (const [code, ro] of Object.entries(oldRes)) {
        if (!(code in newRes)) {
          found.push(`${at}: bỏ response ${code}`);
          continue;
        }
        const sa = contentSchemas(oldDoc, ro);
        const sb = contentSchemas(newDoc, newRes[code]);
        for (const [ct, schema] of sa) {
          if (!sb.has(ct)) found.push(`${at} ${code}: bỏ nội dung ${ct}`);
          else cmpSchema(oldDoc, newDoc, schema, sb.get(ct), "response", `${at} ${code} ${ct}`, found);
        }
      }

      // request body
      const oldBody = oldOp.requestBody === undefined ? null : deref(oldDoc, oldOp.requestBody);
      const newBody = newOp.requestBody === undefined ? null : deref(newDoc, newOp.requestBody);
      if (newBody && newBody.required === true && !(oldBody && oldBody.required === true))
        found.push(`${at}: request body trở thành bắt buộc`);
      if (oldBody && newBody) {
        const sa = contentSchemas(oldDoc, oldBody);
        const sb = contentSchemas(newDoc, newBody);
        for (const [ct, schema] of sa) {
          if (!sb.has(ct)) found.push(`${at}: request không còn nhận ${ct}`);
          else cmpSchema(oldDoc, newDoc, schema, sb.get(ct), "request", `${at} request ${ct}`, found);
        }
      }

      // tham số
      const pa = paramsOf(oldDoc, oldItem, oldOp);
      const pb = paramsOf(newDoc, newItem, newOp);
      for (const [k, d] of pb) {
        const was = pa.get(k);
        if (!was) {
          if (d.required === true) found.push(`${at}: thêm tham số BẮT BUỘC ${k}`);
          continue;
        }
        if (d.required === true && was.required !== true)
          found.push(`${at}: tham số ${k} trở thành bắt buộc`);
        if (was.schema !== undefined && d.schema !== undefined)
          cmpSchema(oldDoc, newDoc, was.schema, d.schema, "request", `${at} tham số ${k}`, found);
      }

      const why = newOp["x-breaking-approved"];
      if (found.length > 0 && typeof why === "string" && why.trim() !== "")
        approved.push(...found.map((f) => `${f} (miễn: ${why.trim()})`));
      else breaking.push(...found);
    }
  }
  return { breaking, approved };
}

/** Bản gốc từ git; null + lý do khi không lấy được. */
export function baseFromGit(ref, file, run = execFileSync) {
  try {
    return {
      text: run("git", ["show", `${ref}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    };
  } catch (e) {
    return { reason: String(e?.stderr ?? e?.message ?? e).split("\n")[0] };
  }
}

export function main(argv = process.argv.slice(2), run = execFileSync) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const ref = arg("--base", "origin/main");
  const file = arg("--file", "docs/api/openapi.json");
  const base = baseFromGit(ref, file, run);
  if (base.text === undefined) {
    console.log(`check-api-breaking: bỏ qua — không có bản gốc ${ref}:${file} (${base.reason})`);
    return 0;
  }
  let oldDoc;
  let newDoc;
  try {
    oldDoc = JSON.parse(base.text);
  } catch {
    console.log(`check-api-breaking: bỏ qua — bản gốc ${ref}:${file} không phải JSON`);
    return 0;
  }
  try {
    newDoc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`check-api-breaking: không đọc được ${file}: ${e.message}`);
    return 1;
  }
  const { breaking, approved } = compareOpenApi(oldDoc, newDoc);
  for (const a of approved) console.log(`check-api-breaking: đã duyệt — ${a}`);
  if (breaking.length > 0) {
    console.error(
      `check-api-breaking: ${breaking.length} thay đổi phá vỡ hợp đồng so với ${ref}:\n  ${breaking.join("\n  ")}\n` +
        'Nếu cố ý: thêm `x-breaking-approved: "<lý do>"` vào operation (xoá operation: khoá `x-breaking-approved-removals` ở gốc) ' +
        "trong scripts/gen-openapi.ts (trường `breakingApproved`) rồi chạy `npm run -s gen:openapi`; hoặc thêm thay vì sửa/xoá.",
    );
    return 1;
  }
  console.log(`check-api-breaking: OK — không có thay đổi phá vỡ so với ${ref}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exit(main());
