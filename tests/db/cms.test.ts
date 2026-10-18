import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import {
  approve,
  archivePage,
  changeSlug,
  createDraft,
  createPage,
  findRedirect,
  getPublished,
  listPublished,
  pathFor,
  publish,
  restoreVersion,
  returnToDraft,
  submitForReview,
  updateDraft,
  type CmsActor,
} from "../../lib/cms/index.ts";
import { lintMarkdown, renderMarkdown } from "../../lib/cms/markdown.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe("markdown an toàn (S-WEB-06, THREAT-MODEL T8)", () => {
  test("HTML thô bị escape, không thực thi", () => {
    const html = renderMarkdown('Xin chào <script>alert(1)</script> <img src=x onerror="alert(2)">');
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<img"));
    assert.match(html, /&lt;script&gt;/);
  });
  test("link javascript: bị bỏ, link ngoài có rel noopener", () => {
    const html = renderMarkdown("[a](javascript:alert(1)) [b](https://vi.wikipedia.org) [c](/lien-he)");
    assert.ok(!/href="javascript:/i.test(html));
    assert.match(html, /href="https:\/\/vi\.wikipedia\.org" rel="noopener noreferrer"/);
    assert.match(html, /href="\/lien-he">c</);
  });
  test("cảnh báo ảnh thiếu alt", () => {
    assert.deepEqual(
      lintMarkdown("![](a.png) ![Sơ đồ](b.png)").map((w) => w.code),
      ["IMAGE_MISSING_ALT"],
    );
  });
});

