import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { getComments, getFile, postComment, postFile } from "../../lib/files/routes.ts";
import { diskStorage, setStorage } from "../../lib/files/storage.ts";
import { sniff } from "../../lib/files/sniff.ts";
import { checkedFileName } from "../../lib/files/names.ts";
import { loadActor } from "../../lib/authz/load.ts";
import { withTx } from "../../lib/db/index.ts";
import { addEvidence, addMember, createProject, createTask } from "../../lib/work/tasks.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import {
  cookieFrom,
  req,
  seedCompany,
  seedUser,
  setTestEnv,
  TEST_ORIGIN,
  loginThrough,
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
  const r = await loginThrough(email);
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

describe("checkedFileName (BE-FILE-001/003)", () => {
  test("tên rỗng/khoảng trắng → tên mặc định theo loại dò", () => {
    assert.equal(checkedFileName("", { mime: "application/pdf", ext: "pdf" }), "tep.pdf");
    assert.equal(checkedFileName("   ", { mime: "image/png", ext: "png" }), "tep.png");
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

  test("BE-FILE-001: allowlist đuôi, đuôi khớp nội dung, đuôi kép bị từ chối (415)", async () => {
    const ref = { object_type: "task", object_id: taskId };
    const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    const php = Buffer.from("<?php system($_GET['c']); ?>");
    const cases: [string, Buffer][] = [
      ["shell.png", php], // .php đổi tên .png: nội dung không phải ảnh
      ["anh.jpg", PNG], // PNG mang đuôi .jpg
      ["a.jpg.exe", JPG], // đuôi kép, đuôi cuối ngoài allowlist
      ["a.php.jpg", JPG], // đuôi kép, đoạn giữa thực thi
      ["a.png.jpg", JPG], // hai đuôi ảnh
      ["a.PDF.EXE", PDF],
      ["a.exe", PDF],
      ["khong-duoi", PDF],
      ["a.pdf.", PDF], // dấu chấm cuối (lách trên Windows)
      ["a.svg", PDF],
      ["a.pdf", PNG], // đuôi pdf nhưng nội dung PNG
    ];
    for (const [name, data] of cases) {
      const r = await upload(dev, ref, { name, data });
      assert.equal(r.status, 415, `${name} phải bị từ chối`);
    }
    // Hợp lệ: đuôi hoa/thường, jpeg ↔ jpg, tên có nhiều dấu chấm không phải đuôi.
    for (const [name, data] of [
      ["ANH.JPG", JPG],
      ["anh.jpeg", JPG],
      ["bao.cao.v2.pdf", PDF],
      ["A.PNG", PNG],
    ] as [string, Buffer][]) {
      assert.equal((await upload(dev, ref, { name, data })).status, 201, `${name} phải được nhận`);
    }
    // Không có từ chối nào để lại bản ghi/tệp mồ côi.
    const bad = await db.admin.query(
      "SELECT count(*)::int AS n FROM file_object WHERE original_name = 'a.jpg.exe'",
    );
    assert.equal(bad.rows[0].n, 0);
  });

  test("BE-FILE-003: tên `../../etc/passwd` → khoá lưu không chứa `..`; DB lưu tên đã lọc ký tự điều khiển", async () => {
    const ref = { object_type: "task", object_id: taskId };
    const before = new Set(readdirSync(storeDir, { recursive: true }).map(String));
    const r = await upload(dev, ref, { name: "../../etc/passwd.pdf", data: PDF });
    assert.equal(r.status, 201);
    const row = (
      await db.admin.query("SELECT storage_key, original_name FROM file_object WHERE id = $1", [
        (await r.json()).file_id,
      ])
    ).rows[0];
    assert.match(row.storage_key, /^[0-9a-f]{2}\/[0-9a-f]{40}$/);
    assert.equal((row.storage_key as string).includes(".."), false);
    assert.equal(
      /[/\\]/.test(row.original_name as string),
      false,
      "tên gốc không còn dấu phân cách đường dẫn",
    );
    const added = readdirSync(storeDir, { recursive: true })
      .map(String)
      .filter((f) => !before.has(f));
    assert.ok(added.every((f) => !f.includes("passwd") && !f.includes("..")));
    // Ký tự điều khiển \x00-\x1f, \x7f, dấu nháy kép và đảo chiều văn bản bị thay.
    const nasty = 'a\x00b\x01c\x1fd\x7fe\r\nf"g\\h/i\u202ej.pdf';
    const r2 = await upload(dev, ref, { name: nasty, data: PDF });
    assert.equal(r2.status, 201);
    const name2 = (
      await db.admin.query("SELECT original_name FROM file_object WHERE id = $1", [(await r2.json()).file_id])
    ).rows[0].original_name as string;
    assert.equal(name2, "a_b_c_d_e__f_g_h_i_j.pdf");
    assert.doesNotMatch(name2, /[\x00-\x1f\x7f/\\"]/);
    // Tên quá dài: cắt nhưng giữ đuôi, ≤ 200 ký tự.
    const r3 = await upload(dev, ref, { name: `${"x".repeat(500)}.pdf`, data: PDF });
    const name3 = (
      await db.admin.query("SELECT original_name FROM file_object WHERE id = $1", [(await r3.json()).file_id])
    ).rows[0].original_name as string;
    assert.equal(name3.length, 200);
    assert.ok(name3.endsWith(".pdf"));
    // Chỉ ký tự điều khiển → thành "__" không đuôi → 415 (tên rỗng không tới được đây qua multipart: coi như thiếu tệp).
    assert.equal((await upload(dev, ref, { name: "\x00\x01", data: PDF })).status, 415);
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

describe("kho tệp: path traversal (BASE-SEC-007, BE-FILE-003)", () => {
  test("khoá do server sinh; đọc/xoá với khoá có `..`, tuyệt đối, sai định dạng đều bị từ chối", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xc-store-"));
    const st = diskStorage(dir);
    const key = await st.put(PDF);
    assert.match(key, /^[0-9a-f]{2}\/[0-9a-f]{40}$/);
    assert.deepEqual(await st.get(key), PDF);
    const evil = [
      "../../etc/passwd",
      `../${key}`,
      `${key}/../../x`,
      `/${key}`,
      "/etc/passwd",
      "ab/../../../etc/passwd",
      `${key}\u0000.png`,
      `${key}\n`,
      "",
      "..",
      "ab\\cd",
    ];
    for (const k of evil) {
      await assert.rejects(st.get(k), /Khoá tệp không hợp lệ/, `get(${JSON.stringify(k)})`);
      await assert.rejects(st.remove(k), /Khoá tệp không hợp lệ/, `remove(${JSON.stringify(k)})`);
    }
    assert.ok(readdirSync(dir, { recursive: true }).length >= 1, "tệp hợp lệ còn nguyên");
  });
});
