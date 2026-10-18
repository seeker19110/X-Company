// XC-PERF-006: mọi API danh sách có limit mặc định (50) + tối đa (200) + offset có trần; limit ngoài khoảng → 400.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { getApprovals } from "../../lib/attendance/request-routes.ts";
import { getComments } from "../../lib/files/routes.ts";
import { loginHandler } from "../../lib/identity/routes.ts";
import { listApplications, listInquiries, postInquiry } from "../../lib/inquiry/routes.ts";
import {
  fetchLimit,
  PAGE_DEFAULT_LIMIT,
  PAGE_MAX_LIMIT,
  PAGE_MAX_OFFSET,
  parsePage,
  toPage,
} from "../../lib/nen/pagination.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { getRequests } from "../../lib/privacy/routes.ts";
import { getTasks } from "../../lib/work/routes.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, PASSWORD, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

const q = (s: string) => parsePage(new URLSearchParams(s));
const isValidation = (e: unknown) => e instanceof AppError && e.code === "VALIDATION" && e.status === 400;

describe("parsePage / toPage (thuần)", () => {
  test("mặc định 50/0; trần 200 và offset 10.000 được chấp nhận", () => {
    assert.deepEqual(q(""), { limit: PAGE_DEFAULT_LIMIT, offset: 0 });
    assert.equal(PAGE_DEFAULT_LIMIT, 50);
    assert.deepEqual(q(`limit=${PAGE_MAX_LIMIT}&offset=${PAGE_MAX_OFFSET}`), {
      limit: 200,
      offset: 10_000,
    });
    assert.deepEqual(q("limit=1&offset=0"), { limit: 1, offset: 0 });
  });

  test("limit 0, âm, vượt trần, không phải số nguyên thập phân, rỗng → 400 (không kẹp ngầm)", () => {
    for (const bad of [
      "0",
      "-1",
      "201",
      "1000000",
      "abc",
      "1.5",
      "1e3",
      "0x10",
      "",
      " 5",
      "٣",
      "9999999999",
    ]) {
      assert.throws(
        () => q(`limit=${encodeURIComponent(bad)}`),
        isValidation,
        `limit=${JSON.stringify(bad)}`,
      );
    }
  });

  test("offset âm, quá trần, không phải số → 400", () => {
    for (const bad of ["-1", "10001", "x", "1.0", ""]) {
      assert.throws(
        () => q(`offset=${encodeURIComponent(bad)}`),
        isValidation,
        `offset=${JSON.stringify(bad)}`,
      );
    }
  });

  test("toPage: lấy limit+1 dòng để biết còn trang sau; ca biên rỗng/đúng đầy/dư", () => {
    const page = { limit: 2, offset: 4 };
    assert.equal(fetchLimit(page), 3);
    assert.deepEqual(toPage([], page), { items: [], limit: 2, offset: 4, next_offset: null });
    assert.deepEqual(toPage([1, 2], page), { items: [1, 2], limit: 2, offset: 4, next_offset: null });
    assert.deepEqual(toPage([1, 2, 3], page), { items: [1, 2], limit: 2, offset: 4, next_offset: 6 });
  });
});

describe("API danh sách (DB thật)", () => {
  let db: TestDb;
  let cookie: string;

  const list = (h: (r: Request) => Promise<Response>, path: string) => h(req("GET", path, { cookie }));

  before(async () => {
    process.env.TRUST_PROXY = "1";
    db = await freshDb();
    const { companyId } = await seedCompany();
    process.env.SITE_COMPANY_ID = companyId;
    const u = await seedUser(companyId, {
      grants: [
        { role: "sales", scopeType: "company" },
        { role: "hr", scopeType: "company" },
      ],
    });
    await db.admin.query(
      "INSERT INTO inquiry_route (company_id, service_slug, assignee_user_id) VALUES ($1, NULL, $2)",
      [companyId, u.userId],
    );
    cookie = cookieFrom(
      await loginHandler(
        req("POST", "/api/app/auth/login", { body: { email: u.email, password: PASSWORD } }),
      ),
    );
    for (let i = 0; i < 3; i++) {
      const res = await postInquiry(
        req("POST", "/api/public/inquiries", {
          headers: { "x-forwarded-for": `10.9.0.${i + 1}` },
          body: {
            submission_id: randomUUID(),
            name: `Khách ${i}`,
            email: `k${i}@example.test`,
            message: "Cần tư vấn",
            consent: true,
            website: "",
            elapsed_ms: 15000,
          },
        }),
      );
      assert.equal(res.status, 201);
    }
  });
  after(async () => {
    delete process.env.TRUST_PROXY;
    await db.close();
  });

  const routes: [string, (r: Request) => Promise<Response>, string][] = [
    ["GET /api/app/tasks", getTasks, "/api/app/tasks"],
    ["GET /api/app/approvals", getApprovals, "/api/app/approvals"],
    ["GET /api/app/inquiries", listInquiries, "/api/app/inquiries"],
    ["GET /api/app/applications", listApplications, "/api/app/applications"],
    ["GET /api/app/privacy/requests", getRequests, "/api/app/privacy/requests"],
    ["GET /api/app/comments", getComments, `/api/app/comments?object_type=task&object_id=${randomUUID()}`],
  ];
  const withQuery = (path: string, qs: string) => `${path}${path.includes("?") ? "&" : "?"}${qs}`;

  for (const [name, handler, path] of routes) {
    test(`${name}: limit=1000000, 0, -1, abc → 400; limit 201 → 400; offset quá trần → 400`, async () => {
      for (const qs of [
        "limit=1000000",
        "limit=0",
        "limit=-1",
        "limit=abc",
        "limit=201",
        "offset=10001",
        "offset=-1",
      ]) {
        const res = await list(handler, withQuery(path, qs));
        assert.equal(res.status, 400, `${qs} → ${res.status}`);
        assert.equal((await res.json()).code, "VALIDATION");
      }
    });
  }

  test("GET /api/app/inquiries: mặc định 50, trần 200 nhận được, phân trang theo offset đủ và không trùng", async () => {
    const def = await (await list(listInquiries, "/api/app/inquiries")).json();
    assert.equal(def.limit, 50);
    assert.equal(def.offset, 0);
    assert.equal(def.items.length, 3);
    assert.equal(def.next_offset, null);
    assert.equal((await list(listInquiries, "/api/app/inquiries?limit=200")).status, 200);

    const p1 = await (await list(listInquiries, "/api/app/inquiries?limit=2")).json();
    assert.equal(p1.items.length, 2);
    assert.equal(p1.next_offset, 2);
    const p2 = await (
      await list(listInquiries, `/api/app/inquiries?limit=2&offset=${p1.next_offset}`)
    ).json();
    assert.equal(p2.items.length, 1);
    assert.equal(p2.next_offset, null);
    const ids = [...p1.items, ...p2.items].map((r: { id: string }) => r.id);
    assert.equal(new Set(ids).size, 3);
    const past = await (await list(listInquiries, "/api/app/inquiries?offset=5000")).json();
    assert.deepEqual(past.items, []);
    assert.equal(past.next_offset, null);
  });

  test("mặc định không có tham số: các danh sách còn lại trả 200 với limit=50", async () => {
    for (const [, handler, path] of routes.filter(([n]) => !n.includes("comments"))) {
      const res = await list(handler, path);
      assert.equal(res.status, 200, path);
      const body = await res.json();
      assert.equal(body.limit, 50, path);
      assert.ok(Array.isArray(body.items), path);
    }
  });
});
