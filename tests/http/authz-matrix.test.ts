// Ma trận phân quyền tầng HTTP (QA-INT-006, STD-SEC-004, PRF-WEB-004, BE-CACHE-001, PRF-WEB-001).
// Phần 1 — TỰ ĐỘNG: liệt kê mọi app/api/app/**/route.ts và mọi method export; mỗi cặp: không phiên → 401,
//   method ghi không CSRF/sai Origin → 403, mọi phản hồi (kể cả lỗi) có Cache-Control no-store.
// Phần 2 — Test tag `api1-bola` (đổi id đối tượng/xem dữ liệu của người khác) và `api5-bfla` (vai không đủ gọi chức năng).
//   Tên test TĨNH và chứa "METHOD /api/app/<mẫu>" để `npm run check:authz` đối chiếu với tests/http/authz-coverage.ts.
// Mọi POST gửi kèm Idempotency-Key (không phụ thuộc việc server có bắt buộc hay không).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { check, discoverAppRoutes } from "../../scripts/check-authz-tests.ts";
import { AUTHZ_COVERAGE } from "./authz-coverage.ts";
import { loadActor } from "../../lib/authz/load.ts";
import { withTx } from "../../lib/db/index.ts";
import { loginHandler } from "../../lib/identity/routes.ts";
import { assignEmployment, createWorksite } from "../../lib/org/index.ts";
import { addMember, createProject, createTask } from "../../lib/work/tasks.ts";
import { diskStorage, setStorage } from "../../lib/files/storage.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { freshDb, type TestDb } from "../helpers/db.ts";
import {
  cookieFrom,
  PASSWORD,
  req,
  seedCompany,
  seedUser,
  setTestEnv,
  TEST_ORIGIN,
} from "../helpers/fixtures.ts";

setTestEnv();
process.env.QR_SIGNING_KEYS = "k1:old-key-0123456789abcdef0123456789abcdef";
const ROOT = path.resolve(import.meta.dirname, "../..");
type Handler = (r: Request) => Promise<Response>;

interface S {
  cookie: string;
  csrf: string;
}
async function login(email: string): Promise<S> {
  const r = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password: PASSWORD } }));
  assert.equal(r.status, 200);
  return { cookie: cookieFrom(r), csrf: (await r.json()).csrf_token };
}
const idem = () => ({ "idempotency-key": randomUUID() });
const call = (h: Handler, method: string, url: string, s: S | null, body?: unknown) =>
  h(
    req(method, url, {
      cookie: s?.cookie,
      csrf: s?.csrf,
      body,
      headers: method === "GET" ? {} : idem(),
    }),
  );
const get = (h: Handler, url: string, s: S) => call(h, "GET", url, s);
const post = (h: Handler, url: string, s: S, body: unknown = {}) => call(h, "POST", url, s, body);

describe("ma trận route app/api/app (tự động từ cây tệp)", () => {
  const routes = discoverAppRoutes(ROOT);
  let db: TestDb;
  let s: S;

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    const u = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    s = await login(u.email);
  });
  after(async () => {
    await db.close();
  });

  test("liệt kê được route; phân loại authz-coverage khớp cây tệp và có test tag (check:authz)", () => {
    assert.ok(routes.length >= 15, `chỉ thấy ${routes.length} cặp route/method`);
    assert.ok(routes.some((r) => r.url === "/api/app/tasks/[id]/[action]" && r.method === "POST"));
    assert.deepEqual(check(ROOT), []);
    assert.deepEqual(routes.map((r) => `${r.method} ${r.url}`).sort(), Object.keys(AUTHZ_COVERAGE).sort());
  });

  for (const r of routes) {
    if (r.method === "POST" && r.url === "/api/app/auth/login") continue; // công khai theo thiết kế (auth.test.ts)
    const concrete = r.url.replace(/\[[^\]]+\]/g, () => randomUUID());
    const write = !["GET", "HEAD", "OPTIONS"].includes(r.method);

    test(`[${r.method} ${r.url}] không phiên → 401, Cache-Control no-store`, async () => {
      const mod = (await import(pathToFileURL(path.join(ROOT, r.file)).href)) as Record<string, Handler>;
      const handler = mod[r.method]!;
      assert.equal(typeof handler, "function");
      const res = await call(handler, r.method, concrete, null, write ? {} : undefined);
      assert.equal(res.status, 401);
      assert.match(res.headers.get("cache-control") ?? "", /no-store/);
      const junk = await handler(
        req(r.method, concrete, { cookie: "xc_session=rac-khong-hop-le", headers: write ? idem() : {} }),
      );
      assert.equal(junk.status, 401, "cookie rác cũng 401");
    });

    if (write) {
      test(`[${r.method} ${r.url}] có phiên nhưng thiếu CSRF / sai Origin → 403`, async () => {
        const mod = (await import(pathToFileURL(path.join(ROOT, r.file)).href)) as Record<string, Handler>;
        const handler = mod[r.method]!;
        const noCsrf = await handler(
          req(r.method, concrete, { cookie: s.cookie, body: {}, headers: idem() }),
        );
        assert.equal(noCsrf.status, 403);
        assert.equal((await noCsrf.json()).error.code, "CSRF");
        const wrongCsrf = await handler(
          req(r.method, concrete, { cookie: s.cookie, csrf: "sai-" + s.csrf, body: {}, headers: idem() }),
        );
        assert.equal(wrongCsrf.status, 403);
        const evil = await handler(
          req(r.method, concrete, {
            cookie: s.cookie,
            csrf: s.csrf,
            body: {},
            origin: "https://evil.example",
            headers: idem(),
          }),
        );
        assert.equal(evil.status, 403);
        assert.match(noCsrf.headers.get("cache-control") ?? "", /no-store/);
      });
    }
  }
});

