import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { postInquiry } from "../../lib/inquiry/routes.ts";
import { normalizeNfc } from "../../lib/nen/text.ts";
import {
  daysToMs,
  epochSeconds,
  kb,
  mb,
  minutesToMs,
  msToSeconds,
  secondsToMs,
} from "../../lib/nen/units.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import { violations } from "../../scripts/check-units.mjs";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { req, seedCompany, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

// "Tiếng Việt" ở hai dạng Unicode: NFC (dựng sẵn) và NFD (tổ hợp — bàn phím macOS/iOS thường gửi).
const NFC = "Nguyễn Thị Ánh — Tiếng Việt 🇻🇳";
const NFD = NFC.normalize("NFD");

describe("văn bản & đơn vị (T-031: BASE-DATA-001/002, XC-I18N-005, XC-UNITS-009)", () => {
  let db: TestDb;
  before(async () => {
    process.env.TRUST_PROXY = "1";
    db = await freshDb();
    const { companyId } = await seedCompany();
    process.env.SITE_COMPANY_ID = companyId;
  });
  after(async () => {
    await db.close();
  });

  test("tiền đề: NFD khác NFC theo byte nhưng cùng hiển thị", () => {
    assert.notEqual(NFD, NFC);
    assert.equal(NFD.normalize("NFC"), NFC);
  });

  test("normalizeNfc: đệ quy chuỗi, mảng, khoá object; giữ nguyên số/null/bool", () => {
    assert.deepEqual(normalizeNfc({ [NFD]: [NFD, 1, null, true, { x: NFD }] }), {
      [NFC]: [NFC, 1, null, true, { x: NFC }],
    });
  });

  test("CSDL UTF-8: lưu/đọc lại nguyên vẹn tiếng Việt + emoji (không mất byte, không ?)", async () => {
    const enc = await db.admin.query<{ e: string }>(
      "SELECT pg_encoding_to_char(encoding) AS e FROM pg_database WHERE datname = current_database()",
    );
    assert.equal(enc.rows[0]!.e, "UTF8");
    const r = await db.admin.query<{ t: string; n: number }>(
      "SELECT $1::text AS t, octet_length($1::text) AS n",
      [NFC],
    );
    assert.equal(r.rows[0]!.t, NFC);
    assert.equal(r.rows[0]!.n, Buffer.byteLength(NFC, "utf8"));
  });

  test("gửi NFD qua form công khai → lưu NFC; JSON trả về khai charset utf-8", async () => {
    const res = await postInquiry(
      req("POST", "/api/public/inquiries", {
        body: {
          submission_id: randomUUID(),
          name: NFD,
          email: "anh@example.test",
          phone: null,
          message: `Cần tư vấn ${NFD}`,
          consent: true,
          website: "",
          elapsed_ms: 15000,
        },
        headers: { "x-forwarded-for": "10.9.0.1" },
      }),
    );
    assert.equal(res.status, 201);
    assert.match(res.headers.get("content-type") ?? "", /charset=utf-8/i);
    const row = await db.admin.query<{ name: string; message: string }>(
      "SELECT name, message FROM inquiry ORDER BY created_at DESC LIMIT 1",
    );
    assert.equal(row.rows[0]!.name, NFC);
    assert.equal(row.rows[0]!.message, `Cần tư vấn ${NFC}`);
    // NFD và NFC giờ là MỘT giá trị khi so sánh ở DB
    const same = await db.admin.query("SELECT 1 FROM inquiry WHERE name = $1", [NFD.normalize("NFC")]);
    assert.equal(same.rowCount, 1);
  });

  test("units: chuyển đổi đúng; check:units bắt số ma thuật, bỏ qua comment", () => {
    assert.equal(secondsToMs(2), 2000);
    assert.equal(msToSeconds(1500), 1.5);
    assert.equal(minutesToMs(15), 900_000);
    assert.equal(daysToMs(1), 86_400_000);
    assert.equal(kb(8), 8192);
    assert.equal(mb(1), 1_048_576);
    assert.equal(epochSeconds(new Date("1970-01-01T00:00:01.999Z")), 1);
    assert.equal((violations("x.ts", "const a = t * 1000;\nconst b = n / 1024;") as string[]).length, 2);
    assert.deepEqual(violations("x.ts", "// đổi * 1000 ở units.ts\nconst c = secondsToMs(t);"), []);
  });
});
