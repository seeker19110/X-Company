// Hợp đồng OpenAPI (BASE-DOC-007, BE-API-001, BE-API-008, QA-INT-007): sinh tất định, đủ mọi route, Idempotency-Key ở mọi
// POST ghi, linter cấu trúc, và kiểm phá vỡ hợp đồng (đỏ / xanh / miễn / thiếu bản gốc).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listRouteFiles, urlOf } from "../../scripts/check-routes.ts";
import { OPENAPI_FILE, REGISTRY, buildOpenApi, renderOpenApi } from "../../scripts/gen-openapi.ts";
import {
  checkOpenApi,
  idempotencyErrors,
  lintOpenApi,
  registryErrors,
  resolveRef,
} from "../../scripts/check-openapi.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import { compareOpenApi, main as breakingMain } from "../../scripts/check-api-breaking.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- tài liệu OpenAPI là JSON tuỳ ý, kiểm bằng test
const clone = (d: unknown): Doc => JSON.parse(JSON.stringify(d)) as Doc;
const doc = (): Doc => buildOpenApi() as Doc;

function tmpRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xc-openapi-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

// ---- sinh ------------------------------------------------------------------------------------------------------------

test("sinh tất định: hai lần dựng cho cùng từng byte, và khớp tệp đã commit", async () => {
  const a = await renderOpenApi();
  const b = await renderOpenApi();
  assert.equal(a, b);
  assert.equal(JSON.stringify(buildOpenApi()), JSON.stringify(buildOpenApi()));
  assert.equal(readFileSync(path.join(ROOT, OPENAPI_FILE), "utf8"), a, "chạy: npm run -s gen:openapi");
  assert.deepEqual(await checkOpenApi(ROOT), []);
});

test("tài liệu là OpenAPI 3.1, tự lint sạch và mọi $ref resolve", () => {
  const d = doc();
  assert.match(d.openapi, /^3\.1\./);
  assert.deepEqual(lintOpenApi(d), []);
  assert.notEqual(resolveRef(d, "#/components/schemas/Problem"), undefined);
  assert.equal(resolveRef(d, "#/components/schemas/KhongCo"), undefined);
});

test("mọi route dưới app/api có mặt, không thừa (test đỏ khi thiếu/thừa)", () => {
  const real = listRouteFiles(ROOT)
    .filter((f) => f.startsWith("app/api/") && f.endsWith("route.ts"))
    .map((f) => urlOf(f).replace(/\[([^\]]+)\]/g, "{$1}"))
    .sort();
  assert.equal(real.length, 29);
  assert.deepEqual(Object.keys(doc().paths).sort(), real);
  assert.deepEqual(registryErrors(ROOT), []);
});

