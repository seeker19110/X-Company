import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import {
  approve,
  changeSlug,
  createPage,
  publish,
  submitForReview,
  type CmsActor,
} from "../../lib/cms/index.ts";
import { resolvePublicPath, robotsRules, sitemapEntries, listSection } from "../../lib/site/index.ts";
import sitemap from "../../app/sitemap.ts";
import robots from "../../app/robots.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv, TEST_ORIGIN } from "../helpers/fixtures.ts";

setTestEnv();

describe("website công khai (T-009, S-WEB-02)", () => {
  let db: TestDb;
  let author: CmsActor, reviewer: CmsActor;

  async function publishPage(
    type: Parameters<typeof createPage>[2]["type"],
    slug: string,
    title: string,
    body = "",
  ) {
    return withTx(async (tx) => {
      const r = await createPage(
        tx,
        author,
        { type, slug },
        { title, bodyMarkdown: body, summary: `Tóm tắt ${title}` },
      );
      await submitForReview(tx, author, r.id);
      await approve(tx, reviewer, r.id);
      await publish(tx, reviewer, r.id);
      return r;
    });
  }

  before(async () => {
    db = await freshDb();
    const { companyId } = await seedCompany();
    process.env.SITE_COMPANY_ID = companyId;
    author = { userId: (await seedUser(companyId)).userId, companyId };
    reviewer = { userId: (await seedUser(companyId)).userId, companyId };
    await publishPage("home", "", "Trang chủ", "Chào mừng **khách hàng**");
    await publishPage("about", "", "Giới thiệu");
    await publishPage("service", "tu-van", "Tư vấn", "<script>alert(1)</script>");
    await publishPage("page", "chinh-sach-du-lieu", "Chính sách dữ liệu cá nhân");
    // Bản nháp và bản chờ duyệt — không được lộ.
    await withTx((tx) =>
      createPage(tx, author, { type: "service", slug: "nhap" }, { title: "Nháp", bodyMarkdown: "" }),
    );
    await withTx(async (tx) => {
      const r = await createPage(
        tx,
        author,
        { type: "news", slug: "cho-duyet" },
        { title: "Chờ", bodyMarkdown: "" },
      );
      await submitForReview(tx, author, r.id);
    });
  });
  after(async () => {
    await db.close();
  });

  test("phân giải trang chủ, giới thiệu, chi tiết dịch vụ, trang tự do; HTML đã escape", async () => {
    const home = await resolvePublicPath(db.app, []);
    assert.equal(home.kind, "page");
    assert.match(home.kind === "page" ? home.html : "", /<strong>khách hàng<\/strong>/);
    assert.equal((await resolvePublicPath(db.app, ["gioi-thieu"])).kind, "page");
    const svc = await resolvePublicPath(db.app, ["dich-vu", "tu-van"]);
    assert.equal(svc.kind, "page");
    assert.ok(svc.kind === "page" && !svc.html.includes("<script>"));
    assert.equal((await resolvePublicPath(db.app, ["chinh-sach-du-lieu"])).kind, "page");
  });

  test("bản nháp / chờ duyệt / đường dẫn lạ → không có", async () => {
    assert.deepEqual(await resolvePublicPath(db.app, ["dich-vu", "nhap"]), { kind: "not_found" });
    assert.deepEqual(await resolvePublicPath(db.app, ["tin-tuc", "cho-duyet"]), { kind: "not_found" });
    assert.deepEqual(await resolvePublicPath(db.app, ["a", "b", "c"]), { kind: "not_found" });
    assert.deepEqual(await resolvePublicPath(db.app, ["lien-he"]), { kind: "not_found" });
    const titles = (await listSection(db.app, "service")).map((p) => p.title);
    assert.deepEqual(titles, ["Tư vấn"]);
  });

  test("đổi slug → đường dẫn cũ trả chuyển hướng", async () => {
    const svc = await resolvePublicPath(db.app, ["dich-vu", "tu-van"]);
    assert.equal(svc.kind, "page");
    await withTx((tx) =>
      changeSlug(tx, author, svc.kind === "page" ? svc.page.pageId : "", "tu-van-ky-thuat"),
    );
    assert.deepEqual(await resolvePublicPath(db.app, ["dich-vu", "tu-van"]), {
      kind: "redirect",
      to: "/dich-vu/tu-van-ky-thuat",
    });
    assert.equal((await resolvePublicPath(db.app, ["dich-vu", "tu-van-ky-thuat"])).kind, "page");
  });

  test("sitemap chỉ gồm trang đã xuất bản + mục lục; không có nháp/chờ duyệt", async () => {
    const urls = (await sitemapEntries(db.app)).map((e) => e.url);
    assert.ok(urls.includes(`${TEST_ORIGIN}/`));
    assert.ok(urls.includes(`${TEST_ORIGIN}/gioi-thieu`));
    assert.ok(urls.includes(`${TEST_ORIGIN}/dich-vu/tu-van-ky-thuat`));
    assert.ok(urls.includes(`${TEST_ORIGIN}/tuyen-dung`));
    assert.ok(!urls.some((u) => u.includes("nhap") || u.includes("cho-duyet")));
    assert.equal(new Set(urls).size, urls.length, "không trùng URL");
    const viaRoute = await sitemap();
    assert.deepEqual(viaRoute.map((e) => e.url).sort(), urls.slice().sort());
  });

  test("robots chặn /app và /api, trỏ sitemap", () => {
    const r = robotsRules();
    assert.deepEqual(r.rules[0]?.disallow, ["/app", "/api"]);
    assert.equal(r.sitemap, `${TEST_ORIGIN}/sitemap.xml`);
    assert.deepEqual(robots(), r);
  });

  test("thiếu SITE_COMPANY_ID → lỗi rõ ràng", async () => {
    const saved = process.env.SITE_COMPANY_ID;
    delete process.env.SITE_COMPANY_ID;
    try {
      await assert.rejects(resolvePublicPath(db.app, []), /SITE_COMPANY_ID/);
    } finally {
      process.env.SITE_COMPANY_ID = saved;
    }
  });
});
