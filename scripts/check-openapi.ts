// check:openapi (BASE-DOC-007, BE-API-001, BE-API-008): (1) sinh lại hợp đồng trong bộ nhớ và so với docs/api/openapi.json đã
// commit; (2) kiểm cấu trúc OpenAPI 3.1 tối thiểu (đóng vai linter spec — không thêm phụ thuộc spectral); (3) registry khớp
// cây app/api: đủ route, đủ phương thức, đúng hàm xử lý, cờ Idempotency-Key khớp mã. Phá vỡ hợp đồng ở PR: check-api-breaking.mjs.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { OPENAPI_FILE, REGISTRY, buildOpenApi, readCommitted, renderOpenApi } from "./gen-openapi.ts";

const root = path.resolve(import.meta.dirname, "..");
type Json = Record<string, unknown>;
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

/** Giải `#/a/b` (JSON Pointer) trong tài liệu; không có → undefined. */
export function resolveRef(doc: Json, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Json)[key];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Kiểm cấu trúc OpenAPI 3.1 tối thiểu; trả danh sách lỗi (rỗng = hợp lệ). */
export function lintOpenApi(doc: Json): string[] {
  const errs: string[] = [];
  if (typeof doc.openapi !== "string" || !/^3\.1\.\d+$/.test(doc.openapi))
    errs.push('"openapi" phải là 3.1.x');
  const info = doc.info;
  if (
    !isObj(info) ||
    typeof info.title !== "string" ||
    info.title === "" ||
    typeof info.version !== "string" ||
    info.version === ""
  )
    errs.push('"info" cần title và version không rỗng');
  const paths = doc.paths;
  if (!isObj(paths) || Object.keys(paths).length === 0) {
    errs.push('"paths" thiếu hoặc rỗng');
    return errs;
  }

  // $ref phải resolve được (quét cả tài liệu).
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${at}/${i}`));
    else if (isObj(node)) {
      if (typeof node.$ref === "string" && resolveRef(doc, node.$ref) === undefined)
        errs.push(`${at}: $ref không resolve được: ${node.$ref}`);
      for (const [k, v] of Object.entries(node)) walk(v, `${at}/${k}`);
    }
  };
  walk(doc, "#");

  const schemes =
    isObj(doc.components) && isObj(doc.components.securitySchemes) ? doc.components.securitySchemes : {};
  const declaredTags = new Set(
    Array.isArray(doc.tags) ? doc.tags.map((t) => (isObj(t) ? t.name : undefined)) : [],
  );
  const opIds = new Set<string>();
  const deref = (x: unknown): Json => {
    let cur = x;
    for (let i = 0; i < 10 && isObj(cur) && typeof cur.$ref === "string"; i++)
      cur = resolveRef(doc, cur.$ref);
    return isObj(cur) ? cur : {};
  };

  for (const [p, item] of Object.entries(paths)) {
    if (!p.startsWith("/")) errs.push(`path "${p}" phải bắt đầu bằng "/"`);
    if (!isObj(item)) {
      errs.push(`path "${p}" không phải đối tượng`);
      continue;
    }
    const inPath = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    let ops = 0;
    for (const [m, opRaw] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(m)) {
        if (m !== "parameters" && m !== "summary" && m !== "description" && !m.startsWith("x-"))
          errs.push(`${p}: khoá "${m}" không phải phương thức HTTP`);
        continue;
      }
      ops++;
      const at = `${m.toUpperCase()} ${p}`;
      if (!isObj(opRaw)) {
        errs.push(`${at}: operation không phải đối tượng`);
        continue;
      }
      if (typeof opRaw.operationId !== "string" || opRaw.operationId === "")
        errs.push(`${at}: thiếu operationId`);
      else if (opIds.has(opRaw.operationId)) errs.push(`${at}: operationId trùng "${opRaw.operationId}"`);
      else opIds.add(opRaw.operationId);
      for (const t of Array.isArray(opRaw.tags) ? opRaw.tags : [])
        if (!declaredTags.has(t)) errs.push(`${at}: tag "${String(t)}" chưa khai ở "tags"`);

      // path param: khai báo đủ, bắt buộc, và không khai thừa.
      const params = [...shared, ...(Array.isArray(opRaw.parameters) ? opRaw.parameters : [])].map(deref);
      const declared = new Map(
        params.filter((x) => x.in === "path").map((x) => [String(x.name), x] as const),
      );
      for (const name of inPath) {
        const d = declared.get(name);
        if (!d) errs.push(`${at}: path param {${name}} chưa khai báo`);
        else if (d.required !== true) errs.push(`${at}: path param {${name}} phải required: true`);
      }
      for (const name of declared.keys())
        if (!inPath.includes(name)) errs.push(`${at}: path param "${name}" khai thừa`);
      const seen = new Set<string>();
      for (const x of params) {
        const key = `${String(x.in)}:${String(x.name).toLowerCase()}`;
        if (seen.has(key)) errs.push(`${at}: tham số trùng ${key}`);
        seen.add(key);
        if (!isObj(x.schema) && !isObj(x.content)) errs.push(`${at}: tham số ${String(x.name)} thiếu schema`);
      }

      // requestBody
      if (opRaw.requestBody !== undefined) {
        const rb = deref(opRaw.requestBody);
        const content = rb.content;
        if (!isObj(content) || Object.keys(content).length === 0)
          errs.push(`${at}: requestBody thiếu content`);
        else
          for (const [ct, v] of Object.entries(content))
            if (!isObj(v) || !isObj(v.schema)) errs.push(`${at}: requestBody ${ct} thiếu schema`);
      }

      // responses: có ít nhất một 2xx; mọi response có mô tả.
      const responses = opRaw.responses;
      if (!isObj(responses) || Object.keys(responses).length === 0) {
        errs.push(`${at}: thiếu responses`);
      } else {
        if (!Object.keys(responses).some((c) => /^2\d\d$/.test(c))) errs.push(`${at}: không có response 2xx`);
        for (const [code, r] of Object.entries(responses)) {
          if (!/^([1-5]\d\d|default)$/.test(code)) errs.push(`${at}: mã response "${code}" không hợp lệ`);
          const rr = deref(r);
          if (typeof rr.description !== "string" || rr.description === "")
            errs.push(`${at} ${code}: response thiếu description`);
          if (isObj(rr.headers))
            for (const [hn, h] of Object.entries(rr.headers))
              if (!isObj(h) || typeof h.description !== "string")
                errs.push(`${at} ${code}: header ${hn} thiếu description`);
        }
      }

      // security phải trỏ tới scheme đã khai.
      for (const req of Array.isArray(opRaw.security) ? opRaw.security : [])
        if (isObj(req))
          for (const name of Object.keys(req))
            if (!(name in schemes)) errs.push(`${at}: security "${name}" chưa khai ở securitySchemes`);
    }
    if (ops === 0) errs.push(`path "${p}" không có operation nào`);
  }
  return errs;
}

// ---- registry ↔ cây app/api -------------------------------------------------------------------------------------------

function listApiRouteFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") out.push(path.relative(rootDir, p).split(path.sep).join("/"));
    }
  };
  const dir = path.join(rootDir, "app/api");
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** `app/api/app/tasks/[id]/[action]/route.ts` → `/api/app/tasks/{id}/{action}`. */
const pathOfRouteFile = (f: string): string =>
  "/" +
  f
    .split("/")
    .slice(1, -1)
    .join("/")
    .replace(/\[([^\]]+)\]/g, "{$1}");

/** Khối mã của `export const <name> = …` tới `export` kế tiếp (đủ để dò cờ idempotent). */
function handlerBlock(src: string, name: string): string | null {
  const start = src.search(new RegExp(`export (?:const|async function|function) ${name}\\b`));
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport /);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Registry phải khớp cây app/api (đủ/thừa route + phương thức), trỏ đúng hàm xử lý, cờ Idempotency-Key khớp mã. */
export function registryErrors(rootDir: string, registry = REGISTRY): string[] {
  const errs: string[] = [];
  const files = listApiRouteFiles(rootDir);
  const realPaths = new Set(files.map(pathOfRouteFile));
  for (const f of files) {
    const p = pathOfRouteFile(f);
    const entry = registry[p];
    if (!entry) {
      errs.push(`route chưa có trong registry OpenAPI (scripts/gen-openapi.ts): ${p} (${f})`);
      continue;
    }
    const src = readFileSync(path.join(rootDir, f), "utf8");
    const exported = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*(\w+)/g)];
    const real = new Map(exported.map((m) => [m[1]!, m[2]!]));
    for (const [method, handler] of real) {
      const op = entry[method as "GET" | "POST"];
      if (!op) {
        errs.push(`${method} ${p}: có trong ${f} nhưng chưa có trong registry OpenAPI`);
        continue;
      }
      const [file, name] = op.source.split("#");
      if (name !== handler) errs.push(`${method} ${p}: registry trỏ ${op.source}, route.ts xuất ${handler}`);
      const imp = new RegExp(
        `import\\s*\\{[^}]*\\b${handler}\\b[^}]*\\}\\s*from\\s*"@/([^"]+?)(?:\\.ts)?"`,
      ).exec(src);
      if (imp && `${imp[1]}.ts` !== file)
        errs.push(`${method} ${p}: route.ts nhập ${handler} từ ${imp[1]}, registry ghi ${file}`);
      const code =
        file && existsSync(path.join(rootDir, file)) ? readFileSync(path.join(rootDir, file), "utf8") : null;
      const block = code && name ? handlerBlock(code, name) : null;
      if (block === null) {
        errs.push(`${method} ${p}: không thấy "export const ${String(name)}" trong ${String(file)}`);
        continue;
      }
      const guarded = /\bidempotent:\s*true\b|\bIDEMPOTENT\b/.test(block);
      if (op.idempotency === "guard" && !guarded)
        errs.push(
          `${method} ${p}: registry nói Idempotency-Key bắt buộc (guard) nhưng mã không bật idempotent`,
        );
      if (op.idempotency !== "guard" && guarded)
        errs.push(`${method} ${p}: mã bật idempotent nhưng registry không khai Idempotency-Key bắt buộc`);
    }
    for (const m of Object.keys(entry))
      if (!real.has(m)) errs.push(`${m} ${p}: có trong registry nhưng ${f} không xuất`);
  }
  for (const p of Object.keys(registry))
    if (!realPaths.has(p)) errs.push(`registry OpenAPI có route không tồn tại trong app/api: ${p}`);
  return errs;
}