test("registryErrors bắt route thiếu, thừa, sai hàm xử lý và cờ idempotent lệch mã", () => {
  const dir = tmpRoot({
    "app/api/a/route.ts":
      'import { h } from "@/lib/x/routes";\nexport const POST = h;\nexport const GET = h;\n',
    "app/api/b/[id]/route.ts": 'import { g } from "@/lib/x/routes";\nexport const GET = g;\n',
    "lib/x/routes.ts":
      "export const h = withActor(async () => r, { idempotent: true });\nexport const g = withActor(async () => r);\n",
  });
  try {
    const op = (source: string, idempotency: string) => ({ source, idempotency });
    const reg = {
      "/api/a": { POST: op("lib/x/routes.ts#h", "none") }, // mã bật idempotent, registry không khai; thiếu GET
      "/api/b/{id}": { GET: op("lib/x/routes.ts#h", "none") }, // sai tên hàm
      "/api/c": { GET: op("lib/x/routes.ts#g", "none") }, // không có trong cây
    };
    const errs = registryErrors(dir, reg as never);
    assert.ok(
      errs.some((e) => e.includes("GET /api/a") && e.includes("chưa có trong registry")),
      errs.join("\n"),
    );
    assert.ok(
      errs.some((e) => e.includes("POST /api/a") && e.includes("mã bật idempotent")),
      errs.join("\n"),
    );
    assert.ok(
      errs.some((e) => e.includes("GET /api/b/{id}") && e.includes("route.ts xuất g")),
      errs.join("\n"),
    );
    assert.ok(
      errs.some((e) => e.includes("/api/c") && e.includes("không tồn tại")),
      errs.join("\n"),
    );
    const missing = registryErrors(dir, {} as never);
    assert.ok(missing.some((e) => e.includes("/api/b/{id}") && e.includes("chưa có trong registry")));
    const guardMissing = registryErrors(dir, {
      "/api/a": { POST: op("lib/x/routes.ts#h", "guard"), GET: op("lib/x/routes.ts#h", "guard") },
      "/api/b/{id}": { GET: op("lib/x/routes.ts#g", "guard") },
    } as never);
    assert.ok(guardMissing.some((e) => e.includes("GET /api/b/{id}") && e.includes("không bật idempotent")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Idempotency-Key (BE-API-008) --------------------------------------------------------------------------------------

/** POST không dùng guard Idempotency-Key: xác thực, đăng xuất, đồng bộ (khoá theo bản ghi), form công khai (submission_id), beacon RUM (không ghi nghiệp vụ, mẫu ẩn danh), đánh dấu đã đọc thông báo (lũy đẳng tự nhiên, trạng thái giao diện của chính mình — T-080). */
const NO_GUARD_POST = [
  "/api/app/auth/login",
  "/api/app/auth/logout",
  "/api/app/auth/mfa",
  "/api/app/notifications/read",
  "/api/app/sync",
  "/api/public/applications",
  "/api/public/inquiries",
  "/api/public/rum",
];

test("mọi POST ghi nghiệp vụ có Idempotency-Key bắt buộc + 400/409/422/phát lại; ngoại lệ có danh sách", () => {
  const d = doc();
  const withKey: string[] = [];
  const without: string[] = [];
  for (const [p, item] of Object.entries<Doc>(d.paths)) {
    const op = item.post as Doc | undefined;
    if (!op) continue;
    const params = ((op.parameters ?? []) as Doc[]).map((x) =>
      x.$ref !== undefined ? (resolveRef(d, x.$ref) as Doc) : x,
    );
    const key = params.find((x) => x.name === "Idempotency-Key");
    if (key) {
      withKey.push(p);
      assert.equal(key.in, "header");
      assert.equal(key.required, true, p);
      for (const c of ["400", "409"]) assert.notEqual(op.responses[c], undefined, `${p} thiếu ${c}`);
    } else without.push(p);
  }
  assert.deepEqual(without.sort(), NO_GUARD_POST);
  assert.equal(withKey.length, 10);
  // Phát lại: mã 2xx của POST guard có header Idempotent-Replayed; 422 = khoá dùng cho nội dung khác.
  const leave = d.paths["/api/app/leave-requests"].post;
  assert.notEqual(leave.responses["201"].headers["Idempotent-Replayed"], undefined);
  assert.notEqual(leave.responses["422"], undefined);
  assert.notEqual(leave.responses["409"], undefined);
  assert.match(d.components.parameters.IdempotencyKey.description, /422/);
  assert.match(d.components.parameters.IdempotencyKey.description, /24 giờ/);
  assert.deepEqual(idempotencyErrors(d), []);
  // bỏ header khỏi một POST → báo lỗi
  const broken = clone(d);
  broken.paths["/api/app/comments"].post.parameters = [];
  assert.ok(idempotencyErrors(broken).some((e) => e.includes("/api/app/comments")));
});

// ---- nội dung hợp đồng -------------------------------------------------------------------------------------------------

test("lỗi RFC 9457, phân trang, bảo mật và mã trạng thái thật", () => {
  const d = doc();
  const problem = d.components.responses.Problem422.content["application/problem+json"].schema.$ref;
  assert.equal(problem, "#/components/schemas/Problem");
  const req = d.components.schemas.Problem.required as string[];
  for (const f of ["type", "title", "status", "detail", "code", "message", "request_id"])
    assert.ok(req.includes(f), f);
  assert.notEqual(d.components.schemas.Problem.properties.fields, undefined);
  const lim = d.components.parameters.Limit.schema;
  assert.deepEqual([lim.default, lim.maximum, lim.minimum], [50, 200, 1]);
  const off = d.components.parameters.Offset.schema;
  assert.deepEqual([off.default, off.maximum, off.minimum], [0, 10000, 0]);
  const tasks = d.paths["/api/app/tasks"].get;
  const names = tasks.parameters.map((p: Doc) => p.$ref);
  assert.deepEqual(names, ["#/components/parameters/Limit", "#/components/parameters/Offset"]);
  assert.deepEqual(tasks.security, [{ cookieAuth: [] }]);
  assert.deepEqual(d.paths["/api/app/leave-requests"].post.security, [{ cookieAuth: [], csrfToken: [] }]);
  assert.deepEqual(d.paths["/api/public/inquiries"].post.security, []);
  assert.deepEqual(Object.keys(d.paths["/api/app/attendance/events"].post.responses).slice(0, 2), [
    "200",
    "201",
  ]);
  assert.notEqual(d.paths["/api/app/tasks/{id}/{action}"].post.responses["409"], undefined);
  assert.notEqual(d.paths["/api/app/auth/login"].post.responses["429"], undefined);
  assert.notEqual(d.paths["/api/app/files"].post.responses["429"], undefined, "tải tệp có giới hạn tần suất");
  // schema request lấy từ zod thật
  const ev = d.components.schemas.AttendanceEventRequest;
  assert.deepEqual(ev.properties.kind.enum, ["in", "out", "break_start", "break_end"]);
  assert.equal(ev.required.includes("device_time"), true);
  assert.equal(ev.properties.worksite_id.anyOf[0].format, "uuid");
});

// ---- linter cấu trúc ---------------------------------------------------------------------------------------------------

test("lintOpenApi bắt: thiếu mô tả response, $ref hỏng, operationId trùng, path param thiếu/thừa, phiên bản sai", () => {
  const ok = doc();
  assert.deepEqual(lintOpenApi(ok), []);

  const noDesc = clone(ok);
  delete noDesc.paths["/api/app/me"].get.responses["200"].description;
  assert.ok(lintOpenApi(noDesc).some((e) => e.includes("GET /api/app/me 200") && e.includes("description")));

  const badRef = clone(ok);
  badRef.paths["/api/app/me"].get.responses["200"].content["application/json"].schema.$ref =
    "#/components/schemas/Nope";
  assert.ok(lintOpenApi(badRef).some((e) => e.includes("không resolve được")));

  const dup = clone(ok);
  dup.paths["/api/app/me"].get.operationId = dup.paths["/api/app/tasks"].get.operationId;
  assert.ok(lintOpenApi(dup).some((e) => e.includes("operationId trùng")));

  const noParam = clone(ok);
  noParam.paths["/api/app/files/{id}"].get.parameters = [];
  assert.ok(lintOpenApi(noParam).some((e) => e.includes("{id} chưa khai báo")));

  const extra = clone(ok);
  extra.paths["/api/app/me"].get.parameters = [
    { name: "x", in: "path", required: true, schema: { type: "string" } },
  ];
  assert.ok(lintOpenApi(extra).some((e) => e.includes('"x" khai thừa')));

  const notRequired = clone(ok);
  notRequired.paths["/api/app/files/{id}"].get.parameters[0].required = false;
  assert.ok(lintOpenApi(notRequired).some((e) => e.includes("required: true")));

  const ver = clone(ok);
  ver.openapi = "3.0.3";
  assert.ok(lintOpenApi(ver).some((e) => e.includes("3.1")));

  const noPaths = { openapi: "3.1.0", info: { title: "t", version: "1" }, paths: {} };
  assert.ok(lintOpenApi(noPaths).some((e) => e.includes("paths")));

  const sec = clone(ok);
  sec.paths["/api/app/me"].get.security = [{ khongCo: [] }];
  assert.ok(lintOpenApi(sec).some((e) => e.includes("securitySchemes")));

  const no2xx = clone(ok);
  no2xx.paths["/api/app/me"].get.responses = { "500": { description: "x" } };
  assert.ok(lintOpenApi(no2xx).some((e) => e.includes("2xx")));
});

// ---- kiểm phá vỡ hợp đồng (QA-INT-007) ---------------------------------------------------------------------------------

const base = (): Doc => ({
  openapi: "3.1.0",
  info: { title: "t", version: "1" },
  paths: {
    "/a": {
      get: {
        parameters: [
          { name: "q", in: "query", required: false, schema: { type: "string", enum: ["x", "y"] } },
        ],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id"],
                  properties: {
                    id: { type: "string" },
                    n: { type: "integer" },
                    tags: { type: "array", items: { $ref: "#/components/schemas/T" } },
                  },
                },
              },
            },
          },
          "404": { description: "không thấy" },
        },
      },
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["a"],
                properties: { a: { type: "string" }, kind: { type: "string", enum: ["in", "out"] } },
              },
            },
          },
        },
        responses: { "201": { description: "tạo" } },
      },
    },
    "/b": { get: { responses: { "200": { description: "ok" } } } },
  },
  components: { schemas: { T: { type: "object", properties: { v: { type: "string" } } } } },
});

