import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { getComments, getFile, postComment, postFile } from "../../lib/files/routes.ts";
import { diskStorage, setStorage } from "../../lib/files/storage.ts";
import { sniff } from "../../lib/files/sniff.ts";
import { loginHandler } from "../../lib/identity/routes.ts";
import { loadActor } from "../../lib/authz/load.ts";
import { withTx } from "../../lib/db/index.ts";
import { addEvidence, addMember, createProject, createTask } from "../../lib/work/tasks.ts";
import { AppError } from "../../lib/nen/app-error.ts";
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
const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

interface S {
  cookie: string;
  csrf: string;
}
async function login(email: string): Promise<S> {
  const r = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password: PASSWORD } }));
  return { cookie: cookieFrom(r), csrf: (await r.json()).csrf_token };
}
function upload(s: S, fields: Record<string, string>, file?: { name: string; data: Buffer; type?: string }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file)
    fd.set(
      "file",
      new File([new Uint8Array(file.data)], file.name, { type: file.type ?? "application/pdf" }),
    );
  return postFile(
    new Request(`${TEST_ORIGIN}/api/app/files`, {
      method: "POST",
      headers: {
        origin: TEST_ORIGIN,
        cookie: s.cookie,
        "x-csrf-token": s.csrf,
        "idempotency-key": randomUUID(),
      },
      body: fd,
    }),
  );
}
const download = (s: S, id: string) => getFile(req("GET", `/api/app/files/${id}`, { cookie: s.cookie }));

describe("sniff (loại tệp theo nội dung)", () => {
  test("nhận PDF/PNG/JPEG/WebP/DOCX/XLSX, từ chối thực thi/HTML/zip thường", () => {
    assert.equal(sniff(PDF)?.mime, "application/pdf");
    assert.equal(sniff(PNG)?.ext, "png");
    assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext, "jpg");
    assert.equal(
      sniff(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))?.ext,
      "webp",
    );
    const zipHead = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    assert.equal(
      sniff(Buffer.concat([zipHead, Buffer.from("....[Content_Types].xml....word/document.xml")]))?.ext,
      "docx",
    );
    assert.equal(
      sniff(Buffer.concat([zipHead, Buffer.from("....[Content_Types].xml....xl/workbook.xml")]))?.ext,
      "xlsx",
    );
    assert.equal(sniff(Buffer.concat([zipHead, Buffer.from("....[Content_Types].xml....ppt/")])), null);
    assert.equal(sniff(Buffer.concat([zipHead, Buffer.from("plain zip")])), null);
    assert.equal(sniff(Buffer.from("MZ\x90\x00 exe")), null);
    assert.equal(sniff(Buffer.from("<html><script>alert(1)</script>")), null);
  });
});

