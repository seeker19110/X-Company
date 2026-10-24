import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { base32Decode, hotp, totpStep } from "../lib/identity/totp.pure.ts";

type Users = Record<string, { email: string; userId: string; employeeId: string }>;
interface SeedFile {
  companyId: string;
  password: string;
  /** Bí mật TOTP cố định của người dùng E2E vai trò bắt buộc (hr, exec) — scripts/seed-e2e.ts. */
  totpSecret: string;
  users: Users;
  mobile: { companyId: string; users: Users };
}
export interface Seed {
  companyId: string;
  password: string;
  users: Users;
}

/** Dữ liệu của project đang chạy: mỗi project một công ty (scripts/seed-e2e.ts) → luồng ghi không giành trạng thái. */
export const seed = (): Seed => {
  const f = JSON.parse(readFileSync("e2e/.seed.json", "utf8")) as SeedFile;
  return test.info().project.name.startsWith("mobile")
    ? { companyId: f.mobile.companyId, password: f.password, users: f.mobile.users }
    : { companyId: f.companyId, password: f.password, users: f.users };
};

/** Bí mật TOTP cố định (base32) của người dùng E2E vai trò bắt buộc (hr, exec) — scripts/seed-e2e.ts. */
export const totpSecret = (): string =>
  (JSON.parse(readFileSync("e2e/.seed.json", "utf8")) as SeedFile).totpSecret;

/**
 * Mã TOTP cho bí mật base32 (mặc định: bí mật seed) ở bước hiện tại + `offset` (AUD-SEC-002). Server nhận lệch ±1 bước và
 * chống phát lại theo bước — luồng đăng nhập nên đi qua `login()` (tự chọn bước chưa dùng).
 */
export function totpCode(offset = 0, secretB32 = totpSecret()): string {
  return hotp(base32Decode(secretB32)!, totpStep(Date.now()) + offset);
}

/** Mã chắc chắn sai lúc này: khác mã của mọi bước trong cửa sổ server chấp nhận (±1) và bước kế. */
export function wrongTotpCode(secretB32 = totpSecret()): string {
  const valid = new Set([-1, 0, 1, 2].map((o) => totpCode(o, secretB32)));
  for (let n = 0; ; n++) {
    const c = String(n).padStart(6, "0");
    if (!valid.has(c)) return c;
  }
}

/** Bước TOTP đã dùng gần nhất theo email trong tiến trình test này (server từ chối bước ≤ bước đã dùng). */
const usedTotpStep = new Map<string, number>();

/**
 * Bước mã của đăng nhập: chọn bước chưa dùng nhỏ nhất ≥ bước hiện tại. Cửa sổ server là ±1 bước nên bước được chọn
 * phải ≤ hiện tại + 1; nếu cùng người đã đăng nhập hai lần trong 30 s thì chờ đồng hồ sang bước kế bằng `expect.poll`
 * (điều kiện trên đồng hồ, không ngủ cứng). Tất định: bị từ chối (vd bước đã dùng ở tiến trình khác/lần chạy trước khi
 * worker khởi động lại) → đánh dấu bước đó đã dùng và thử bước kế, tối đa 3 lần (dưới hạn 5 lần sai/thử thách).
 */
export async function enterTotp(page: Page, email: string, secretB32 = totpSecret()) {
  const input = page.getByLabel("Mã xác thực (6 số)");
  for (let attempt = 0; attempt < 3; attempt++) {
    const want = Math.max(totpStep(Date.now()), (usedTotpStep.get(email) ?? -1) + 1);
    await expect
      .poll(() => totpStep(Date.now()) + 1 >= want, { timeout: 45_000, intervals: [250] })
      .toBe(true);
    usedTotpStep.set(email, want);
    await input.fill(hotp(base32Decode(secretB32)!, want));
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/app/auth/mfa") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Xác nhận" }).click(),
    ]);
    if (res.ok()) {
      await expect(page).toHaveURL(/\/app\/today$/);
      return;
    }
    const body = (await res.json()) as { code?: string };
    if (body.code !== "INVALID_MFA_CODE") throw new Error(`bước mã TOTP lỗi ${res.status()} ${body.code}`);
  }
  throw new Error(`TOTP bị từ chối 3 lần liên tiếp cho ${email}`);
}

/** Đăng nhập bằng mật khẩu seed; vai trò bắt buộc TOTP (hr, exec) đi tiếp bước mã (T-087). */
export async function login(page: Page, key: string) {
  const s = seed();
  const email = s.users[key]!.email;
  await page.goto("/app/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(s.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  const code = page.getByLabel("Mã xác thực (6 số)");
  // Kết thúc bước mật khẩu: hoặc vào thẳng app, hoặc hiện bước mã.
  await expect.poll(async () => /\/app\/today$/.test(page.url()) || (await code.isVisible())).toBe(true);
  if (!/\/app\/today$/.test(page.url())) await enterTotp(page, email);
  await expect(page).toHaveURL(/\/app\/today$/);
}

export async function logout(page: Page) {
  await page.goto("/app/me");
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  // Hộp xác nhận (<dialog>) chỉ xuất hiện khi còn bản chưa gửi: đồng bộ rồi (nếu cần) xoá và đăng xuất.
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if (await dialog.isVisible()) {
      await dialog.getByRole("button", { name: /^(Đồng bộ|Xoá và đăng xuất)$/ }).click();
    }
    await expect(page).toHaveURL(/\/app\/login$/, { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

/** WCAG 2.2 AA (axe, UX-A11Y-001/STD-A11Y-002): KHÔNG có vi phạm nào, ở mọi mức độ. */
export async function expectAccessible(page: Page) {
  // Sau điều hướng/refresh phía client, <title> có thể vắng thoáng chốc (metadata nạp sau) → chờ ổn định rồi mới quét,
  // không bỏ qua luật nào của axe (document-title vẫn bị kiểm).
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations.map(
      (v) => `${v.impact ?? "?"} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

/** UX-RESP-001 (WCAG 1.4.10): không cuộn ngang ở bề rộng hiện tại. */
export async function expectNoHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `scrollWidth ${scroll} > clientWidth ${client} tại ${page.url()}`).toBeLessThanOrEqual(
    client,
  );
}

/** SEC-WEB-004: mọi trang mở trong test không được có vi phạm CSP (style/script bị chặn = giao diện hỏng âm thầm).
 * Gọi một lần ở đầu mỗi file spec (hook của Playwright đăng ký theo file). */
export function failOnCspViolation() {
  let errs: string[] = [];
  const watch = (p: Page) =>
    p.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|violates the following/i.test(m.text()))
        errs.push(m.text());
    });
  test.beforeEach(async ({ page, context }) => {
    errs = [];
    watch(page);
    context.on("page", watch); // cả trang mở thêm trong cùng context
  });
  test.afterEach(async () => {
    expect(errs, "vi phạm CSP trên trang").toEqual([]);
  });
}
