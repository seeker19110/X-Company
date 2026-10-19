// Dữ liệu bổ sung cho DAST cục bộ (scripts/dast-baseline.mjs; KHÔNG dùng cho production): chạy SAU seed-e2e.ts.
// Đưa nội dung ĐỘC vào các nơi người dùng/biên tập viên nhập được và được render ra HTML — để probe XSS lưu đọc lại
// trang thật: markdown CMS (thân, tiêu đề, tóm tắt, SEO), và tiêu đề việc ở khu nội bộ (/app/tasks của nv).
// Mọi payload mang dấu `data-mk="MK-…"` / `MK-…` để bộ phân tích phát hiện phần tử bị chèn.
import { readFileSync } from "node:fs";
import pg from "pg";
import { setPool, withTx } from "../lib/db/index.ts";
import { approve, createPage, publish, submitForReview } from "../lib/cms/index.ts";
import { loadActor } from "../lib/authz/load.ts";
import { addMember, createProject, createTask } from "../lib/work/tasks.ts";

interface SeedFile {
  companyId: string;
  users: Record<string, { userId: string; employeeId: string }>;
}
const seed = JSON.parse(readFileSync("e2e/.seed.json", "utf8")) as SeedFile;
const u = seed.users;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
setPool(pool);

/** Thân markdown độc: HTML thô, scheme nguy hiểm (kể cả giấu bằng entity/chữ hoa/khoảng trắng), ảnh, autolink, bảng. */
const EVIL_MARKDOWN = [
  "Đoạn mở đầu bình thường.",
  "",
  '<script data-mk="MK-MD1">window.__dastHit="MK-MD1";alert("MK-MD1")</script>',
  "",
  "<img data-mk=\"MK-MD2\" src=x onerror=\"window.__dastHit='MK-MD2';alert('MK-MD2')\">",
  "",
  '<svg data-mk="MK-MD3" onload="window.__dastHit=\'MK-MD3\'"></svg>',
  "",
  '<iframe data-mk="MK-MD4" srcdoc="<script>parent.__dastHit=\'MK-MD4\'</script>"></iframe>',
  "",
  "[nhấn](javascript:window.__dastHit='MK-MD5')",
  "[nhấn](  jAvAsCrIpT:window.__dastHit='MK-MD6')",
  "[nhấn](&#106;avascript:window.__dastHit='MK-MD7')",
  "[nhấn](java\tscript:window.__dastHit='MK-MD8')",
  "[nhấn](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19kYXN0SGl0PSdNSy1NRDknPC9zY3JpcHQ+)",
  "![ảnh](javascript:window.__dastHit='MK-MD10')",
  "[nháy](https://example.test/\" onmouseover=\"window.__dastHit='MK-MD11')",
  "<javascript:window.__dastHit='MK-MD12'>",
  "",
  "| a | b |",
  "|---|---|",
  '| <b data-mk="MK-MD13" onclick="window.__dastHit=1">x</b> | `<script>MK-MD14</script>` |',
  "",
  "```html",
  '<script data-mk="MK-MD15">1</script>',
  "```",
  "",
  "{{constructor.constructor('window.__dastHit=\"MK-MD16\"')()}} ${window.__dastHit='MK-MD17'} <%= MK-MD18 %>",
].join("\n");

const EVIL_TITLE = `"><img data-mk="MK-TITLE" src=x onerror="window.__dastHit='MK-TITLE'">`;
const EVIL_TASK_TITLE = `<img data-mk="MK-TASK" src=x onerror="window.__dastHit='MK-TASK'"><script data-mk="MK-TASK2">window.__dastHit='MK-TASK2'</script>`;

await withTx(async (tx) => {
  const ed = { userId: u.ed!.userId, companyId: seed.companyId };
  const ed2 = { userId: u.ed2!.userId, companyId: seed.companyId };
  const r = await createPage(
    tx,
    ed,
    { type: "service", slug: "dast-markdown-doc" },
    {
      title: EVIL_TITLE,
      summary: `<svg data-mk="MK-SUM" onload="window.__dastHit='MK-SUM'"> tóm tắt`,
      bodyMarkdown: EVIL_MARKDOWN,
      seoTitle: `</title><script data-mk="MK-SEO">window.__dastHit='MK-SEO'</script>`,
      seoDescription: `"><script data-mk="MK-SEOD">window.__dastHit='MK-SEOD'</script>`,
      canonicalUrl: `https://example.test/x"><script data-mk="MK-CAN">1</script>`,
    },
  );
  await submitForReview(tx, ed, r.id);
  await approve(tx, ed2, r.id);
  await publish(tx, ed2, r.id);

  const exec = (await loadActor(tx, u.exec!.userId))!;
  const projectId = await createProject(tx, exec, {
    code: "DA-DAST",
    name: `Dự án DAST <script data-mk="MK-PRJ">window.__dastHit='MK-PRJ'</script>`,
    managerEmployeeId: u.exec!.employeeId,
  });
  const pm = (await loadActor(tx, u.exec!.userId))!;
  await addMember(tx, pm, projectId, u.nv!.employeeId);
  await addMember(tx, pm, projectId, u.tl!.employeeId);
  await createTask(tx, pm, {
    projectId,
    title: EVIL_TASK_TITLE,
    responsibleEmployeeId: u.nv!.employeeId,
    reviewerEmployeeId: u.tl!.employeeId,
    acceptanceCriteria: `<img data-mk="MK-AC" src=x onerror="window.__dastHit='MK-AC'">`,
  });
});
await pool.end();
process.stdout.write("Seed DAST xong\n");