describe("tệp private & bình luận (T-017, S-WK-05, AT02)", () => {
  let db: TestDb;
  let storeDir: string;
  let pm: S, dev: S, outsider: S;
  let taskId: string, projectId: string, devUserId: string;

  before(async () => {
    db = await freshDb();
    storeDir = mkdtempSync(path.join(tmpdir(), "xc-files-"));
    setStorage(diskStorage(storeDir));
    const org = await seedCompany();
    const exec = await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] });
    const p = await seedUser(org.companyId);
    const d = await seedUser(org.companyId);
    const r = await seedUser(org.companyId);
    const o = await seedUser(org.companyId);
    devUserId = d.userId;
    const execA = (await loadActor(db.app, exec.userId))!;
    const pmA = (await loadActor(db.app, p.userId))!;
    projectId = await withTx((tx) =>
      createProject(tx, execA, { code: "F", name: "F", managerEmployeeId: p.employeeId! }),
    );
    await withTx(async (tx) => {
      await addMember(tx, pmA, projectId, d.employeeId!);
      await addMember(tx, pmA, projectId, r.employeeId!);
    });
    taskId = await withTx((tx) =>
      createTask(tx, pmA, {
        projectId,
        title: "Nghiệm thu tủ điện",
        responsibleEmployeeId: d.employeeId!,
        reviewerEmployeeId: r.employeeId!,
        acceptanceCriteria: "biên bản",
      }),
    );
    pm = await login(p.email);
    dev = await login(d.email);
    outsider = await login(o.email);
  });
  after(async () => {
    setStorage(undefined);
    await db.close();
  });

  test("người thực hiện tải lên → 201; tải về đúng nội dung, header an toàn; tệp lưu ngoài web root, không tên gốc", async () => {
    const r = await upload(
      dev,
      { object_type: "task", object_id: taskId },
      { name: "biên bản.pdf", data: PDF },
    );
    assert.equal(r.status, 201);
    const b = await r.json();
    assert.equal(b.version, 1);
    assert.equal(b.mime, "application/pdf");
    const g = await download(dev, b.file_id);
    assert.equal(g.status, 200);
    assert.deepEqual(Buffer.from(await g.arrayBuffer()), PDF);
    assert.equal(g.headers.get("x-content-type-options"), "nosniff");
    assert.equal(g.headers.get("cache-control"), "private, no-store");
    assert.match(
      g.headers.get("content-disposition") ?? "",
      /^attachment; .*filename\*=UTF-8''bi%C3%AAn%20b%E1%BA%A3n\.pdf$/,
    );
    const stored = readdirSync(storeDir, { recursive: true }).map(String);
    assert.ok(!stored.some((f) => f.includes("biên")), "tên gốc không nằm trong khoá lưu trữ");
  });

  test("S-WK-05: người ngoài dự án tải về → 404 (không lộ tồn tại); thành viên → 200; quản lý dự án → 200", async () => {
    const b = await (
      await upload(dev, { object_type: "task", object_id: taskId }, { name: "a.png", data: PNG })
    ).json();
    assert.equal((await download(outsider, b.file_id)).status, 404);
    assert.equal((await download(pm, b.file_id)).status, 200);
    assert.equal((await download(outsider, randomUUID())).status, 404);
    assert.equal((await download(outsider, "khong-phai-uuid")).status, 404);
    assert.equal(
      (await upload(outsider, { object_type: "task", object_id: taskId }, { name: "x.pdf", data: PDF }))
        .status,
      404,
    );
  });

  test("AT12: rời dự án → mất quyền tải ngay ở request kế tiếp (kiểm mỗi lần, không URL có hạn)", async () => {
    const b = await (
      await upload(dev, { object_type: "project", object_id: projectId }, { name: "hd.pdf", data: PDF })
    ).json();
    assert.equal((await download(dev, b.file_id)).status, 200);
    await db.admin.query(
      "DELETE FROM task_collaborator WHERE employee_id = (SELECT employee_id FROM app_user WHERE id = $1)",
      [devUserId],
    );
    await db.admin.query(
      "DELETE FROM project_member WHERE project_id = $1 AND employee_id = (SELECT employee_id FROM app_user WHERE id = $2)",
      [projectId, devUserId],
    );
    assert.equal((await download(dev, b.file_id)).status, 404);
    await db.admin.query(
      "INSERT INTO project_member (company_id, project_id, employee_id) SELECT company_id, $1, employee_id FROM app_user WHERE id = $2",
      [projectId, devUserId],
    );
  });

  test("loại theo nội dung: .pdf giả mạo (thực thi) → 415; rỗng → 422; thiếu tệp → 422; vượt 20 MB → 413", async () => {
    const fake = await upload(
      dev,
      { object_type: "task", object_id: taskId },
      { name: "hoa-don.pdf", data: Buffer.from("MZ\x90\x00 thực thi") },
    );
    assert.equal(fake.status, 415);
    assert.equal(
      (
        await upload(
          dev,
          { object_type: "task", object_id: taskId },
          { name: "x.pdf", data: Buffer.alloc(0) },
        )
      ).status,
      422,
    );
    assert.equal((await upload(dev, { object_type: "task", object_id: taskId })).status, 422);
    assert.equal(
      (await upload(dev, { object_type: "khac", object_id: taskId }, { name: "x.pdf", data: PDF })).status,
      400,
    );
    const big = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)]);
    assert.equal(
      (await upload(dev, { object_type: "task", object_id: taskId }, { name: "lon.pdf", data: big })).status,
      413,
    );
  });

  test("phiên bản: tải lên vào document có sẵn → version 2, bản cũ vẫn tải được; document của đối tượng khác → 404", async () => {
    const v1 = await (
      await upload(
        dev,
        { object_type: "task", object_id: taskId, title: "Biên bản" },
        { name: "v1.pdf", data: PDF },
      )
    ).json();
    const v2r = await upload(
      dev,
      { object_type: "task", object_id: taskId, document_id: v1.document_id },
      { name: "v2.png", data: PNG },
    );
    const v2 = await v2r.json();
    assert.deepEqual([v2.document_id, v2.version], [v1.document_id, 2]);
    assert.equal((await download(dev, v1.file_id)).status, 200);
    const wrong = await upload(
      dev,
      { object_type: "project", object_id: projectId, document_id: v1.document_id },
      { name: "x.pdf", data: PDF },
    );
    assert.equal(wrong.status, 404);
  });

  test("bằng chứng loại tệp phải là tài liệu của chính công việc", async () => {
    const devA = (await loadActor(db.app, devUserId))!;
    const doc = await (
      await upload(dev, { object_type: "task", object_id: taskId }, { name: "e.pdf", data: PDF })
    ).json();
    await withTx((tx) => addEvidence(tx, devA, taskId, { kind: "file", ref: doc.document_id }));
    const other = await (
      await upload(dev, { object_type: "project", object_id: projectId }, { name: "p.pdf", data: PDF })
    ).json();
    await assert.rejects(
      withTx((tx) => addEvidence(tx, devA, taskId, { kind: "file", ref: other.document_id })),
      (e: unknown) => e instanceof AppError && e.code === "VALIDATION",
    );
  });

  test("bình luận: thành viên đọc/viết; người ngoài 404; nội dung rỗng/quá dài → 422/400", async () => {
    const post = (s: S, body: unknown) =>
      postComment(req("POST", "/api/app/comments", { cookie: s.cookie, csrf: s.csrf, body }));
    assert.equal(
      (await post(dev, { object_type: "task", object_id: taskId, body: "Đã đo cách điện" })).status,
      201,
    );
    assert.equal((await post(pm, { object_type: "task", object_id: taskId, body: "<b>ok</b>" })).status, 201);
    assert.equal(
      (await post(outsider, { object_type: "task", object_id: taskId, body: "xin xem" })).status,
      404,
    );
    assert.equal((await post(dev, { object_type: "task", object_id: taskId, body: "   " })).status, 422);
    assert.equal(
      (await post(dev, { object_type: "task", object_id: taskId, body: "x".repeat(4001) })).status,
      400,
    );
    const list = await getComments(
      req("GET", `/api/app/comments?object_type=task&object_id=${taskId}`, { cookie: dev.cookie }),
    );
    const items = (await list.json()).items;
    assert.deepEqual(
      items.map((c: { body: string }) => c.body),
      ["Đã đo cách điện", "<b>ok</b>"],
    );
    assert.equal(
      (
        await getComments(
          req("GET", `/api/app/comments?object_type=task&object_id=${taskId}`, { cookie: outsider.cookie }),
        )
      ).status,
      404,
    );
  });

  test("tệp trong kho bị sửa → không phục vụ (kiểm dấu băm)", async () => {
    const b = await (
      await upload(dev, { object_type: "task", object_id: taskId }, { name: "z.pdf", data: PDF })
    ).json();
    const key = (await db.admin.query("SELECT storage_key FROM file_object WHERE id = $1", [b.file_id]))
      .rows[0].storage_key;
    writeFileSync(path.join(storeDir, key), Buffer.from("%PDF-1.7 giả mạo"));
    assert.equal((await download(dev, b.file_id)).status, 500);
  });
});
