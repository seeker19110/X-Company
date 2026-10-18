import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { login } from "./helpers";

// STD-PRIV-004: quyền chủ thể là luồng có E2E — truy cập, xoá, rút đồng ý. Khách gửi form công khai; HR (người phụ trách)
// đăng nhập, ghi yêu cầu nhận qua kênh liên hệ rồi xử lý. Chưa có giao diện HR (T-032) → HR gọi API với phiên đã đăng nhập.
const ORIGIN = "http://localhost:3100";

interface ApiBody {
  code?: string;
  request: { id: string; status: string; result: { outcome?: string; withdrawn_purposes?: string[] } };
}
interface InquiryExport {
  data: {
    inquiry: { name: string; email: string; status: string };
    consents: { purpose_id: string; event: string; channel: string }[];
    active_purposes: string[];
  };
}

async function submitContact(request: APIRequestContext, name: string) {
  const email = `${randomUUID().slice(0, 8)}@example.test`;
  const res = await request.post("/api/public/inquiries", {
    data: {
      submission_id: randomUUID(),
      name,
      email,
      message: "Cần báo giá hệ thống điện nhẹ",
      consent: true,
      elapsed_ms: 9000,
    },
  });
  expect(res.status()).toBe(201);
  const { code } = (await res.json()) as { code: string };
  expect(code).toMatch(/^YC-\d{8}-\d{4}$/);
  return { code, email };
}

async function hrApi(page: Page) {
  await login(page, "hr");
  const me = (await (await page.request.get("/api/app/me")).json()) as { csrf_token: string };
  const headers = () => ({ "x-csrf-token": me.csrf_token, origin: ORIGIN, "idempotency-key": randomUUID() });
  const post = async (path: string, data: unknown = {}) => {
    const res = await page.request.post(path, { data, headers: headers() });
    return { status: res.status(), body: (await res.json()) as ApiBody };
  };
  const handle = async (code: string, kind: string, finish = true) => {
    const created = await post("/api/app/privacy/requests", {
      subject_type: "inquiry",
      subject_ref: code,
      kind,
    });
    expect(created.status).toBe(201);
    const id = created.body.request.id as string;
    expect((await post(`/api/app/privacy/requests/${id}/start`)).status).toBe(200);
    if (!finish) return { id, done: null };
    const done = await post(`/api/app/privacy/requests/${id}/complete`);
    expect(done.status).toBe(200);
    return { id, done: done.body.request };
  };
  const exportOf = async (id: string) => {
    const res = await page.request.get(`/api/app/privacy/requests/${id}/export`);
    expect(res.status()).toBe(200);
    return (await res.json()) as InquiryExport;
  };
  return { post, handle, exportOf };
}

test.describe("quyền chủ thể dữ liệu (STD-PRIV-004)", () => {
  test("rights-access: HR xuất dữ liệu của một liên hệ, dữ liệu đúng của chính người đó", async ({
    page,
    request,
  }) => {
    const a = await submitContact(request, "Khách Truy Cập A");
    const hr = await hrApi(page);
    const { id } = await hr.handle(a.code, "access", false);
    const out = await hr.exportOf(id);
    expect(out.data.inquiry.name).toBe("Khách Truy Cập A");
    expect(out.data.inquiry.email).toBe(a.email);
    expect(out.data.consents).toHaveLength(1);
    expect(out.data.consents[0]).toMatchObject({
      purpose_id: "inquiry_contact",
      event: "grant",
      channel: "web_form",
    });
  });

  test("rights-delete: HR xử lý yêu cầu xoá → dữ liệu liên hệ bị ẩn danh, bằng chứng đồng ý còn", async ({
    page,
    request,
  }) => {
    const a = await submitContact(request, "Khách Cần Xoá E2E");
    const hr = await hrApi(page);
    const { done } = await hr.handle(a.code, "delete");
    expect(done!.status).toBe("done");
    expect(done!.result.outcome).toBe("anonymized");
    const check = await hr.handle(a.code, "access", false);
    const out = await hr.exportOf(check.id);
    expect(out.data.inquiry.name).toBe("[đã ẩn danh]");
    expect(out.data.inquiry.email).not.toBe(a.email);
    expect(out.data.inquiry.status).toBe("processing_stopped");
    expect(out.data.consents.map((c: { event: string }) => c.event)).toEqual(["grant", "withdraw"]);
    expect(JSON.stringify(out)).not.toContain("Khách Cần Xoá E2E");
  });

  test("rights-withdraw-consent: HR xử lý rút đồng ý → dừng xử lý, thêm dòng rút", async ({
    page,
    request,
  }) => {
    const a = await submitContact(request, "Khách Rút Đồng Ý");
    const hr = await hrApi(page);
    const { done } = await hr.handle(a.code, "withdraw_consent");
    expect(done!.result.withdrawn_purposes).toEqual(["inquiry_contact"]);
    const check = await hr.handle(a.code, "access", false);
    const out = await hr.exportOf(check.id);
    expect(out.data.inquiry.status).toBe("processing_stopped");
    expect(out.data.active_purposes).toEqual([]);
    // rút lần hai: không còn đồng ý hiệu lực → 422, yêu cầu giữ nguyên để HR từ chối kèm căn cứ
    const second = await hr.handle(a.code, "withdraw_consent", false);
    const r = await hr.post(`/api/app/privacy/requests/${second.id}/complete`);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("NO_ACTIVE_CONSENT");
  });
});