const breakingOf = (mut: (d: Doc) => void): string[] => {
  const n = base();
  mut(n);
  return compareOpenApi(base(), n).breaking as string[];
};

test("check-api-breaking xanh: không đổi, hoặc chỉ thêm", () => {
  assert.deepEqual(
    breakingOf(() => {}),
    [],
  );
  assert.deepEqual(
    breakingOf((d) => {
      d.paths["/new"] = { get: { responses: { "200": { description: "ok" } } } };
      d.paths["/b"].post = { responses: { "200": { description: "ok" } } }; // thêm method
      d.paths["/a"].get.responses["409"] = { description: "thêm response" };
      const props = d.paths["/a"].get.responses["200"].content["application/json"].schema.properties;
      props.extra = { type: "string" }; // thêm thuộc tính response
      const req = d.paths["/a"].post.requestBody.content["application/json"].schema;
      req.properties.optional = { type: "string" }; // thêm field TUỲ CHỌN
      req.properties.kind.enum.push("break"); // nới enum request
      d.paths["/a"].get.parameters.push({
        name: "opt",
        in: "query",
        required: false,
        schema: { type: "string" },
      });
      d.components.schemas.T.properties.w = { type: "string" };
    }),
    [],
  );
});

test("check-api-breaking đỏ: xoá path/method, bỏ response, đổi kiểu/xoá thuộc tính response", () => {
  assert.ok(
    breakingOf((d) => delete d.paths["/b"]).some((e) => e.includes("GET /b") && e.includes("xoá path")),
  );
  assert.ok(
    breakingOf((d) => delete d.paths["/a"].post).some(
      (e) => e.includes("POST /a") && e.includes("xoá method"),
    ),
  );
  assert.ok(
    breakingOf((d) => delete d.paths["/a"].get.responses["404"]).some((e) => e.includes("bỏ response 404")),
  );
  const props = (d: Doc) => d.paths["/a"].get.responses["200"].content["application/json"].schema.properties;
  assert.ok(breakingOf((d) => delete props(d).n).some((e) => e.includes(".n") && e.includes("xoá")));
  assert.ok(
    breakingOf((d) => (props(d).n.type = "string")).some((e) => e.includes(".n") && e.includes("đổi kiểu")),
  );
  assert.ok(
    breakingOf((d) => (props(d).id.type = ["string", "null"])).some(
      (e) => e.includes(".id") && e.includes("đổi kiểu"),
    ),
  );
  assert.ok(
    breakingOf((d) => (d.components.schemas.T.properties.v.type = "integer")).some((e) => e.includes("[].v")),
    "đổi kiểu sâu qua $ref + mảng",
  );
  assert.ok(
    breakingOf(
      (d) => (d.paths["/a"].get.responses["200"].content["application/json"].schema.required = []),
    ).some((e) => e.includes("không còn bắt buộc")),
  );
});