/** Mọi POST ghi nghiệp vụ dưới /api/app (guard) có tham số Idempotency-Key bắt buộc trong tài liệu sinh ra. */
export function idempotencyErrors(doc: Json): string[] {
  const errs: string[] = [];
  const paths = isObj(doc.paths) ? doc.paths : {};
  for (const [p, item] of Object.entries(paths)) {
    const op = isObj(item) && isObj(item.post) ? item.post : null;
    if (!op) continue;
    const params = (Array.isArray(op.parameters) ? op.parameters : []).map((x) => {
      let cur: unknown = x;
      for (let i = 0; i < 5 && isObj(cur) && typeof cur.$ref === "string"; i++)
        cur = resolveRef(doc, cur.$ref);
      return isObj(cur) ? cur : {};
    });
    const key = params.find((x) => String(x.name).toLowerCase() === "idempotency-key");
    const reg = REGISTRY[p]?.POST;
    if (reg && reg.idempotency !== "none" && !(key && key.required === true))
      errs.push(`POST ${p}: thiếu Idempotency-Key bắt buộc`);
    if (reg && reg.idempotency !== "none") {
      const rs = isObj(op.responses) ? op.responses : {};
      for (const c of ["400", "409"])
        if (!(c in rs)) errs.push(`POST ${p}: thiếu response ${c} của idempotency`);
      if (reg.idempotency === "guard" && !("422" in rs))
        errs.push(`POST ${p}: thiếu response 422 của idempotency`);
    }
  }
  return errs;
}

