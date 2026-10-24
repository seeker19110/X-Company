// Khai báo phân loại mọi cặp "METHOD /api/app/..." cho script `check:authz` (QA-INT-006, STD-SEC-004).
//   bola   = route chạm dữ liệu cá nhân/đối tượng theo người dùng → cần ít nhất một test tên có tag `api1-bola`.
//   bfla   = route chức năng quản trị/vai đặc quyền                  → cần ít nhất một test tên có tag `api5-bfla`.
//   public = không cần phiên theo thiết kế (ghi lý do); các test ma trận vẫn kiểm riêng.
// Thêm route mới mà quên khai ở đây → `npm run check:authz` đỏ. Tên test gắn tag phải chứa đúng "METHOD /api/app/<mẫu>".
export interface AuthzClass {
  bola?: boolean;
  bfla?: boolean;
  public?: string;
}

export const AUTHZ_COVERAGE: Readonly<Record<string, AuthzClass>> = {
  "POST /api/app/adjustments": { bola: true },
  "GET /api/app/applications": { bola: true, bfla: true },
  "GET /api/app/approvals": { bola: true },
  "POST /api/app/approvals/[type]/[id]/[decision]": { bola: true, bfla: true },
  "POST /api/app/attendance/events": { bola: true },
  "GET /api/app/attendance/qr/[worksiteId]": { bfla: true },
  "POST /api/app/auth/login": {
    public: "đăng nhập: chưa có phiên; kiểm Origin + giới hạn thử ở tests/http/auth.test.ts",
  },
  "POST /api/app/auth/logout": { bola: true },
  "GET /api/app/comments": { bola: true },
  "POST /api/app/comments": { bola: true },
  "POST /api/app/files": { bola: true },
  "GET /api/app/files/[id]": { bola: true },
  "GET /api/app/inquiries": { bola: true, bfla: true },
  "POST /api/app/leave-requests": { bola: true },
  "GET /api/app/me": { bola: true },
  "GET /api/app/notifications": { bola: true },
  "POST /api/app/notifications/read": { bola: true },
  "POST /api/app/ot-requests": { bola: true },
  "POST /api/app/sync": { bola: true },
  "GET /api/app/privacy/requests": { bola: true, bfla: true },
  "POST /api/app/privacy/requests": { bola: true, bfla: true },
  "GET /api/app/privacy/requests/[id]/[action]": { bola: true, bfla: true },
  "POST /api/app/privacy/requests/[id]/[action]": { bola: true, bfla: true },
  "GET /api/app/tasks": { bola: true },
  "POST /api/app/tasks/[id]/[action]": { bola: true },
};