test("check-api-breaking đỏ: request thêm required, thu hẹp enum, body/tham số bắt buộc mới", () => {
  const req = (d: Doc) => d.paths["/a"].post.requestBody.content["application/json"].schema;
  assert.ok(
    breakingOf((d) => {
      req(d).properties.b = { type: "string" };
      req(d).required.push("b");
    }).some((e) => e.includes(".b") && e.includes("BẮT BUỘC")),
  );
  assert.ok(
    breakingOf((d) => req(d).required.push("kind")).some(
      (e) => e.includes(".kind") && e.includes("BẮT BUỘC"),
    ),
  );
  assert.ok(
    breakingOf((d) => (req(d).properties.kind.enum = ["in"])).some(
      (e) => e.includes("thu hẹp enum") && e.includes('"out"'),
    ),
  );
  assert.ok(breakingOf((d) => (req(d).properties.a.type = "integer")).some((e) => e.includes("đổi kiểu")));
  assert.ok(
    breakingOf((d) => (d.paths["/a"].post.requestBody.required = true)).some((e) =>
      e.includes("trở thành bắt buộc"),
    ),
  );
  assert.ok(
    breakingOf((d) =>
      d.paths["/a"].get.parameters.push({
        name: "must",
        in: "query",
        required: true,
        schema: { type: "string" },
      }),
    ).some((e) => e.includes("tham số BẮT BUỘC")),
  );
  assert.ok(
    breakingOf((d) => (d.paths["/a"].get.parameters[0].schema.enum = ["x"])).some((e) =>
      e.includes("thu hẹp enum"),
    ),
  );
});