describe("BOLA / BFLA tầng HTTP", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;
  let org2: Awaited<ReturnType<typeof seedCompany>>;
  let emp: S, emp2: S, lead: S, otherLead: S, rev: S, sales: S, hr: S, sales2: S, hr2: S;
  let empId: string, emp2Id: string;
  let taskId: string, projectId: string, worksiteId: string, leaveTypeId: string;

  const H = {} as Record<string, Handler>;
  const load = async (rel: string, method: string) => {
    const mod = (await import(pathToFileURL(path.join(ROOT, rel)).href)) as Record<string, Handler>;
    return mod[method]!;
  };

  before(async () => {
    setStorage(diskStorage(mkdtempSync(path.join(tmpdir(), "xc-authz-"))));
    db = await freshDb();
    org = await seedCompany();
    org2 = await seedCompany("Công ty khác");
    const mk = (companyId: string, role: Parameters<typeof seedUser>[1] = {}) => seedUser(companyId, role);
    const exec = await mk(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] });
    const pm = await mk(org.companyId);
    const e1 = await mk(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const e2 = await mk(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const r = await mk(org.companyId);
    const l = await mk(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.deptId }],
    });
    const ol = await mk(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.otherDeptId }],
    });
    const sl = await mk(org.companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const h = await mk(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const sl2 = await mk(org2.companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const h2 = await mk(org2.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    empId = e1.employeeId!;
    emp2Id = e2.employeeId!;
    await withTx(async (tx) => {
      await assignEmployment(tx, { userId: null }, org.companyId, e1.employeeId!, {
        departmentId: org.deptId,
        validFrom: "2026-01-01",
      });
      await assignEmployment(tx, { userId: null }, org.companyId, e2.employeeId!, {
        departmentId: org.otherDeptId,
        validFrom: "2026-01-01",
      });
    });
    const execA = (await loadActor(db.app, exec.userId))!;
    const pmA = (await loadActor(db.app, pm.userId))!;
    projectId = await withTx((tx) =>
      createProject(tx, execA, { code: "BO", name: "Dự án BOLA", managerEmployeeId: pm.employeeId! }),
    );
    await withTx(async (tx) => {
      await addMember(tx, pmA, projectId, e1.employeeId!);
      await addMember(tx, pmA, projectId, r.employeeId!);
    });
    taskId = await withTx((tx) =>
      createTask(tx, pmA, {
        projectId,
        title: "Việc riêng của nhân viên 1",
        responsibleEmployeeId: e1.employeeId!,
        reviewerEmployeeId: r.employeeId!,
        acceptanceCriteria: "ok",
      }),
    );
    worksiteId = await withTx((tx) =>
      createWorksite(tx, { userId: null }, org.companyId, {
        code: "AZ1",
        name: "Công trường authz",
        branchId: org.branchId,
      }),
    );
    leaveTypeId = (
      await db.admin.query(
        "INSERT INTO leave_type (company_id, code, name, requires_balance) VALUES ($1, 'KL', 'Không lương', false) RETURNING id",
        [org.companyId],
      )
    ).rows[0].id;
    await db.admin.query(
      `INSERT INTO inquiry (company_id, code, submission_id, name, email, message, consent_at, consent_notice_version, status, due_at)
       VALUES ($1, 'LH-AZ-1', $2, 'Khách của công ty A', 'khach@example.test', 'cần tư vấn', now(), 'v1', 'new', now() + interval '1 day')`,
      [org.companyId, randomUUID()],
    );
    await db.admin.query(
      `INSERT INTO job_application (company_id, code, submission_id, name, email, consent_at, consent_notice_version)
       VALUES ($1, 'UV-AZ-1', $2, 'Ứng viên của công ty A', 'uv@example.test', now(), 'v1')`,
      [org.companyId, randomUUID()],
    );
    [emp, emp2, lead, otherLead, rev, sales, hr, sales2, hr2] = [
      await login(e1.email),
      await login(e2.email),
      await login(l.email),
      await login(ol.email),
      await login(r.email),
      await login(sl.email),
      await login(h.email),
      await login(sl2.email),
      await login(h2.email),
    ];
    H.me = await load("app/api/app/me/route.ts", "GET");
    H.tasks = await load("app/api/app/tasks/route.ts", "GET");
    H.taskAction = await load("app/api/app/tasks/[id]/[action]/route.ts", "POST");
    H.filePost = await load("app/api/app/files/route.ts", "POST");
    H.fileGet = await load("app/api/app/files/[id]/route.ts", "GET");
    H.commentGet = await load("app/api/app/comments/route.ts", "GET");
    H.commentPost = await load("app/api/app/comments/route.ts", "POST");
    H.approvals = await load("app/api/app/approvals/route.ts", "GET");
    H.decision = await load("app/api/app/approvals/[type]/[id]/[decision]/route.ts", "POST");
    H.leave = await load("app/api/app/leave-requests/route.ts", "POST");
    H.ot = await load("app/api/app/ot-requests/route.ts", "POST");
    H.adjust = await load("app/api/app/adjustments/route.ts", "POST");
    H.events = await load("app/api/app/attendance/events/route.ts", "POST");
    H.qr = await load("app/api/app/attendance/qr/[worksiteId]/route.ts", "GET");
    H.sync = await load("app/api/app/sync/route.ts", "POST");
    H.logout = await load("app/api/app/auth/logout/route.ts", "POST");
    H.inquiries = await load("app/api/app/inquiries/route.ts", "GET");
    H.applications = await load("app/api/app/applications/route.ts", "GET");
  });
  after(async () => {
    setStorage(undefined);
    await db.close();
  });

  const uploadAs = (s: S, objectType: string, objectId: string) => {
    const fd = new FormData();
    fd.set("object_type", objectType);
    fd.set("object_id", objectId);
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n");
    fd.set("file", new File([new Uint8Array(pdf)], "tai-lieu.pdf", { type: "application/pdf" }));
    return H.filePost!(
      new Request(`${TEST_ORIGIN}/api/app/files`, {
        method: "POST",
        headers: { origin: TEST_ORIGIN, cookie: s.cookie, "x-csrf-token": s.csrf, ...idem() },
        body: fd,
      }),
    );
  };

  test("api1-bola GET /api/app/me — hai người dùng chỉ thấy hồ sơ của chính mình; Cache-Control no-store", async () => {
    const a = await get(H.me!, "/api/app/me", emp);
    const b = await get(H.me!, "/api/app/me", emp2);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.match(a.headers.get("cache-control") ?? "", /no-store/);
    const [ja, jb] = [await a.json(), await b.json()];
    assert.equal(ja.employee_id, empId);
    assert.equal(jb.employee_id, emp2Id);
    assert.notEqual(ja.user_id, jb.user_id);
    assert.notEqual(ja.csrf_token, jb.csrf_token);
    // Cookie của A + tham số cố đổi danh tính không đổi kết quả.
    const sneaky = await get(H.me!, `/api/app/me?user_id=${jb.user_id}&employee_id=${emp2Id}`, emp);
    assert.equal((await sneaky.json()).user_id, ja.user_id);
  });

  test("api1-bola GET /api/app/tasks — hai người dùng gọi cùng URL không thấy việc của nhau; no-store", async () => {
    const a = await get(H.tasks!, "/api/app/tasks", emp);
    const b = await get(H.tasks!, "/api/app/tasks", emp2);
    assert.match(a.headers.get("cache-control") ?? "", /no-store/);
    assert.match(b.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(
      (await a.json()).items.map((t: { id: string }) => t.id),
      [taskId],
    );
    assert.deepEqual((await b.json()).items, []);
    const sneaky = await get(H.tasks!, `/api/app/tasks?employee_id=${empId}`, emp2);
    assert.deepEqual((await sneaky.json()).items, []);
  });

  test("api1-bola POST /api/app/tasks/[id]/[action] — đổi id việc của người khác → 404, trạng thái không đổi", async () => {
    const before = (await db.admin.query("SELECT status, version FROM task WHERE id = $1", [taskId])).rows[0];
    for (const who of [emp2, otherLead]) {
      for (const action of ["start", "cancel", "submit", "accept"]) {
        const r = await post(H.taskAction!, `/api/app/tasks/${taskId}/${action}`, who, {
          version: before.version,
          reason: "x",
        });
        assert.ok([403, 404].includes(r.status), `${action}: ${r.status}`);
      }
    }
    const after = (await db.admin.query("SELECT status, version FROM task WHERE id = $1", [taskId])).rows[0];
    assert.deepEqual(after, before);
    assert.equal(
      (await post(H.taskAction!, `/api/app/tasks/${randomUUID()}/start`, emp, { version: 1 })).status,
      404,
    );
  });

  test("api5-bfla POST /api/app/tasks/[id]/[action] — người thực hiện không tự nghiệm thu việc của mình", async () => {
    const v = (await db.admin.query("SELECT version FROM task WHERE id = $1", [taskId])).rows[0].version;
    const r = await post(H.taskAction!, `/api/app/tasks/${taskId}/accept`, emp, { version: v });
    assert.ok([403, 404, 409].includes(r.status), String(r.status));
    assert.notEqual(r.status, 200);
    const st = (await db.admin.query("SELECT status FROM task WHERE id = $1", [taskId])).rows[0].status;
    assert.notEqual(st, "accepted");
  });

  test("api1-bola GET /api/app/files/[id] POST /api/app/files — tải/đính kèm tệp của đối tượng người khác → 404", async () => {
    assert.equal((await uploadAs(emp2, "task", taskId)).status, 404);
    assert.equal((await uploadAs(otherLead, "project", projectId)).status, 404);
    const up = await uploadAs(emp, "task", taskId);
    assert.equal(up.status, 201);
    const fileId = (await up.json()).file_id as string;
    assert.equal((await get(H.fileGet!, `/api/app/files/${fileId}`, emp)).status, 200);
    assert.equal((await get(H.fileGet!, `/api/app/files/${fileId}`, emp2)).status, 404);
    assert.equal((await get(H.fileGet!, `/api/app/files/${fileId}`, otherLead)).status, 404);
    // Người dùng công ty khác cũng không thấy (cách ly theo company_id).
    assert.equal((await get(H.fileGet!, `/api/app/files/${fileId}`, sales2)).status, 404);
  });

  test("api1-bola GET /api/app/comments POST /api/app/comments — bình luận theo đối tượng của người khác → 404", async () => {
    const own = await post(H.commentPost!, "/api/app/comments", emp, {
      object_type: "task",
      object_id: taskId,
      body: "ghi chú",
    });
    assert.equal(own.status, 201);
    const url = `/api/app/comments?object_type=task&object_id=${taskId}`;
    assert.equal((await get(H.commentGet!, url, emp)).status, 200);
    assert.equal((await get(H.commentGet!, url, emp2)).status, 404);
    assert.equal((await get(H.commentGet!, url, sales2)).status, 404);
    const cross = await post(H.commentPost!, "/api/app/comments", emp2, {
      object_type: "task",
      object_id: taskId,
      body: "chen ngang",
    });
    assert.equal(cross.status, 404);
    const n = await db.admin.query("SELECT count(*)::int AS n FROM comment WHERE body = 'chen ngang'");
    assert.equal(n.rows[0].n, 0);
  });

  test("api1-bola GET /api/app/approvals POST /api/app/approvals/[type]/[id]/[decision] — đơn của người khác phòng/công ty", async () => {
    const lr = await post(H.leave!, "/api/app/leave-requests", emp, {
      leave_type_id: leaveTypeId,
      start_at: "2026-11-02T08:00:00+07:00",
      end_at: "2026-11-02T12:00:00+07:00",
      minutes: 240,
    });
    assert.equal(lr.status, 201);
    const leaveId = (await lr.json()).id as string;
    const inbox = async (s: S) => (await (await get(H.approvals!, "/api/app/approvals", s)).json()).items;
    assert.equal((await inbox(lead)).length, 1);
    assert.deepEqual(await inbox(otherLead), [], "trưởng nhóm phòng khác không thấy đơn");
    assert.deepEqual(await inbox(emp2), []);
    assert.deepEqual(await inbox(emp), [], "không thấy đơn của chính mình để tự duyệt");
    const url = `/api/app/approvals/leave/${leaveId}/approve`;
    assert.ok([403, 404].includes((await post(H.decision!, url, otherLead)).status));
    assert.ok([403, 404].includes((await post(H.decision!, url, hr2)).status), "HR công ty khác");
    assert.equal(
      (await post(H.decision!, `/api/app/approvals/leave/${randomUUID()}/approve`, lead)).status,
      404,
    );
    const st = await db.admin.query("SELECT status FROM leave_request WHERE id = $1", [leaveId]);
    assert.equal(st.rows[0].status, "pending", "đơn không bị đổi bởi người ngoài phạm vi");
  });

  test("api5-bfla POST /api/app/approvals/[type]/[id]/[decision] — nhân viên thường không duyệt/từ chối đơn (kể cả đơn của mình)", async () => {
    const lr = await post(H.leave!, "/api/app/leave-requests", emp, {
      leave_type_id: leaveTypeId,
      start_at: "2026-11-03T08:00:00+07:00",
      end_at: "2026-11-03T12:00:00+07:00",
      minutes: 240,
    });
    const leaveId = (await lr.json()).id as string;
    for (const who of [emp, emp2, rev]) {
      for (const d of ["approve", "reject"]) {
        const r = await post(H.decision!, `/api/app/approvals/leave/${leaveId}/${d}`, who);
        assert.equal(r.status, 403, `${d}`);
      }
    }
    const st = await db.admin.query("SELECT status FROM leave_request WHERE id = $1", [leaveId]);
    assert.equal(st.rows[0].status, "pending");
  });

  test("api1-bola POST /api/app/leave-requests POST /api/app/ot-requests POST /api/app/adjustments — danh tính lấy từ phiên, không từ body", async () => {
    const lr = await post(H.leave!, "/api/app/leave-requests", emp, {
      employee_id: emp2Id,
      leave_type_id: leaveTypeId,
      start_at: "2026-11-04T08:00:00+07:00",
      end_at: "2026-11-04T12:00:00+07:00",
      minutes: 240,
    });
    assert.equal(lr.status, 201);
    const leave = await db.admin.query("SELECT employee_id FROM leave_request WHERE id = $1", [
      (await lr.json()).id,
    ]);
    assert.equal(leave.rows[0].employee_id, empId);
    const ot = await post(H.ot!, "/api/app/ot-requests", emp, {
      employee_id: emp2Id,
      business_date: "2026-11-05",
      minutes: 60,
      reason: "gấp",
      consent: true,
    });
    assert.equal(ot.status, 201);
    const otRow = await db.admin.query("SELECT employee_id FROM ot_request WHERE id = $1", [
      (await ot.json()).id,
    ]);
    assert.equal(otRow.rows[0].employee_id, empId);
    const adj = await post(H.adjust!, "/api/app/adjustments", emp, {
      employee_id: emp2Id,
      action: "add_event",
      new_kind: "out",
      new_at: new Date(Date.now() - 86_400_000).toISOString(), // quá khứ gần: đề nghị sửa công không được ở tương lai
      reason: "quên bấm",
    });
    assert.equal(adj.status, 201);
    const adjRow = await db.admin.query("SELECT employee_id FROM attendance_adjustment WHERE id = $1", [
      (await adj.json()).id,
    ]);
    assert.equal(adjRow.rows[0].employee_id, empId);
    // Huỷ sự kiện chấm công của người khác bằng id → không được chấp nhận.
    const ev = await post(H.events!, "/api/app/attendance/events", emp2, {
      kind: "in",
      device_time: new Date().toISOString(),
      source: "gps",
      device: "p2",
    });
    assert.equal(ev.status, 201);
    const victimEvent = (await ev.json()).event_id as string;
    const steal = await post(H.adjust!, "/api/app/adjustments", emp, {
      action: "void_event",
      target_event_id: victimEvent,
      reason: "xoá công người khác",
    });
    assert.ok([403, 404, 409, 422].includes(steal.status), `void sự kiện của người khác: ${steal.status}`);
    const voided = await db.admin.query(
      "SELECT voided_by_adjustment_id FROM attendance_event WHERE id = $1",
      [victimEvent],
    );
    assert.equal(voided.rows[0].voided_by_adjustment_id, null);
  });

  test("api1-bola POST /api/app/attendance/events POST /api/app/sync — sự kiện luôn gắn nhân viên của phiên, bỏ qua employee_id trong body", async () => {
    const r = await call(H.events!, "POST", "/api/app/attendance/events", emp, {
      employee_id: emp2Id,
      kind: "in",
      device_time: new Date().toISOString(),
      source: "gps",
      device: "p1",
    });
    assert.equal(r.status, 201);
    const row = await db.admin.query("SELECT employee_id FROM attendance_event WHERE id = $1", [
      (await r.json()).event_id,
    ]);
    assert.equal(row.rows[0].employee_id, empId);
    const itemId = randomUUID();
    const sync = await post(H.sync!, "/api/app/sync", emp, {
      items: [
        {
          id: itemId,
          kind: "attendance",
          created_at: new Date().toISOString(),
          payload: {
            employee_id: emp2Id,
            kind: "out",
            device_time: new Date().toISOString(),
            source: "gps",
            device: "p1",
          },
        },
      ],
    });
    assert.equal(sync.status, 200);
    const synced = await db.admin.query(
      "SELECT employee_id FROM attendance_event WHERE idempotency_key = $1",
      [itemId],
    );
    assert.equal(synced.rows.length, 1);
    assert.equal(synced.rows[0].employee_id, empId);
  });

  test("api1-bola POST /api/app/auth/logout — đăng xuất phiên của A không làm mất phiên của B", async () => {
    const a = await login(
      (await db.admin.query("SELECT email FROM app_user WHERE employee_id = $1", [empId])).rows[0].email,
    );
    const b = emp2;
    const out = await post(H.logout!, "/api/app/auth/logout", a);
    assert.equal(out.status, 200);
    assert.equal((await get(H.me!, "/api/app/me", a)).status, 401, "phiên A đã huỷ");
    assert.equal((await get(H.me!, "/api/app/me", b)).status, 200, "phiên B còn nguyên");
    assert.equal(
      (await get(H.me!, "/api/app/me", emp)).status,
      200,
      "phiên khác của A (đăng nhập trước đó) còn nguyên",
    );
  });

  test("api1-bola GET /api/app/inquiries GET /api/app/applications — công ty khác không thấy dữ liệu liên hệ/ứng viên của công ty A", async () => {
    const own = await (await get(H.inquiries!, "/api/app/inquiries", sales)).json();
    assert.deepEqual(
      own.items.map((i: { code: string }) => i.code),
      ["LH-AZ-1"],
    );
    const foreign = await get(H.inquiries!, "/api/app/inquiries", sales2);
    assert.equal(foreign.status, 200);
    assert.deepEqual((await foreign.json()).items, []);
    assert.match(foreign.headers.get("cache-control") ?? "", /no-store/);
    const ownApps = await (await get(H.applications!, "/api/app/applications", hr)).json();
    assert.deepEqual(
      ownApps.items.map((i: { code: string }) => i.code),
      ["UV-AZ-1"],
    );
    assert.deepEqual((await (await get(H.applications!, "/api/app/applications", hr2)).json()).items, []);
  });

  test("api5-bfla GET /api/app/inquiries GET /api/app/applications — nhân viên/trưởng nhóm không đọc danh sách liên hệ/ứng viên → 403", async () => {
    for (const who of [emp, emp2, lead, rev]) {
      assert.equal((await get(H.inquiries!, "/api/app/inquiries", who)).status, 403);
      assert.equal((await get(H.applications!, "/api/app/applications", who)).status, 403);
    }
    // Vai khác chức năng: HR không đọc liên hệ kinh doanh, sales không đọc hồ sơ ứng viên.
    assert.equal((await get(H.inquiries!, "/api/app/inquiries", hr)).status, 403);
    assert.equal((await get(H.applications!, "/api/app/applications", sales)).status, 403);
  });

  test("api5-bfla GET /api/app/attendance/qr/[worksiteId] — nhân viên không hiển thị mã QR chấm công → 403; HR → 200", async () => {
    const url = `/api/app/attendance/qr/${worksiteId}`;
    assert.equal((await get(H.qr!, url, emp)).status, 403);
    assert.equal((await get(H.qr!, url, emp2)).status, 403);
    assert.equal((await get(H.qr!, url, sales)).status, 403);
    const ok = await get(H.qr!, url, hr);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await get(H.qr!, `/api/app/attendance/qr/${randomUUID()}`, hr)).status, 404);
  });
});
