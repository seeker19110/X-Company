// Quyền chủ thể dữ liệu (T-040): consent chỉ thêm, rút đồng ý dừng xử lý, truy cập, xoá lan tới mọi kho, giữ dữ liệu theo luật,
// hạn xử lý + quá hạn. CMP-RIGHTS-001/004/007, CMP-VN-001/007, CMP-PRIV-005, CMP-INTL-007, STD-PRIV-004.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { verifyAuditChain } from "../../lib/audit/index.ts";
import { withTx } from "../../lib/db/index.ts";
import { diskStorage, setStorage } from "../../lib/files/storage.ts";
import {
  ApplicationInput,
  InquiryInput,
  submitApplication,
  submitInquiry,
  updateInquiry,
} from "../../lib/inquiry/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { dsarAnyOverdueSql, dsarConfig } from "../../lib/privacy/deadlines.ts";
import {
  completeRequest,
  createRequest,
  CreateRequestInput,
  exportSubject,
  extendRequest,
  listOverdue,
  listRequests,
  registerSubjectFile,
  rejectRequest,
  respondRequest,
  startRequest,
  type PrivacyActor,
  type RequestKind,
  type SubjectType,
} from "../../lib/privacy/index.ts";
import { listConsents } from "../../lib/privacy/consent.ts";
import { defaultRegistry, runOnce, type Channel, type DeliveryMessage } from "../../lib/worker/index.ts";
import { ANON_EMAIL, ANON_NAME } from "../../lib/worker/retention.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
const T0 = new Date(Date.now() + 3_600_000); // mốc worker: sau now() thật để việc mới tạo đã đến hạn

class FakeChannel implements Channel {
  readonly name = "fake";
  sent: DeliveryMessage[] = [];
  enabled = () => true;
  deliver(msg: DeliveryMessage): Promise<void> {
    this.sent.push(msg);
    return Promise.resolve();
  }
  forInquiry(id: string) {
    return this.sent.filter((m) => (m.payload as { inquiryId?: string }).inquiryId === id);
  }
}