test("check-api-breaking miễn tường minh: x-breaking-approved ở operation; xoá operation khai ở gốc", () => {
  const n = base();
  n.paths["/a"].post.requestBody.content["application/json"].schema.required.push("kind");
  n.paths["/a"].post["x-breaking-approved"] = "đổi có chủ ý, client đã nâng cấp";
  const r = compareOpenApi(base(), n);
  assert.deepEqual(r.breaking, []);
  assert.equal(
    r.approved.some((a: string) => a.includes("miễn: đổi có chủ ý")),
    true,
  );

  const empty = base();
  empty.paths["/a"].post.requestBody.content["application/json"].schema.required.push("kind");
  empty.paths["/a"].post["x-breaking-approved"] = "  ";
  assert.equal(compareOpenApi(base(), empty).breaking.length, 1, "lý do rỗng không được miễn");

  const removed = base();
  delete removed.paths["/b"];
  assert.equal(compareOpenApi(base(), removed).breaking.length, 1);
  removed["x-breaking-approved-removals"] = { "GET /b": "gỡ endpoint thử nghiệm" };
  const rr = compareOpenApi(base(), removed);
  assert.deepEqual(rr.breaking, []);
  assert.equal(rr.approved.length, 1);
});

test("check-api-breaking.main: thiếu bản gốc/không có git → bỏ qua exit 0; có bản gốc → so", () => {
  const dir = tmpRoot({ "docs/api/openapi.json": JSON.stringify(base()) });
  const cwd = process.cwd();
  const logs: string[] = [];
  const errs: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (m: unknown) => void logs.push(String(m));
  console.error = (m: unknown) => void errs.push(String(m));
  try {
    process.chdir(dir);
    const none = () => {
      throw Object.assign(new Error("x"), { stderr: "fatal: invalid object name 'origin/main'.\n" });
    };
    assert.equal(breakingMain([], none), 0);
    assert.match(logs.join("\n"), /bỏ qua/);

    const noGit = () => {
      throw new Error("spawn git ENOENT");
    };
    assert.equal(breakingMain([], noGit), 0);

    const same = () => JSON.stringify(base());
    assert.equal(breakingMain([], same), 0);
    assert.match(logs.join("\n"), /không có thay đổi phá vỡ/);

    const old = base();
    old.paths["/gone"] = { get: { responses: { "200": { description: "ok" } } } };
    assert.equal(
      breakingMain([], () => JSON.stringify(old)),
      1,
    );
    assert.match(errs.join("\n"), /GET \/gone: xoá path/);
    assert.match(errs.join("\n"), /x-breaking-approved/);

    assert.equal(
      breakingMain([], () => "không phải json"),
      0,
      "bản gốc hỏng → bỏ qua",
    );
  } finally {
    process.chdir(cwd);
    console.log = log;
    console.error = error;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hợp đồng thật so với chính nó: không phá vỡ; xoá một route thật thì đỏ", () => {
  const real = doc();
  assert.deepEqual(compareOpenApi(real, clone(real)).breaking, []);
  const cut = clone(real);
  delete cut.paths["/api/app/tasks"];
  assert.ok((compareOpenApi(real, cut).breaking as string[]).some((e) => e.includes("GET /api/app/tasks")));
  const noProp = clone(real);
  delete noProp.components.schemas.TaskItem.properties.title;
  assert.ok((compareOpenApi(real, noProp).breaking as string[]).some((e) => e.includes("title")));
});

test("PR policy chạy check-api-breaking, action ghim SHA, quyền tối thiểu, đủ lịch sử để có origin/main", () => {
  const y = readFileSync(path.join(ROOT, ".github/workflows/pr-policy.yml"), "utf8");
  assert.match(y, /run: node scripts\/check-api-breaking\.mjs/);
  assert.match(y, /fetch-depth: 0/);
  assert.match(y, /permissions:\n {2}contents: read/);
  for (const m of y.matchAll(/uses: ([^\s@]+)@(\S+)/g))
    assert.match(m[2]!, /^[0-9a-f]{40}$/, `${m[1]} phải ghim SHA`);
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(pkg.scripts["check:arch"]!, /check:openapi/);
  assert.equal(pkg.scripts["gen:openapi"], "tsx scripts/gen-openapi.ts");
  assert.equal(pkg.scripts["check:api-breaking"], "node scripts/check-api-breaking.mjs");
  assert.ok(Object.keys(REGISTRY).length === 29);
});
