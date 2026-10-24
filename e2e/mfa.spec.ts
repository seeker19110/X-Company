// AUD-SEC-002 (T-087): bước mã TOTP và đăng ký lần đầu ở màn đăng nhập — vai trò bắt buộc (hr, exec, sysadmin).
import { expect, test, type Page } from "@playwright/test";
import {
  enterTotp,
  expectAccessible,
  expectNoHorizontalScroll,
  failOnCspViolation,
  logout,
  seed,
  wrongTotpCode,
} from "./helpers";

failOnCspViolation();

const NARROW = { width: 320, height: 800 };
const WIDE = { width: 1280, height: 800 };
const CODE = "Mã xác thực (6 số)";

/** Bước mật khẩu của người dùng seed; vai trò bắt buộc → bước mã hiện ra và ô mã nhận focus. */
async function passwordStep(page: Page, key: string) {
  const s = seed();
  await page.goto("/app/login");
  await page.getByLabel("Email").fill(s.users[key]!.email);
  await page.getByLabel("Mật khẩu").fill(s.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Xác thực hai bước" })).toBeVisible();
  await expect(page.getByLabel(CODE)).toBeFocused();
  return s.users[key]!.email;
}

/** Phần tử lỗi mà ô trỏ tới qua aria-describedby (id của useId có ký tự đặc biệt → so bằng thuộc tính). */
async function describedError(page: Page, label: string) {
  const input = page.getByLabel(label);
  await expect(input).toHaveAttribute("aria-describedby", /-err\b/); // chờ React gắn lỗi (không đọc trước khi render)
  const ids = (await input.getAttribute("aria-describedby")) ?? "";
  const errId = ids.split(" ").find((x) => x.endsWith("-err"));
  expect(errId, "ô lỗi phải trỏ tới thông điệp lỗi").toBeTruthy();
  return page.locator(`[id="${errId}"]`);
}

for (const vp of [NARROW, WIDE]) {
  test.describe(`bước mã TOTP ở ${vp.width} px`, () => {
    test.use({ viewport: vp });

    test("hr: bước mã đúng thuộc tính, axe 0 vi phạm; mã đúng → /app/today", async ({ page }) => {
      const email = await passwordStep(page, "hr");
      const code = page.getByLabel(CODE);
      await expect(code).toHaveAttribute("inputmode", "numeric");
      await expect(code).toHaveAttribute("autocomplete", "one-time-code");
      // Bước mã không có phần đăng ký (đã bật TOTP), có nút quay lại.
      await expect(page.getByRole("heading", { name: "Thiết lập ứng dụng xác thực" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Quay lại đăng nhập" })).toBeVisible();
      await expectAccessible(page);
      await expectNoHorizontalScroll(page);
      await enterTotp(page, email);
      await expect(page).toHaveURL(/\/app\/today$/);
      await logout(page);
    });
  });
}

test("mã sai → lỗi theo ô (aria-invalid + describedby), focus ô mã; quay lại đăng nhập", async ({ page }) => {
  const email = await passwordStep(page, "exec");
  const code = page.getByLabel(CODE);
  const submit = page.getByRole("button", { name: "Xác nhận" });

  // Sai định dạng: chặn ở trình duyệt, không tốn lượt thử của server.
  await code.fill("12");
  await submit.click();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(await describedError(page, CODE)).toHaveText("Nhập đủ 6 chữ số");
  await expect(code).toBeFocused();

  await code.fill(wrongTotpCode());
  await submit.click();
  await expect(await describedError(page, CODE)).toHaveText("Mã xác thực không đúng");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toBeFocused();
  await expectAccessible(page);

  await page.getByRole("button", { name: "Quay lại đăng nhập" }).click();
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel(CODE)).toHaveCount(0);
});

test("chưa qua bước mã thì chưa có phiên: vào /app/today → về /app/login (không vòng lặp)", async ({
  page,
}) => {
  await passwordStep(page, "hr");
  const res = await page.goto("/app/today");
  expect(res?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test.describe("thử thách hết hạn và giới hạn tần suất (mock phản hồi /api/app/auth/mfa)", () => {
  // page.route cần chặn service worker (check:tests).
  test.use({ serviceWorkers: "block" });

  const problem = (status: number, code: string, message: string, headers: Record<string, string> = {}) => ({
    status,
    contentType: "application/problem+json",
    headers,
    body: JSON.stringify({ status, code, message, error: { code, message } }),
  });

  test("429 → thông điệp kèm thời gian chờ ở ô mã", async ({ page }) => {
    await passwordStep(page, "exec");
    await page.route("**/api/app/auth/mfa", (r) =>
      r.fulfill(
        problem(429, "RATE_LIMITED", "Nhập sai mã xác thực quá nhiều lần, thử lại sau", {
          "retry-after": "125",
        }),
      ),
    );
    await page.getByLabel(CODE).fill("123456");
    await page.getByRole("button", { name: "Xác nhận" }).click();
    await expect(await describedError(page, CODE)).toHaveText(
      "Nhập sai mã xác thực quá nhiều lần, thử lại sau. Vui lòng chờ khoảng 3 phút rồi thử lại.",
    );
    await expect(page.getByLabel(CODE)).toBeFocused();
  });

  test("MFA_CHALLENGE_INVALID → về bước mật khẩu với thông báo, focus ô email", async ({ page }) => {
    await passwordStep(page, "exec");
    const msg = "Phiên xác thực hai bước không hợp lệ hoặc đã hết hạn — vui lòng đăng nhập lại";
    await page.route("**/api/app/auth/mfa", (r) => r.fulfill(problem(401, "MFA_CHALLENGE_INVALID", msg)));
    await page.getByLabel(CODE).fill("123456");
    await page.getByRole("button", { name: "Xác nhận" }).click();
    await expect(page.getByRole("alert").filter({ hasText: msg })).toHaveText(msg);
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel(CODE)).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe("đăng ký TOTP lần đầu", () => {
  test.use({ viewport: NARROW });

  // Mỗi project một người dùng `sys` (sysadmin chưa đăng ký) và chỉ đăng ký được một lần: test này không lặp lại được
  // trên cùng CSDL seed (lần chạy e2e nào cũng seed lại).
  test("sysadmin chưa bật TOTP: thấy khoá thủ công + otpauth, nhập mã từ khoá → vào app; lần sau chỉ hỏi mã", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const email = await passwordStep(page, "sys");
    await expect(page.getByRole("heading", { name: "Thiết lập ứng dụng xác thực" })).toBeVisible();
    const shown = (await page.locator("code.secret").textContent()) ?? "";
    expect(shown).toMatch(/^([A-Z2-7]{4} )*[A-Z2-7]{1,4}$/); // base32, nhóm 4 ký tự
    const secret = shown.replace(/\s/g, "");
    expect(secret).toHaveLength(32); // 20 byte
    const href = await page.getByRole("link", { name: /Mở trong ứng dụng xác thực/ }).getAttribute("href");
    expect(href).toMatch(/^otpauth:\/\/totp\/X-Company:/);
    expect(new URL(href!).searchParams.get("secret")).toBe(secret);
    await page.getByRole("button", { name: "Chép khoá" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã chép khoá" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    await enterTotp(page, email, secret);
    await expect(page).toHaveURL(/\/app\/today$/);
    await logout(page);

    // Đã bật: lần đăng nhập sau không còn phần đăng ký, mã từ cùng khoá được nhận.
    await passwordStep(page, "sys");
    await expect(page.getByRole("heading", { name: "Thiết lập ứng dụng xác thực" })).toHaveCount(0);
    await enterTotp(page, email, secret);
    await expect(page).toHaveURL(/\/app\/today$/);
  });
});
