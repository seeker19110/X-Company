// Cổng GPS ở server (T-051, D-032; DPIA mục 1, 6, 9): toạ độ chỉ được lưu khi cờ GEO_CAPTURE_ENABLED bật VÀ nhân viên có đồng ý
// riêng `geo_attendance` còn hiệu lực; lưu thì mã hoá. Postgres thật. Nhãn bằng chứng: faithful-fixture.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { recordEvent } from "../../lib/attendance/events.ts";
import { openGeo } from "../../lib/crypto/columns.ts";
import { withTx } from "../../lib/db/index.ts";
import {
  PURPOSE_GEO_ATTENDANCE,
  hasActiveConsent,
  recordConsent,
  withdrawConsent,
} from "../../lib/privacy/consent.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
process.env.DATA_ENCRYPTION_KEYS = `g1:${randomBytes(32).toString("base64")}`;
process.env.DATA_INDEX_KEY = randomBytes(32).toString("base64");

const LAT = 10.762622;
const LNG = 106.660172;
const geo = { lat: LAT, lng: LNG, accuracyM: 8, capturedAt: new Date("2026-10-19T01:00:00Z") };

describe("cổng GPS ở server (T-051)", () => {
  let db: TestDb;
  let companyId: string;
  let emp: Awaited<ReturnType<typeof seedUser>>;
  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany());
    emp = await seedUser(companyId);
  });
  after(async () => {
    delete process.env.GEO_CAPTURE_ENABLED;
    await db.close();
  });

  const actor = () => ({ userId: emp.userId, companyId, employeeId: emp.employeeId! });
  const send = (withGeo: boolean) =>
    recordEvent(db.app, actor(), {
      idempotencyKey: randomUUID(),
      kind: "in",
      deviceTime: new Date(),
      source: "gps",
      geo: withGeo ? geo : null,
    });
  const grant = () =>
    withTx((tx) =>
      recordConsent(tx, {
        companyId,
        subjectType: "employee",
        subjectId: emp.employeeId!,
        purposeId: PURPOSE_GEO_ATTENDANCE,
        policyVersion: "geo-v1",
        channel: "test",
        at: new Date(),
      }),
    );
  const row = async (id: string) =>
    (await db.admin.query("SELECT * FROM attendance_event WHERE id = $1", [id])).rows[0]!;
  const auditOf = async (id: string) =>
    (
      await db.admin.query(
        "SELECT after FROM audit_event WHERE object_type = 'attendance_event' AND object_id = $1 AND action = 'attendance.event'",
        [id],
      )
    ).rows[0]!.after as Record<string, unknown>;

  test("S-AT-14: cờ TẮT (mặc định) → bỏ toạ độ dù có đồng ý; không lỗi; audit ghi lý do, không có toạ độ", async () => {
    delete process.env.GEO_CAPTURE_ENABLED;
    await grant();
    const r = await send(true);
    assert.equal(r.status, "accepted");
    assert.equal(r.geoStored, false);
    const e = await row(r.eventId);
    assert.deepEqual(
      [e.geo_lat, e.geo_lng, e.geo_accuracy_m, e.geo_captured_at, e.geo_enc],
      [null, null, null, null, null],
    );
    const a = await auditOf(r.eventId);
    assert.equal(a.geoDropped, "flag_off");
    assert.equal(JSON.stringify(a).includes(String(LAT)), false);
  });

  test("S-AT-15: cờ BẬT nhưng thiếu đồng ý → bỏ toạ độ", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    const other = await seedUser(companyId);
    const r = await recordEvent(
      db.app,
      { userId: other.userId, companyId, employeeId: other.employeeId! },
      {
        idempotencyKey: randomUUID(),
        kind: "in",
        deviceTime: new Date(),
        source: "gps",
        geo,
      },
    );
    assert.equal(r.geoStored, false);
    assert.equal((await row(r.eventId)).geo_enc, null);
    assert.equal((await auditOf(r.eventId)).geoDropped, "no_consent");
  });

  test("S-AT-16: cờ BẬT + có đồng ý → lưu MÃ HOÁ (bản rõ NULL, dump không thấy toạ độ), đọc giải mã đúng; replay giữ geo_stored", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    assert.equal(await hasActiveConsent(db.app, "employee", emp.employeeId!, PURPOSE_GEO_ATTENDANCE), true);
    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      kind: "in" as const,
      deviceTime: new Date(),
      source: "gps" as const,
      geo,
    };
    const r = await recordEvent(db.app, actor(), input);
    assert.equal(r.geoStored, true);
    const e = await row(r.eventId);
    assert.deepEqual([e.geo_lat, e.geo_lng, e.geo_accuracy_m, e.geo_captured_at], [null, null, null, null]);
    assert.match(e.geo_enc, /^v1:g1:/);
    assert.equal(String(e.geo_enc).includes("10.76"), false);
    assert.deepEqual(openGeo(r.eventId, e), {
      lat: LAT,
      lng: LNG,
      accuracy_m: 8,
      captured_at: "2026-10-19T01:00:00.000Z",
    });
    const a = await auditOf(r.eventId);
    assert.equal(a.geoStored, true);
    assert.equal(JSON.stringify(a).includes("10.76"), false);
    const again = await recordEvent(db.app, actor(), input);
    assert.equal(again.replayed, true);
    assert.equal(again.geoStored, true);
  });

  test("S-AT-17: rút đồng ý → dừng thu ngay (lần gửi kế tiếp bỏ toạ độ); cấp lại → thu lại", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    const withdrawn = await withTx((tx) =>
      withdrawConsent(tx, companyId, "employee", emp.employeeId!, new Date(), "test", [
        PURPOSE_GEO_ATTENDANCE,
      ]),
    );
    assert.deepEqual(withdrawn, [PURPOSE_GEO_ATTENDANCE]);
    const r = await send(true);
    assert.equal(r.geoStored, false);
    assert.equal((await auditOf(r.eventId)).geoDropped, "no_consent");
    await grant();
    assert.equal((await send(true)).geoStored, true);
  });

  test("hạn chế xử lý (restrict) cũng chặn thu toạ độ; không gửi geo → không ghi geoDropped", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    const u = await seedUser(companyId);
    await withTx(async (tx) => {
      await recordConsent(tx, {
        companyId,
        subjectType: "employee",
        subjectId: u.employeeId!,
        purposeId: PURPOSE_GEO_ATTENDANCE,
        policyVersion: "geo-v1",
        channel: "test",
        at: new Date(),
      });
    });
    const ev = (g: typeof geo | null) =>
      recordEvent(
        db.app,
        { userId: u.userId, companyId, employeeId: u.employeeId! },
        {
          idempotencyKey: randomUUID(),
          kind: "in",
          deviceTime: new Date(),
          source: "gps",
          geo: g,
        },
      );
    const ok = await ev(null);
    assert.equal("geoDropped" in (await auditOf(ok.eventId)), false);
    await db.admin.query(
      `INSERT INTO processing_restriction (company_id, subject_type, subject_id, kind, reason)
       VALUES ($1, 'employee', $2, 'restrict', 'kiểm thử')`,
      [companyId, u.employeeId],
    );
    assert.equal((await ev(geo)).geoStored, false);
  });

  test("không có sinh trắc/ảnh khuôn mặt: schema không có cột và mã không có đường dẫn như vậy", async () => {
    const cols = await db.admin.query(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~* '(biometric|face|fingerprint|selfie|photo|vein|iris|sinh_trac|khuon_mat|van_tay)'`,
    );
    assert.deepEqual(cols.rows, []);
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else routes.push(p);
      }
    };
    walk(new URL("../../app/api", import.meta.url).pathname);
    assert.deepEqual(
      routes.filter((p) => /biometric|face|fingerprint|selfie|photo/i.test(p)),
      [],
    );
    const src = readFileSync(new URL("../../lib/attendance/routes.ts", import.meta.url), "utf8");
    assert.equal(/biometric|faceId|fingerprint|selfie/i.test(src), false);
  });
});