describe("CMS (F-003)", () => {
  let db: TestDb;
  let author: CmsActor, reviewer: CmsActor, other: CmsActor;
  let companyId: string;

  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany());
    const otherCo = await seedCompany("Khác");
    const u1 = await seedUser(companyId);
    const u2 = await seedUser(companyId);
    const u3 = await seedUser(otherCo.companyId);
    author = { userId: u1.userId, companyId };
    reviewer = { userId: u2.userId, companyId };
    other = { userId: u3.userId, companyId: otherCo.companyId };
  });
  after(async () => {
    await db.close();
  });

  const content = (title: string, body = "Nội dung") => ({
    title,
    bodyMarkdown: body,
    seoDescription: "Mô tả",
  });

  test("S-WEB-02: bản nháp / chờ duyệt / đã duyệt chưa xuất bản không công khai", async () => {
    const rev = await withTx((tx) =>
      createPage(tx, author, { type: "service", slug: "tu-van" }, content("Tư vấn")),
    );
    assert.equal(rev.version, 1);
    assert.equal(rev.status, "draft");
    assert.equal(await getPublished(db.app, companyId, "service", "tu-van"), null);
    await withTx((tx) => submitForReview(tx, author, rev.id));
    assert.equal(await getPublished(db.app, companyId, "service", "tu-van"), null);
    await withTx((tx) => approve(tx, reviewer, rev.id));
    assert.equal(await getPublished(db.app, companyId, "service", "tu-van"), null);
    assert.equal((await listPublished(db.app, companyId)).length, 0);
    await withTx((tx) => publish(tx, reviewer, rev.id));
    const pub = await getPublished(db.app, companyId, "service", "tu-van");
    assert.equal(pub?.title, "Tư vấn");
    assert.equal(pub?.reviewerUserId, reviewer.userId);
  });

  test("S-WEB-03: tác giả tự duyệt → SELF_APPROVAL; DB cũng chặn reviewer = author", async () => {
    const rev = await withTx((tx) =>
      createPage(tx, author, { type: "news", slug: "tin-1" }, content("Tin 1")),
    );
    await withTx((tx) => submitForReview(tx, author, rev.id));
    await assert.rejects(
      withTx((tx) => approve(tx, author, rev.id)),
      isCode("SELF_APPROVAL"),
    );
    await assert.rejects(
      db.app.query("UPDATE cms_revision SET reviewer_user_id = author_user_id WHERE id = $1", [rev.id]),
      /check constraint/,
    );
  });

  test("luồng sai thứ tự bị từ chối; trả lại cần lý do; chỉ sửa được nháp", async () => {
    const rev = await withTx((tx) =>
      createPage(tx, author, { type: "news", slug: "tin-2" }, content("Tin 2")),
    );
    await assert.rejects(
      withTx((tx) => approve(tx, reviewer, rev.id)),
      isCode("INVALID_STATE"),
    );
    await assert.rejects(
      withTx((tx) => publish(tx, reviewer, rev.id)),
      isCode("INVALID_STATE"),
    );
    await withTx((tx) => updateDraft(tx, author, rev.id, content("Tin 2 sửa")));
    await withTx((tx) => submitForReview(tx, author, rev.id));
    await assert.rejects(
      withTx((tx) => updateDraft(tx, author, rev.id, content("x"))),
      isCode("INVALID_STATE"),
    );
    await assert.rejects(
      withTx((tx) => returnToDraft(tx, reviewer, rev.id, " ")),
      isCode("VALIDATION"),
    );
    await withTx((tx) => returnToDraft(tx, reviewer, rev.id, "Thiếu số liệu"));
    const { rows } = await db.admin.query("SELECT status, title FROM cms_revision WHERE id = $1", [rev.id]);
    assert.deepEqual(rows[0], { status: "draft", title: "Tin 2 sửa" });
    const audit = await db.admin.query("SELECT reason FROM audit_event WHERE action = 'cms.return'");
    assert.equal(audit.rows[0].reason, "Thiếu số liệu");
  });

  test("hẹn giờ: publish_at tương lai chưa hiện; bản mới thay bản cũ khi tới hạn", async () => {
    const v1 = await withTx((tx) =>
      createPage(tx, author, { type: "about", slug: "" }, content("Giới thiệu v1")),
    );
    await withTx(async (tx) => {
      await submitForReview(tx, author, v1.id);
      await approve(tx, reviewer, v1.id);
      await publish(tx, reviewer, v1.id);
    });
    const v2 = await withTx((tx) => createDraft(tx, author, v1.pageId, content("Giới thiệu v2")));
    assert.equal(v2.version, 2);
    const tomorrow = new Date(Date.now() + 86_400_000);
    await withTx(async (tx) => {
      await submitForReview(tx, author, v2.id);
      await approve(tx, reviewer, v2.id);
      await publish(tx, reviewer, v2.id, tomorrow);
    });
    assert.equal((await getPublished(db.app, companyId, "about", ""))?.title, "Giới thiệu v1");
    const later = new Date(Date.now() + 2 * 86_400_000);
    assert.equal(
      (await getPublished(db.app, companyId, "about", "", { now: later }))?.title,
      "Giới thiệu v2",
    );
  });

  test("hoàn tác = xuất bản lại nội dung cũ thành phiên bản mới, lịch sử giữ nguyên", async () => {
    const page = await getPublished(db.app, companyId, "about", "", {
      now: new Date(Date.now() + 3 * 86_400_000),
    });
    assert.ok(page);
    const restored = await withTx((tx) => restoreVersion(tx, reviewer, page.pageId, 1));
    assert.equal(restored.version, 3);
    const now = await getPublished(db.app, companyId, "about", "", {
      now: new Date(Date.now() + 3 * 86_400_000),
    });
    // v2 hẹn ngày mai có publish_at muộn hơn v3 (now) → khi tới hạn v2 vẫn mới nhất theo publish_at.
    assert.ok(now);
    const { rows } = await db.admin.query(
      "SELECT version, status, restored_from_version FROM cms_revision WHERE page_id = $1 ORDER BY version",
      [page.pageId],
    );
    assert.deepEqual(
      rows.map((r) => [r.version, r.status, r.restored_from_version]),
      [
        [1, "published", null],
        [2, "published", null],
        [3, "published", 1],
      ],
    );
    assert.equal((await getPublished(db.app, companyId, "about", ""))?.title, "Giới thiệu v1");
    await assert.rejects(
      withTx((tx) => restoreVersion(tx, author, page.pageId, 1)),
      isCode("SELF_APPROVAL"),
    );
    await assert.rejects(
      withTx((tx) => restoreVersion(tx, reviewer, page.pageId, 99)),
      isCode("NOT_FOUND"),
    );
  });

  test("đổi slug → slug cũ chuyển hướng 301 sang mới, chuỗi chuyển hướng không nhiều bước", async () => {
    const pub = await getPublished(db.app, companyId, "service", "tu-van");
    assert.ok(pub);
    await withTx((tx) => changeSlug(tx, author, pub.pageId, "tu-van-thiet-ke"));
    assert.equal(await findRedirect(db.app, companyId, "/dich-vu/tu-van"), "/dich-vu/tu-van-thiet-ke");
    await withTx((tx) => changeSlug(tx, author, pub.pageId, "thiet-ke"));
    assert.equal(await findRedirect(db.app, companyId, "/dich-vu/tu-van"), "/dich-vu/thiet-ke");
    assert.equal(await findRedirect(db.app, companyId, "/dich-vu/tu-van-thiet-ke"), "/dich-vu/thiet-ke");
    // Đổi về slug cũ: không tạo vòng lặp chuyển hướng.
    await withTx((tx) => changeSlug(tx, author, pub.pageId, "tu-van"));
    assert.equal(await findRedirect(db.app, companyId, "/dich-vu/tu-van"), null);
    assert.equal(await findRedirect(db.app, companyId, "/dich-vu/thiet-ke"), "/dich-vu/tu-van");
    await assert.rejects(
      withTx((tx) => changeSlug(tx, author, pub.pageId, "Có Dấu")),
      isCode("VALIDATION"),
    );
    await withTx((tx) => changeSlug(tx, author, pub.pageId, "tu-van"));
  });

  test("slug trùng / sai định dạng / khác công ty", async () => {
    await assert.rejects(
      withTx((tx) => createPage(tx, author, { type: "service", slug: "tu-van" }, content("Trùng"))),
      isCode("DUPLICATE"),
    );
    await assert.rejects(
      withTx((tx) => createPage(tx, author, { type: "service", slug: "Tư Vấn" }, content("x"))),
      isCode("VALIDATION"),
    );
    await assert.rejects(
      withTx((tx) =>
        createPage(tx, author, { type: "service", slug: "x" }, { title: " ", bodyMarkdown: "" }),
      ),
      isCode("VALIDATION"),
    );
    const pub = await getPublished(db.app, companyId, "service", "tu-van");
    await assert.rejects(
      withTx((tx) => createDraft(tx, other, pub!.pageId, content("x"))),
      isCode("NOT_FOUND"),
    );
    await assert.rejects(
      withTx((tx) => approve(tx, other, pub!.id)),
      isCode("NOT_FOUND"),
    );
    assert.equal(await getPublished(db.app, other.companyId, "service", "tu-van"), null);
  });

  test("lưu trữ trang → ẩn khỏi công khai; xuất bản lại → hiện", async () => {
    const pub = await getPublished(db.app, companyId, "service", "tu-van");
    await withTx((tx) => archivePage(tx, author, pub!.pageId, "ngừng dịch vụ"));
    assert.equal(await getPublished(db.app, companyId, "service", "tu-van"), null);
    const d = await withTx((tx) => createDraft(tx, author, pub!.pageId, content("Tư vấn mới")));
    await withTx(async (tx) => {
      await submitForReview(tx, author, d.id);
      await approve(tx, reviewer, d.id);
      await publish(tx, reviewer, d.id);
    });
    assert.equal((await getPublished(db.app, companyId, "service", "tu-van"))?.title, "Tư vấn mới");
  });

  test("pathFor", () => {
    assert.equal(pathFor("home", ""), "/");
    assert.equal(pathFor("about", ""), "/gioi-thieu");
    assert.equal(pathFor("job", "ky-su"), "/tuyen-dung/ky-su");
    assert.equal(pathFor("page", "chinh-sach"), "/chinh-sach");
    assert.equal(pathFor("page", ""), "/");
  });
});