export async function checkOpenApi(rootDir: string = root): Promise<string[]> {
  const errs: string[] = [];
  const committed = readCommitted(rootDir);
  const doc = buildOpenApi();
  if (committed === null) errs.push(`thiếu ${OPENAPI_FILE} — chạy: npm run -s gen:openapi`);
  else if (committed !== (await renderOpenApi(doc)))
    errs.push(
      `${OPENAPI_FILE} lệch so với mã (registry/schema zod đã đổi) — chạy: npm run -s gen:openapi rồi commit tệp`,
    );
  errs.push(...lintOpenApi(doc as Json), ...registryErrors(rootDir), ...idempotencyErrors(doc as Json));
  if (committed !== null) {
    try {
      errs.push(...lintOpenApi(JSON.parse(committed) as Json).map((e) => `(tệp commit) ${e}`));
    } catch {
      errs.push(`${OPENAPI_FILE} không phải JSON hợp lệ`);
    }
  }
  return errs;
}

if (process.argv[1] === import.meta.filename) {
  const errs = await checkOpenApi();
  if (errs.length > 0) {
    console.error(errs.map((e) => `check-openapi: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(
    `check-openapi: OK (${Object.keys(REGISTRY).length} đường dẫn khớp cây app/api; ${OPENAPI_FILE} khớp bản sinh)`,
  );
}