describe("quyền chủ thể dữ liệu (DSAR)", () => {
  let db: TestDb;
  let companyId: string;
  let hr: PrivacyActor;
  let salesId: string;
  let blobDir: string;
  let ip = 0;

  before(async () => {
    process.env.TRUST_PROXY = "1";
    db = await freshDb();
    ({ companyId } = await seedCompany());
    salesId = (await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] })).userId;
    const hrUser = await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    hr = { userId: hrUser.userId, companyId };
    await db.admin.query(
      "INSERT INTO inquiry_route (company_id, service_slug, assignee_user_id) VALUES ($1, NULL, $2)",
      [companyId, salesId],
    );
    blobDir = mkdtempSync(path.join(tmpdir(), "xc-rights-"));
    setStorage(diskStorage(blobDir));
  });
  after(async () => {
    setStorage(undefined);
    delete process.env.TRUST_PROXY;
    await db.close();
  });

  const inquiryInput = (over: Record<string, unknown> = {}) =>
    InquiryInput.parse({
      submission_id: randomUUID(),
      name: "Nguyễn Thị Khách",
      email: `khach.${randomUUID().slice(0, 8)}@example.test`,
      phone: "0900000000",
      message: "Cần báo giá hệ thống điện",
      consent: true,
      elapsed_ms: 15_000,
      ...over,
    });
  const newInquiry = async (over: Record<string, unknown> = {}) => {
    const input = inquiryInput(over);
    const r = await submitInquiry(db.app, companyId, input, { ip: `10.1.0.${++ip}` });
    const { rows } = await db.admin.query<{ id: string }>("SELECT id FROM inquiry WHERE code = $1", [r.code]);
    return { id: rows[0]!.id, code: r.code, email: input.email!, input };
  };
  const newApplication = async () => {
    const input = ApplicationInput.parse({
      submission_id: randomUUID(),
      name: "Lê Văn Ứng Viên",
      email: `uv.${randomUUID().slice(0, 8)}@example.test`,
      phone: "0900000000",
      cover_letter: "Tôi muốn ứng tuyển vị trí kỹ sư",
      consent: true,
      elapsed_ms: 15_000,
    });
    const r = await submitApplication(db.app, companyId, input, { ip: `10.2.0.${++ip}` });
    const { rows } = await db.admin.query<{ id: string }>("SELECT id FROM job_application WHERE code = $1", [
      r.code,
    ]);
    return { id: rows[0]!.id, code: r.code, email: input.email };
  };
  const handle = async (ref: string, type: SubjectType, kind: RequestKind, now = new Date()) => {
    const req = await withTx((tx) =>
      createRequest(tx, hr, { subject_type: type, subject_ref: ref, kind }, now),
    );
    await withTx((tx) => startRequest(tx, hr, req.id));
    return req;
  };
  const complete = (id: string, now = new Date()) => withTx((tx) => completeRequest(tx, hr, id, now));
  const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;

  describe("đồng ý (CMP-RIGHTS-001, CMP-VN-001)", () => {
    test("kho nhân tài: đồng ý RIÊNG, mặc định không có; có tích thì ghi thêm một dòng mục đích talent_pool", async () => {
      const mk = async (extra: Record<string, unknown>) => {
        const input = ApplicationInput.parse({
          submission_id: randomUUID(),
          name: "Ứng Viên Kho",
          email: `kho.${randomUUID().slice(0, 8)}@example.test`,
          consent: true,
          elapsed_ms: 15_000,
          ...extra,
        });
        const r = await submitApplication(db.app, companyId, input, { ip: `10.3.0.${++ip}` });
        const id = (await q("SELECT id FROM job_application WHERE code = $1", [r.code]))[0].id;
        return (await q("SELECT purpose_id FROM consent_record WHERE subject_id = $1 ORDER BY id", [id])).map(
          (x) => x.purpose_id,
        );
      };
      assert.deepEqual(await mk({}), ["job_application"], "không tích sẵn");
      assert.deepEqual(await mk({ talent_pool: false }), ["job_application"]);
      assert.deepEqual(await mk({ talent_pool: true }), ["job_application", "talent_pool"]);
      assert.equal(
        ApplicationInput.safeParse({
          ...{ submission_id: randomUUID(), name: "A", email: "a@example.test", consent: true },
          talent_pool: "yes",
        }).success,
        false,
      );
    });

    test("gửi form ghi bản ghi đồng ý đủ trường cùng giao dịch (liên hệ và tuyển dụng)", async () => {
      const inq = await newInquiry();
      const app = await newApplication();
      const [c1] = await q("SELECT * FROM consent_record WHERE subject_id = $1", [inq.id]);
      assert.equal(c1.subject_type, "inquiry");
      assert.equal(c1.purpose_id, "inquiry_contact");
      assert.equal(c1.event, "grant");
      assert.equal(c1.channel, "web_form");
      assert.equal(c1.policy_version, "2026-10-18");
      assert.match(c1.ui_snapshot_hash, /^[0-9a-f]{64}$/);
      assert.equal(c1.withdrawn_at, null);
      assert.ok(c1.granted_at instanceof Date);
      const [c2] = await q("SELECT * FROM consent_record WHERE subject_id = $1", [app.id]);
      assert.equal(c2.purpose_id, "job_application");
      assert.notEqual(c1.ui_snapshot_hash, c2.ui_snapshot_hash, "ảnh chụp theo mục đích");
    });

    test("gửi lặp cùng submission_id không tạo thêm bản ghi đồng ý", async () => {
      const inq = await newInquiry();
      const again = await submitInquiry(db.app, companyId, inq.input, { ip: "10.9.9.9" });
      assert.equal(again.created, false);
      assert.equal((await q("SELECT 1 FROM consent_record WHERE subject_id = $1", [inq.id])).length, 1);
    });

    test("thiếu đồng ý → từ chối xử lý: không có hồ sơ, không có bản ghi đồng ý", async () => {
      const before = Number((await q("SELECT count(*) AS n FROM consent_record"))[0].n);
      const beforeInq = Number((await q("SELECT count(*) AS n FROM inquiry"))[0].n);
      for (const consent of [false, undefined, "true", 1, null]) {
        assert.throws(
          () =>
            InquiryInput.parse({
              submission_id: randomUUID(),
              name: "A",
              email: "a@example.test",
              message: "x",
              consent,
            }),
          /Cần đồng ý/,
        );
      }
      assert.throws(() =>
        ApplicationInput.parse({ submission_id: randomUUID(), name: "A", email: "a@example.test" }),
      );
      assert.equal(Number((await q("SELECT count(*) AS n FROM consent_record"))[0].n), before);
      assert.equal(Number((await q("SELECT count(*) AS n FROM inquiry"))[0].n), beforeInq);
    });

    test("bản ghi đồng ý CHỈ THÊM: UPDATE/DELETE/TRUNCATE bị từ chối (role ứng dụng và cả owner)", async () => {
      const inq = await newInquiry();
      for (const sql of [
        "UPDATE consent_record SET policy_version = 'x' WHERE subject_id = $1",
        "DELETE FROM consent_record WHERE subject_id = $1",
      ]) {
        await assert.rejects(db.app.query(sql, [inq.id]), /permission denied|chỉ thêm/);
        await assert.rejects(db.admin.query(sql, [inq.id]), /chỉ thêm/);
      }
      await assert.rejects(db.app.query("TRUNCATE consent_record"), /permission denied|chỉ thêm/);
      await assert.rejects(db.admin.query("TRUNCATE consent_record"), /chỉ thêm/);
      assert.equal((await q("SELECT 1 FROM consent_record WHERE subject_id = $1", [inq.id])).length, 1);
    });

    test("ràng buộc: grant không có withdrawn_at, withdraw phải có; mã mục đích hợp lệ", async () => {
      const bad = (event: string, withdrawn: string | null, purpose = "inquiry_contact") =>
        db.admin.query(
          `INSERT INTO consent_record (company_id, subject_type, subject_id, purpose_id, policy_version, event, granted_at, channel, ui_snapshot_hash, withdrawn_at)
           VALUES ($1, 'inquiry', $2, $3, 'v1', $4, now(), 'web_form', repeat('a', 64), $5)`,
          [companyId, randomUUID(), purpose, event, withdrawn],
        );
      await assert.rejects(bad("grant", new Date().toISOString()), /check/i);
      await assert.rejects(bad("withdraw", null), /check/i);
      await assert.rejects(bad("grant", null, "Có Dấu"), /check/i);
    });
  });

  describe("rút đồng ý (CMP-RIGHTS-004, CMP-VN-007)", () => {
    test("rút đồng ý ghi DÒNG MỚI, dừng xử lý ngay (≪ 72 giờ), worker bỏ qua sự kiện của chủ thể", async () => {
      const a = await newInquiry();
      const b = await newInquiry(); // đối chứng: không rút → vẫn gửi
      const received = new Date();
      const req = await handle(a.code, "inquiry", "withdraw_consent", received);
      const done = await complete(req.id);
      assert.equal(done.status, "done");
      assert.deepEqual((done.result as { withdrawn_purposes: string[] }).withdrawn_purposes, [
        "inquiry_contact",
      ]);

      const consents = await listConsents(db.admin, "inquiry", a.id);
      assert.deepEqual(
        consents.map((c) => c.event),
        ["grant", "withdraw"],
        "dòng cấp còn nguyên + dòng rút mới",
      );
      const withdraw = consents[1]!;
      assert.ok(withdraw.withdrawn_at);
      assert.ok(withdraw.withdrawn_at.getTime() - received.getTime() < 72 * 3_600_000, "≤ 72 giờ");
      assert.ok(withdraw.withdrawn_at.getTime() - received.getTime() < 60_000, "thực tế: ngay");
      assert.equal(withdraw.policy_version, consents[0]!.policy_version);

      assert.equal(
        (await q("SELECT status FROM inquiry WHERE id = $1", [a.id]))[0].status,
        "processing_stopped",
      );
      const hist = await q(
        "SELECT to_status FROM inquiry_history WHERE inquiry_id = $1 ORDER BY id DESC LIMIT 1",
        [a.id],
      );
      assert.equal(hist[0].to_status, "processing_stopped");

      const ch = new FakeChannel();
      const stats = await runOnce({
        registry: defaultRegistry(ch),
        now: () => T0,
        pool: db.app,
        batchSize: 100,
      });
      assert.ok(stats.done >= 2);
      assert.equal(ch.forInquiry(a.id).length, 0, "sự kiện của chủ thể đã rút bị bỏ qua");
      assert.equal(ch.forInquiry(b.id).length, 1, "chủ thể khác vẫn được xử lý");
      const ev = await q("SELECT status FROM outbox_event WHERE payload ->> 'inquiryId' = $1", [a.id]);
      assert.equal(ev[0].status, "done", "việc được đóng, không treo/DLQ");

      // không chuyển trạng thái tiếp được
      await withTx((tx) =>
        assert.rejects(
          updateInquiry(tx, { userId: salesId, companyId }, a.id, {
            status: "assigned",
            assigneeUserId: salesId,
          }),
          isCode("PROCESSING_RESTRICTED"),
        ),
      );
    });

    test("rút lần hai / không có đồng ý đang hiệu lực → 422, trạng thái yêu cầu giữ nguyên", async () => {
      const a = await newInquiry();
      await complete((await handle(a.code, "inquiry", "withdraw_consent")).id);
      const second = await handle(a.code, "inquiry", "withdraw_consent");
      await assert.rejects(complete(second.id), isCode("NO_ACTIVE_CONSENT"));
      assert.equal(
        (await q("SELECT status FROM data_subject_request WHERE id = $1", [second.id]))[0].status,
        "in_progress",
      );
      // nhân viên: xử lý theo hợp đồng, không có đồng ý để rút → HR từ chối kèm căn cứ
      const emp = await seedUser(companyId);
      const empCode = (await q("SELECT code FROM employee WHERE id = $1", [emp.employeeId]))[0]
        .code as string;
      const er = await handle(empCode, "employee", "withdraw_consent");
      await assert.rejects(complete(er.id), isCode("NO_ACTIVE_CONSENT"));
      const rej = await withTx((tx) =>
        rejectRequest(tx, hr, er.id, "Xử lý theo hợp đồng lao động, không dựa trên đồng ý"),
      );
      assert.equal(rej.status, "rejected");
      assert.ok(rej.closed_at);
    });

    test("ứng viên rút đồng ý → trạng thái withdrawn, worker bỏ qua application.received", async () => {
      const app = await newApplication();
      await complete((await handle(app.code, "job_application", "withdraw_consent")).id);
      assert.equal(
        (await q("SELECT status FROM job_application WHERE id = $1", [app.id]))[0].status,
        "withdrawn",
      );
      const ch = new FakeChannel();
      await runOnce({ registry: defaultRegistry(ch), now: () => T0, pool: db.app, batchSize: 100 });
      assert.equal(
        ch.sent.filter((m) => (m.payload as { applicationId?: string }).applicationId === app.id).length,
        0,
      );
    });

    test("hạn chế xử lý: cờ còn hiệu lực → worker bỏ qua và không đổi trạng thái được; dữ liệu giữ nguyên", async () => {
      const a = await newInquiry();
      const r = await complete((await handle(a.code, "inquiry", "restrict")).id);
      assert.equal((r.result as { restricted: boolean }).restricted, true);
      assert.equal((await q("SELECT name FROM inquiry WHERE id = $1", [a.id]))[0].name, "Nguyễn Thị Khách");
      assert.equal(
        (
          await q("SELECT 1 FROM processing_restriction WHERE subject_id = $1 AND released_at IS NULL", [
            a.id,
          ])
        ).length,
        1,
      );
      const ch = new FakeChannel();
      await runOnce({ registry: defaultRegistry(ch), now: () => T0, pool: db.app, batchSize: 100 });
      assert.equal(ch.forInquiry(a.id).length, 0);
      await withTx((tx) =>
        assert.rejects(
          updateInquiry(tx, { userId: salesId, companyId }, a.id, { status: "closed" }),
          isCode("PROCESSING_RESTRICTED"),
        ),
      );
    });
  });

  describe("truy cập (CMP-VN-007)", () => {
    test("xuất đúng dữ liệu của chủ thể, không lẫn người khác; ghi audit không PII", async () => {
      const a = await newInquiry({ name: "Khách Alpha", message: "Nội dung của Alpha" });
      const b = await newInquiry({ name: "Khách Beta", message: "Nội dung của Beta" });
      const req = await handle(a.code, "inquiry", "access");
      const out = await withTx((tx) => exportSubject(tx, hr, req.id));
      const text = JSON.stringify(out);
      assert.match(text, /Khách Alpha/);
      assert.match(text, new RegExp(a.email.replace(".", "\\.")));
      assert.doesNotMatch(text, /Khách Beta|Nội dung của Beta/);
      assert.ok(!text.includes(b.email), "không lộ email người khác");
      assert.ok(!text.includes(salesId), "không lộ id người phụ trách");
      assert.equal((out.data.consents as unknown[]).length, 1);
      assert.deepEqual(out.data.active_purposes, ["inquiry_contact"]);
      const audit = await q(
        "SELECT before, after, reason FROM audit_event WHERE action = 'privacy.export' AND object_id = $1",
        [req.id],
      );
      assert.equal(audit.length, 1);
      assert.ok(!JSON.stringify(audit[0]).includes("Alpha") && !JSON.stringify(audit[0]).includes(a.email));
      // xuất không đóng yêu cầu; hoàn tất là bước riêng
      assert.equal((await complete(req.id)).status, "done");
    });

    test("ứng viên: hồ sơ + thư xin việc; nhân viên: hồ sơ + chấm công tóm tắt, không lộ nhân viên khác", async () => {
      const app = await newApplication();
      const ra = await handle(app.code, "job_application", "access");
      const outApp = await withTx((tx) => exportSubject(tx, hr, ra.id));
      assert.match(JSON.stringify(outApp.data), /Tôi muốn ứng tuyển/);

      const e1 = await seedUser(companyId);
      const e2 = await seedUser(companyId);
      for (const [emp, n] of [
        [e1.employeeId, 2],
        [e2.employeeId, 3],
      ] as const)
        for (let i = 0; i < n; i++)
          await db.admin.query(
            `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time, source, status)
             VALUES ($1, $2, $3, 'h', 'in', '2026-10-05T01:00:00Z', 'kiosk', 'accepted')`,
            [companyId, emp, `key-${randomUUID()}`],
          );
      const code1 = (await q("SELECT code, full_name FROM employee WHERE id = $1", [e1.employeeId]))[0];
      const name2 = (await q("SELECT full_name FROM employee WHERE id = $1", [e2.employeeId]))[0].full_name;
      const re = await handle(code1.code, "employee", "access");
      const out = await withTx((tx) => exportSubject(tx, hr, re.id));
      const text = JSON.stringify(out.data);
      assert.match(text, new RegExp(code1.full_name));
      assert.ok(!text.includes(name2), "không lộ nhân viên khác");
      assert.deepEqual(out.data.attendance_summary, [{ month: "2026-10", events: 2, accepted: 2 }]);
    });

    test("chỉ yêu cầu access mới xuất; yêu cầu bị từ chối thì không", async () => {
      const a = await newInquiry();
      const del = await handle(a.code, "inquiry", "delete");
      await assert.rejects(
        withTx((tx) => exportSubject(tx, hr, del.id)),
        isCode("INVALID_STATE"),
      );
      const b = await newInquiry();
      const acc = await handle(b.code, "inquiry", "access");
      await withTx((tx) => rejectRequest(tx, hr, acc.id, "Không xác minh được danh tính"));
      await assert.rejects(
        withTx((tx) => exportSubject(tx, hr, acc.id)),
        isCode("INVALID_STATE"),
      );
    });
  });

  describe("xoá (CMP-RIGHTS-007, CMP-PRIV-005)", () => {
    test("liên hệ: ẩn danh DB, xoá blob, che payload outbox — truy vấn lại từng kho", async () => {
      const a = await newInquiry({ name: "Khách Cần Xoá", message: "Nội dung riêng tư cần xoá" });
      const other = await newInquiry({ name: "Khách Giữ Lại" });
      // ghi chú tự do của người xử lý có thể chứa PII
      await db.admin.query(
        "INSERT INTO inquiry_history (company_id, inquiry_id, from_status, to_status, actor_user_id, note) VALUES ($1,$2,'assigned','in_progress',$3,'gọi 0900000000 cho khách')",
        [companyId, a.id, salesId],
      );
      // tệp của chủ thể ở kho tệp + sự kiện outbox đủ trạng thái chứa id/mã hồ sơ
      const storage = diskStorage(blobDir);
      const key = await storage.put(Buffer.from("CV nội dung"));
      await withTx((tx) => registerSubjectFile(tx, companyId, "inquiry", a.id, key));
      assert.equal((await storage.get(key)).toString(), "CV nội dung");
      await db.admin.query(
        "INSERT INTO outbox_event (company_id, topic, payload, status, processed_at) VALUES ($1, 'inquiry.assigned', $2, 'done', now())",
        [companyId, JSON.stringify({ inquiryId: a.id, code: a.code, assigneeUserId: salesId })],
      );
      await db.admin.query(
        "INSERT INTO outbox_event (company_id, topic, payload, status, dead_at, last_error) VALUES ($1, 'inquiry.assigned', $2, 'dead', now(), 'lỗi')",
        [companyId, JSON.stringify({ inquiryId: a.id, code: a.code, assigneeUserId: salesId })],
      );
      const pendingBefore = await q(
        "SELECT status FROM outbox_event WHERE payload ->> 'inquiryId' = $1 AND status = 'pending'",
        [a.id],
      );
      assert.equal(pendingBefore.length, 1, "việc chưa gửi từ lúc nhận hồ sơ");

      const req = await handle(a.code, "inquiry", "delete");
      const done = await complete(req.id);
      assert.equal(done.status, "done");
      const result = done.result as {
        outcome: string;
        anonymized_rows: number;
        files_removed: number;
        outbox_redacted: number;
        retained: { category: string; reason: string }[];
      };
      assert.equal(result.outcome, "anonymized");
      assert.equal(result.anonymized_rows, 1);
      assert.equal(result.files_removed, 1);
      assert.equal(result.outbox_redacted, 3);
      assert.ok(
        result.retained.every((r) => r.reason.length > 0),
        "mục giữ lại đều có lý do",
      );

      // kho 1 — DB
      const [row] = await q("SELECT * FROM inquiry WHERE id = $1", [a.id]);
      assert.equal(row.name, ANON_NAME);
      assert.equal(row.email, ANON_EMAIL);
      assert.equal(row.phone, null);
      assert.equal(row.message, ANON_NAME);
      assert.equal(row.ip_hash, null);
      assert.ok(row.anonymized_at instanceof Date);
      assert.equal(row.status, "processing_stopped");
      assert.equal(row.code, a.code, "giữ mã để thống kê");
      const notes = await q(
        "SELECT note FROM inquiry_history WHERE inquiry_id = $1 AND actor_user_id IS NOT NULL AND note LIKE '%0900000000%'",
        [a.id],
      );
      assert.equal(notes.length, 0, "ghi chú tự do của người xử lý đã xoá");
      // kho 2 — tệp
      await assert.rejects(storage.get(key), { code: "ENOENT" });
      assert.equal((await q("SELECT 1 FROM subject_file WHERE subject_id = $1", [a.id])).length, 0);
      // kho 3 — outbox (mọi trạng thái) không còn id/mã/PII
      const ob = await q(
        "SELECT payload, status FROM outbox_event WHERE payload::text LIKE $1 OR payload::text LIKE $2",
        [`%${a.id}%`, `%${a.code}%`],
      );
      assert.equal(ob.length, 0, "không payload nào còn id hoặc mã hồ sơ");
      const redacted = await q(
        "SELECT status FROM outbox_event WHERE payload = '{\"redacted\": true}'::jsonb ORDER BY id",
      );
      assert.deepEqual(redacted.map((r) => r.status).sort(), ["dead", "done", "done"]);
      // bằng chứng đồng ý còn (không PII), có dòng rút
      const consents = await listConsents(db.admin, "inquiry", a.id);
      assert.deepEqual(
        consents.map((c) => c.event),
        ["grant", "withdraw"],
      );
      // audit không chứa PII
      const audits = JSON.stringify(
        await q(
          "SELECT before, after, reason FROM audit_event WHERE action LIKE 'privacy.%' AND object_id IN ($1, $2)",
          [req.id, a.id],
        ),
      );
      for (const needle of ["Khách Cần Xoá", "0900000000", a.email])
        assert.ok(!audits.includes(needle), needle);
      // người khác không bị ảnh hưởng
      const [keep] = await q("SELECT name, email, anonymized_at FROM inquiry WHERE id = $1", [other.id]);
      assert.equal(keep.name, "Khách Giữ Lại");
      assert.equal(keep.email, other.email);
      assert.equal(keep.anonymized_at, null);
      // worker không gửi gì cho chủ thể đã xoá
      const ch = new FakeChannel();
      await runOnce({ registry: defaultRegistry(ch), now: () => T0, pool: db.app, batchSize: 100 });
      assert.equal(ch.forInquiry(a.id).length, 0);
    });

    test("xoá lặp lại là idempotent (yêu cầu đã đóng → 409, dữ liệu không đổi)", async () => {
      const a = await newInquiry();
      const req = await handle(a.code, "inquiry", "delete");
      await complete(req.id);
      await assert.rejects(complete(req.id), isCode("INVALID_STATE"));
      // yêu cầu xoá mới cho chủ thể đã ẩn danh: chạy được, không lỗi, không ẩn danh thêm
      const again = await handle(a.code, "inquiry", "delete");
      const r = await complete(again.id);
      assert.equal((r.result as { anonymized_rows: number }).anonymized_rows, 0);
    });

    test("ứng viên: ẩn danh hồ sơ, che payload application.received, dừng xử lý", async () => {
      const app = await newApplication();
      const done = await complete((await handle(app.code, "job_application", "delete")).id);
      assert.equal((done.result as { outbox_redacted: number }).outbox_redacted, 1);
      const [row] = await q("SELECT name, email, cover_letter, status FROM job_application WHERE id = $1", [
        app.id,
      ]);
      assert.deepEqual(row, { name: ANON_NAME, email: ANON_EMAIL, cover_letter: null, status: "withdrawn" });
      assert.equal(
        (await q("SELECT 1 FROM outbox_event WHERE payload::text LIKE $1", [`%${app.id}%`])).length,
        0,
      );
    });

    test("nhân viên: dữ liệu bắt buộc giữ (hồ sơ lao động, công) — đánh dấu hạn chế + lý do, không xoá", async () => {
      const emp = await seedUser(companyId);
      const e = (await q("SELECT code, full_name FROM employee WHERE id = $1", [emp.employeeId]))[0];
      await db.admin.query(
        `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time, source, status)
         VALUES ($1, $2, $3, 'h', 'in', now(), 'kiosk', 'accepted')`,
        [companyId, emp.employeeId, `key-${randomUUID()}`],
      );
      const done = await complete((await handle(e.code, "employee", "delete")).id);
      const result = done.result as {
        erased: boolean;
        outcome: string;
        retained: { category: string; reason: string }[];
      };
      assert.equal(result.erased, false);
      assert.equal(result.outcome, "retained_by_law");
      assert.ok(result.retained.some((r) => r.category === "hồ sơ lao động" && r.reason.length > 20));
      assert.ok(result.retained.some((r) => r.category === "bảng công và nghỉ phép"));
      const [row] = await q("SELECT full_name FROM employee WHERE id = $1", [emp.employeeId]);
      assert.equal(row.full_name, e.full_name, "hồ sơ lao động còn nguyên");
      assert.equal(
        (await q("SELECT 1 FROM attendance_event WHERE employee_id = $1", [emp.employeeId])).length,
        1,
      );
      const [flag] = await q(
        "SELECT kind, reason FROM processing_restriction WHERE subject_id = $1 AND released_at IS NULL",
        [emp.employeeId],
      );
      assert.equal(flag.kind, "retained_by_law");
      assert.match(flag.reason, /giữ theo luật: .*hồ sơ lao động/);
    });
  });

  describe("tiếp nhận và hạn xử lý (CMP-INTL-007)", () => {
    test("cấu hình hạn theo loại: mặc định D-029, ghi đè được, giá trị sai bị từ chối nêu tên biến", () => {
      const base = {
        APP_ORIGIN: "http://x.test",
        DATABASE_URL: "postgres://u:p@localhost/db",
        SESSION_SECRET: "x".repeat(40),
        QR_SIGNING_KEYS: `k1:${"y".repeat(40)}`,
      };
      const d = dsarConfig(base);
      assert.equal(d.respondWorkdays, 2);
      assert.equal(d.extendDays, 15);
      assert.deepEqual(d.days, {
        access: 10,
        rectify: 10,
        export: 10,
        withdraw_consent: 15,
        restrict: 15,
        object: 15,
        delete: 20,
      });
      assert.equal(dsarConfig({ ...base, DSAR_DAYS_DELETE: "" }).days.delete, 20, "rỗng = chưa đặt");
      assert.equal(dsarConfig({ ...base, DSAR_DAYS_DELETE: "45" }).days.delete, 45);
      assert.equal(dsarConfig({ ...base, DSAR_DAYS_ACCESS: "7" }).days.export, 7, "ba loại cùng một biến");
      for (const name of [
        "DSAR_DAYS_ACCESS",
        "DSAR_DAYS_RESTRICT",
        "DSAR_DAYS_DELETE",
        "DSAR_EXTEND_DAYS",
        "DSAR_RESPOND_WORKDAYS",
      ]) {
        assert.throws(() => dsarConfig({ ...base, [name]: "0" }), new RegExp(name));
        assert.throws(() => dsarConfig({ ...base, [name]: "abc" }), new RegExp(name));
      }
    });

    test("due_at theo loại (access = 10 ngày); danh sách quá hạn chỉ gồm yêu cầu chưa đóng và đã qua hạn", async () => {
      const received = new Date("2026-08-01T03:00:00Z");
      const old = await newInquiry();
      const oldReq = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: old.code, kind: "access" }, received),
      );
      assert.equal(oldReq.due_at.toISOString(), "2026-08-11T03:00:00.000Z");
      const fresh = await newInquiry();
      await withTx((tx) =>
        createRequest(
          tx,
          hr,
          { subject_type: "inquiry", subject_ref: fresh.code, kind: "access" },
          new Date(),
        ),
      );
      const closed = await newInquiry();
      const closedReq = await withTx((tx) =>
        createRequest(
          tx,
          hr,
          { subject_type: "inquiry", subject_ref: closed.code, kind: "access" },
          received,
        ),
      );
      await withTx((tx) => rejectRequest(tx, hr, closedReq.id, "Không xác minh được danh tính", received));

      // Đã phản hồi đúng hạn: chỉ còn hạn thực hiện quyết định quá hạn (hạn phản hồi được kiểm riêng ở test bên dưới).
      await withTx((tx) => respondRequest(tx, hr, oldReq.id, new Date("2026-08-03T00:00:00Z")));
      const now = new Date("2026-09-15T00:00:00Z");
      const overdue = await listOverdue(db.admin, companyId, now);
      assert.deepEqual(
        overdue.map((r) => r.id),
        [oldReq.id],
      );
      assert.equal(overdue[0]!.overdue, true);
      const all = await listRequests(db.admin, companyId, { now });
      assert.equal(all.find((r) => r.id === closedReq.id)!.overdue, false, "đã đóng không tính quá hạn");
      // ranh giới: đúng lúc đến hạn chưa quá hạn
      assert.equal(
        (await listOverdue(db.admin, companyId, oldReq.due_at)).some((r) => r.id === oldReq.id),
        false,
      );
      assert.equal(
        (await listOverdue(db.admin, companyId, new Date(oldReq.due_at.getTime() + 1))).some(
          (r) => r.id === oldReq.id,
        ),
        true,
      );
      assert.equal(
        (await listRequests(db.admin, companyId, { status: "rejected", now })).every(
          (r) => r.status === "rejected",
        ),
        true,
      );
    });

    test("hạn theo từng loại yêu cầu: due_at, respond_due_at (ngày làm việc) lưu đúng; mỗi loại một hạn", async () => {
      // Thứ Sáu 2026-08-07 10:00 giờ VN: phản hồi trong 2 ngày làm việc → Thứ Ba 2026-08-11 10:00 VN (bỏ T7, CN).
      const received = new Date("2026-08-07T03:00:00Z");
      const expectDays = {
        access: 10,
        rectify: 10,
        export: 10,
        withdraw_consent: 15,
        restrict: 15,
        object: 15,
        delete: 20,
      } as const;
      for (const [kind, days] of Object.entries(expectDays) as [RequestKind, number][]) {
        const inq = await newInquiry();
        const r = await withTx((tx) =>
          createRequest(tx, hr, { subject_type: "inquiry", subject_ref: inq.code, kind }, received),
        );
        assert.equal(r.kind, kind);
        assert.equal(
          r.due_at.toISOString(),
          new Date(received.getTime() + days * 86_400_000).toISOString(),
          kind,
        );
        assert.equal(r.respond_due_at!.toISOString(), "2026-08-11T03:00:00.000Z", kind);
        assert.equal(r.responded_at, null);
        assert.equal(r.extended_at, null);
      }
    });

    test("quá hạn đúng ngày: đúng lúc đến hạn chưa quá, +1 ms là quá; hạn phản hồi quá hạn tách khỏi hạn thực hiện", async () => {
      const received = new Date("2026-08-07T03:00:00Z"); // Thứ Sáu
      const inq = await newInquiry();
      const r = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: inq.code, kind: "delete" }, received),
      );
      const flags = async (at: Date) => {
        const row = (await listRequests(db.admin, companyId, { now: at })).find((x) => x.id === r.id)!;
        return [row.overdue, row.respond_overdue];
      };
      const respondDue = r.respond_due_at!;
      assert.deepEqual(await flags(respondDue), [false, false], "đúng hạn phản hồi: chưa quá");
      assert.deepEqual(
        await flags(new Date(respondDue.getTime() + 1)),
        [false, true],
        "quá hạn phản hồi 1 ms",
      );
      assert.equal(
        (await listOverdue(db.admin, companyId, new Date(respondDue.getTime() + 1))).some(
          (x) => x.id === r.id,
        ),
        true,
        "listOverdue gồm cả quá hạn phản hồi",
      );
      // Cảnh báo lib/ops dùng cùng điều kiện SQL (luật dsar_overdue).
      const alerted = async (at: Date) =>
        (
          await db.admin.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM data_subject_request WHERE id = $2 AND ${dsarAnyOverdueSql("$1")}`,
            [at, r.id],
          )
        ).rows[0]!.n;
      assert.equal(await alerted(respondDue), 0);
      assert.equal(await alerted(new Date(respondDue.getTime() + 1)), 1);
      // Phản hồi (idempotent): hết quá hạn phản hồi; gọi lần hai không ghi audit mới.
      const before = (
        await q("SELECT count(*)::int AS n FROM audit_event WHERE action = 'privacy.request.respond'")
      )[0].n;
      const at = new Date(respondDue.getTime() - 3_600_000);
      const resp = await withTx((tx) => respondRequest(tx, hr, r.id, at));
      assert.equal(resp.responded_at!.toISOString(), at.toISOString());
      const again = await withTx((tx) => respondRequest(tx, hr, r.id, new Date()));
      assert.equal(again.responded_at!.toISOString(), at.toISOString(), "không ghi đè lần phản hồi đầu");
      assert.equal(
        (await q("SELECT count(*)::int AS n FROM audit_event WHERE action = 'privacy.request.respond'"))[0].n,
        before + 1,
      );
      assert.deepEqual(await flags(new Date(respondDue.getTime() + 1)), [false, false]);
      // Hạn thực hiện (delete = 20 ngày): ranh giới đúng hạn.
      assert.deepEqual(await flags(r.due_at), [false, false]);
      assert.deepEqual(await flags(new Date(r.due_at.getTime() + 1)), [true, false]);
    });

    test("gia hạn: tối đa một lần kèm lý do, chỉ khi còn mở và chưa quá hạn; hạn mới = hạn cũ + số ngày cấu hình", async () => {
      const received = new Date("2026-08-01T03:00:00Z");
      const inq = await newInquiry();
      const r = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: inq.code, kind: "access" }, received),
      );
      const early = new Date("2026-08-05T00:00:00Z");
      await assert.rejects(
        withTx((tx) => extendRequest(tx, hr, r.id, "   ", early)),
        isCode("VALIDATION"),
      );
      const ext = await withTx((tx) => extendRequest(tx, hr, r.id, "Cần xác minh danh tính", early));
      assert.equal(ext.due_at.toISOString(), new Date(r.due_at.getTime() + 15 * 86_400_000).toISOString());
      assert.equal(ext.extension_days, 15);
      assert.equal(ext.extension_reason, "Cần xác minh danh tính");
      assert.equal(ext.extended_at!.toISOString(), early.toISOString());
      await assert.rejects(
        withTx((tx) => extendRequest(tx, hr, r.id, "Lần hai", early)),
        isCode("EXTENSION_ALREADY_USED"),
        "gia hạn lần hai bị từ chối",
      );
      const [row] = await q("SELECT due_at, extension_days FROM data_subject_request WHERE id = $1", [r.id]);
      assert.equal(row.due_at.toISOString(), ext.due_at.toISOString(), "lần hai không đổi hạn");
      const audit = await q(
        "SELECT reason, after FROM audit_event WHERE action = 'privacy.request.extend' AND object_id = $1",
        [r.id],
      );
      assert.equal(audit.length, 1);
      assert.equal(audit[0].reason, "Cần xác minh danh tính");

      // Quá hạn thì không gia hạn hồi tố; đúng lúc hạn vẫn gia hạn được.
      const inq2 = await newInquiry();
      const r2 = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: inq2.code, kind: "access" }, received),
      );
      await assert.rejects(
        withTx((tx) => extendRequest(tx, hr, r2.id, "Muộn", new Date(r2.due_at.getTime() + 1))),
        isCode("EXTENSION_TOO_LATE"),
      );
      const onTime = await withTx((tx) => extendRequest(tx, hr, r2.id, "Đúng hạn", r2.due_at));
      assert.equal(onTime.extension_days, 15);
      // Đã đóng thì không gia hạn.
      const inq3 = await newInquiry();
      const r3 = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: inq3.code, kind: "access" }, received),
      );
      await withTx((tx) => rejectRequest(tx, hr, r3.id, "Không xác minh được", early));
      await assert.rejects(
        withTx((tx) => extendRequest(tx, hr, r3.id, "Sau khi đóng", early)),
        isCode("INVALID_STATE"),
      );
    });

    test("hoàn tất/từ chối cũng là phản hồi; loại mới: rectify đóng thủ công, export xuất dữ liệu, object tạo hạn chế xử lý", async () => {
      const t0 = new Date("2026-08-03T03:00:00Z");
      const a = await newInquiry();
      const rect = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: a.code, kind: "rectify" }, t0),
      );
      const done = await withTx((tx) => completeRequest(tx, hr, rect.id, t0));
      assert.deepEqual(done.result, { handled_by: "manual" });
      assert.equal(done.responded_at!.toISOString(), t0.toISOString());
      const exp = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: a.code, kind: "export" }, t0),
      );
      const out = await withTx((tx) => exportSubject(tx, hr, exp.id));
      assert.equal(out.request.kind, "export");
      assert.equal((out.data.inquiry as { email: string }).email, a.email);
      const b = await newInquiry();
      const obj = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: b.code, kind: "object" }, t0),
      );
      const objDone = await withTx((tx) => completeRequest(tx, hr, obj.id, t0));
      assert.deepEqual(objDone.result, { restricted: true, newly_restricted: true });
      const [flag] = await q(
        "SELECT kind FROM processing_restriction WHERE subject_id = $1 AND released_at IS NULL",
        [(await q("SELECT id FROM inquiry WHERE code = $1", [b.code]))[0].id],
      );
      assert.equal(flag.kind, "restrict");
    });

    test("yêu cầu cũ (trước T-044, không có hạn phản hồi) không bị coi là quá hạn phản hồi", async () => {
      const inq = await newInquiry();
      await db.admin.query(
        `INSERT INTO data_subject_request (company_id, subject_type, subject_ref, subject_id, kind, received_at, due_at)
         VALUES ($1, 'inquiry', $2, (SELECT id FROM inquiry WHERE code = $2), 'access', '2026-01-01', '2026-01-11')`,
        [companyId, inq.code],
      );
      const row = (await listRequests(db.admin, companyId, { now: new Date("2026-01-05T00:00:00Z") })).find(
        (x) => x.subject_ref === inq.code,
      )!;
      assert.equal(row.respond_due_at, null);
      assert.equal(row.respond_overdue, false);
      assert.equal(row.overdue, false);
    });

    test("kiểm tra đầu vào: không nhận email/SĐT làm mã; chủ thể không tồn tại / công ty khác → 404; trùng yêu cầu mở → 409", async () => {
      for (const ref of ["khach@example.test", "0900 000 000", "", "x".repeat(65)])
        assert.equal(
          CreateRequestInput.safeParse({ subject_type: "inquiry", subject_ref: ref, kind: "access" }).success,
          false,
          ref,
        );
      assert.equal(
        CreateRequestInput.safeParse({ subject_type: "inquiry", subject_ref: "YC-1", kind: "xoa" }).success,
        false,
      );
      await withTx((tx) =>
        assert.rejects(
          createRequest(tx, hr, { subject_type: "inquiry", subject_ref: "YC-00000000-9999", kind: "access" }),
          isCode("NOT_FOUND"),
        ),
      );
      const a = await newInquiry();
      // cùng mã nhưng actor công ty khác → không thấy
      const org2 = await seedCompany("Công ty Khác");
      const hr2 = {
        userId: (await seedUser(org2.companyId, { grants: [{ role: "hr", scopeType: "company" }] })).userId,
        companyId: org2.companyId,
      };
      await withTx((tx) =>
        assert.rejects(
          createRequest(tx, hr2, { subject_type: "inquiry", subject_ref: a.code, kind: "access" }),
          isCode("NOT_FOUND"),
        ),
      );
      await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: a.code, kind: "access" }),
      );
      await assert.rejects(
        withTx((tx) => createRequest(tx, hr, { subject_type: "inquiry", subject_ref: a.id, kind: "access" })),
        isCode("DUPLICATE_REQUEST"),
      );
      // khác loại thì được
      await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: a.code, kind: "restrict" }),
      );
    });

    test("máy trạng thái: từ chối cần căn cứ; yêu cầu đã đóng không đổi; công ty khác không thao tác được (BOLA)", async () => {
      const a = await newInquiry();
      const req = await withTx((tx) =>
        createRequest(tx, hr, { subject_type: "inquiry", subject_ref: a.code, kind: "access" }),
      );
      await withTx((tx) => assert.rejects(rejectRequest(tx, hr, req.id, "   "), isCode("VALIDATION")));
      const org2 = await seedCompany("Công ty Ba");
      const hr2 = {
        userId: (await seedUser(org2.companyId, { grants: [{ role: "hr", scopeType: "company" }] })).userId,
        companyId: org2.companyId,
      };
      await withTx((tx) => assert.rejects(startRequest(tx, hr2, req.id), isCode("NOT_FOUND")));
      await withTx((tx) => assert.rejects(completeRequest(tx, hr2, req.id), isCode("NOT_FOUND")));
      await withTx((tx) => assert.rejects(rejectRequest(tx, hr2, req.id, "x"), isCode("NOT_FOUND")));
      await withTx((tx) => startRequest(tx, hr, req.id));
      await withTx((tx) => assert.rejects(startRequest(tx, hr, req.id), isCode("INVALID_STATE")));
      const rejected = await withTx((tx) => rejectRequest(tx, hr, req.id, "Yêu cầu trùng"));
      assert.equal(rejected.reject_reason, "Yêu cầu trùng");
      await assert.rejects(complete(req.id), isCode("INVALID_STATE"));
      await withTx((tx) => assert.rejects(rejectRequest(tx, hr, req.id, "lại"), isCode("INVALID_STATE")));
      // ràng buộc DB: done không có closed_at bị từ chối
      await assert.rejects(
        db.admin.query("UPDATE data_subject_request SET status = 'done' WHERE id = $1", [req.id]),
        /check/i,
      );
    });

    test("chuỗi băm audit còn nguyên sau mọi thao tác quyền chủ thể", async () => {
      const v = await verifyAuditChain(db.admin);
      assert.equal(v.ok, true);
    });

    test("AUD-DATA-001: ghi chú tự do của người xử lý không lọt vào audit_event.reason (còn lại sau khi xoá)", async () => {
      const a = await newInquiry();
      const marker = `gọi ông B 09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
      await withTx((tx) =>
        updateInquiry(tx, { userId: salesId, companyId }, a.id, {
          status: "assigned",
          assigneeUserId: salesId,
          note: marker,
        }),
      );
      const req = await handle(a.code, "inquiry", "delete");
      await complete(req.id);
      const leaked = await q("SELECT action FROM audit_event WHERE reason LIKE $1 OR after::text LIKE $1", [
        `%${marker}%`,
      ]);
      assert.deepEqual(leaked, [], "audit_event không được giữ nội dung ghi chú tự do");
      const hist = await q(
        "SELECT note FROM inquiry_history WHERE inquiry_id = $1 AND actor_user_id IS NOT NULL AND to_status <> 'processing_stopped'",
        [a.id],
      );
      assert.ok(
        hist.every((h) => h.note === null),
        "ghi chú trong lịch sử bị xoá",
      );
    });
  });
});
