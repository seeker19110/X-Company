// BASE-DOC-007, BE-API-001, BE-API-008: SINH hợp đồng OpenAPI 3.1 `docs/api/openapi.json` từ registry route↔schema
// (dưới đây) + schema zod thật của các route (z.toJSONSchema). `npm run -s gen:openapi` ghi tệp; `npm run -s check:openapi`
// sinh lại trong bộ nhớ và so với tệp đã commit. Chỉ chạy ở script/docs — KHÔNG import vào app/ (không phình JS client).
//
// Quy tắc registry: mỗi tệp route.ts dưới app/api có đúng một mục, khai từng phương thức đã export. `source` trỏ tới
// hàm xử lý thật (`lib/<miền>/<tệp>.ts#<tên>`) — check-openapi.ts đối chiếu với tệp route.ts và với cờ idempotent trong mã.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as prettier from "prettier";
import * as z from "zod";
import { EventBody } from "../lib/attendance/routes.ts";
import { DecisionBody } from "../lib/attendance/request-routes.ts";
import { AdjustmentInput, LeaveInput, OtInput } from "../lib/attendance/request-schema.pure.ts";
import { ObjectRef } from "../lib/files/routes.ts";
import { LoginBody } from "../lib/identity/routes.ts";
import { ApplicationInput, InquiryInput } from "../lib/inquiry/index.ts";
import { Batch } from "../lib/offline/sync-route.ts";
import { CreateRequestInput, KINDS as PRIVACY_KINDS } from "../lib/privacy/index.ts";
import { RumInput } from "../lib/rum/index.ts";
import { ACTIONS as PRIVACY_ACTIONS, ActionBody, STATUSES } from "../lib/privacy/routes.ts";
import { ACTIONS as TASK_ACTIONS, Body as TaskActionBody } from "../lib/work/routes.ts";
import { PAGE_DEFAULT_LIMIT, PAGE_MAX_LIMIT, PAGE_MAX_OFFSET } from "../lib/nen/pagination.ts";

const root = path.resolve(import.meta.dirname, "..");
export const OPENAPI_FILE = "docs/api/openapi.json";

type Json = Record<string, unknown>;
type Auth = "public" | "session" | "metrics";
type Idem = "guard" | "handler" | "none";

interface Param {
  name: string;
  in: "path" | "query" | "header";
  schema: Json;
  required?: boolean;
  description: string;
}

interface Resp {
  description: string;
  /** Tên schema trong components.schemas (JSON). */
  schema?: string;
  /** Thân không phải JSON (kiểu → mô tả). */
  raw?: { type: string; schema: Json };
  headers?: Record<string, { description: string; schema: Json }>;
}

interface Op {
  source: string;
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  auth?: Auth;
  /** Quyền kiểm ở server (mô tả; nguồn: lib/authz + docs/ROUTES.md). */
  permission?: string;
  idempotency: Idem;
  rateLimited?: boolean;
  params?: Param[];
  paged?: boolean;
  body?: { kind: "json"; schema: string } | { kind: "multipart"; schema: string };
  ok: Record<number, Resp>;
  /** Mã lỗi riêng của route (ngoài tập suy ra từ auth/idempotency/body). */
  errors?: number[];
  /** Lý do duyệt phá vỡ hợp đồng (QA-INT-007): ghi vào operation dưới `x-breaking-approved`. */
  breakingApproved?: string;
}

/** Duyệt xoá operation (QA-INT-007): `"METHOD /path": "lý do"` → `x-breaking-approved-removals` ở gốc tài liệu. Mặc định rỗng. */
export const REMOVAL_APPROVALS: Record<string, string> = {};

type Registry = Record<string, Partial<Record<"GET" | "POST", Op>>>;

const uuid = { type: "string", format: "uuid" };
const dateTime = { type: "string", format: "date-time" };
const nullable = (s: Json): Json => ({ ...s, type: [s.type, "null"] });
const idParam = (what: string): Param => ({
  name: "id",
  in: "path",
  required: true,
  schema: uuid,
  description: what,
});
const pageParams = ["Limit", "Offset"];

// ---- schema phản hồi viết tay (thân JSON do `json(...)` trả về; zod chỉ có cho request) -------------------------------

const obj = (props: Record<string, Json>, required: string[] = Object.keys(props)): Json => ({
  type: "object",
  properties: props,
  required,
});
const pageOf = (item: string): Json =>
  obj({
    items: { type: "array", items: { $ref: `#/components/schemas/${item}` } },
    limit: { type: "integer", minimum: 1, maximum: PAGE_MAX_LIMIT },
    offset: { type: "integer", minimum: 0, maximum: PAGE_MAX_OFFSET },
    next_offset: { type: ["integer", "null"], description: "Offset của trang kế; null khi đã hết." },
  });

const SCHEMAS: Record<string, Json> = {
  Problem: {
    type: "object",
    description:
      "Lỗi theo RFC 9457 (application/problem+json). Giữ thêm `error` và `code`/`message` để client cũ không vỡ.",
    required: ["type", "title", "status", "detail", "instance", "code", "message", "request_id", "error"],
    properties: {
      type: { type: "string", description: "URI loại lỗi, dạng /problems/<code-gạch-nối>." },
      title: { type: "string" },
      status: { type: "integer", minimum: 400, maximum: 599 },
      detail: { type: "string", description: "Thông điệp tiếng Việt cho người dùng." },
      instance: { type: "string", description: "urn:uuid:<request_id>." },
      code: { type: "string", description: "Mã ổn định SNAKE_UPPER (ví dụ VALIDATION, VERSION_CONFLICT)." },
      message: { type: "string" },
      request_id: { type: "string", format: "uuid" },
      trace_id: { type: "string" },
      fields: {
        type: "array",
        description: "Lỗi theo trường (khi 400 VALIDATION).",
        items: obj({ path: { type: "string" }, message: { type: "string" } }),
      },
      error: obj(
        {
          code: { type: "string" },
          message: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
        ["code", "message"],
      ),
    },
  },
  OkResult: obj({ ok: { type: "boolean", const: true } }),
  IdResult: obj({ id: uuid }),
  CodeResult: obj({ code: { type: "string", description: "Mã tra cứu (YC-… / UV-…)." } }),
  HealthResult: obj({ status: { type: "string", enum: ["ok", "shutting_down", "db_unavailable"] } }),
  LoginResult: obj({ user_id: uuid, csrf_token: { type: "string" } }),
  MeResult: obj(
    {
      user_id: uuid,
      company_id: uuid,
      employee_id: nullable(uuid),
      email: { type: "string" },
      display_name: { type: "string" },
      roles: {
        type: "array",
        items: obj({
          role: { type: "string" },
          scope_type: { type: "string" },
          scope_id: nullable(uuid),
        }),
      },
      csrf_token: { type: "string" },
    },
    ["user_id", "company_id", "employee_id", "roles", "csrf_token"],
  ),
  TaskItem: obj({
    id: uuid,
    title: { type: "string" },
    status: { type: "string" },
    due_date: nullable({ type: "string", format: "date" }),
    priority: { type: "integer" },
    version: { type: "integer", minimum: 1 },
    project_name: { type: "string" },
    role: { type: "string", enum: ["responsible", "reviewer"] },
  }),
  TaskPage: pageOf("TaskItem"),
  TaskTransitionResult: obj({ id: uuid, version: { type: "integer", minimum: 1 } }),
  ApprovalItem: obj({
    type: { type: "string", enum: ["leave", "ot", "adjustment"] },
    id: uuid,
    employeeId: uuid,
    employeeName: { type: "string" },
    summary: { type: "string" },
    createdAt: dateTime,
  }),
  ApprovalPage: pageOf("ApprovalItem"),
  EventResult: obj({
    event_id: uuid,
    status: { type: "string", enum: ["accepted", "needs_review"] },
    review_reason: nullable({ type: "string" }),
    server_received_at: dateTime,
    shift_assignment_id: nullable(uuid),
    geo_stored: { type: "boolean" },
  }),
  QrResult: obj({
    token: { type: "string" },
    ttl_sec: { type: "integer" },
    expires_at: dateTime,
  }),
  FileUploadResult: obj({
    document_id: uuid,
    version: { type: "integer" },
    file_id: uuid,
    mime: { type: "string" },
    sha256: { type: "string" },
  }),
  CommentItem: obj({
    id: uuid,
    author_user_id: uuid,
    display_name: { type: "string" },
    body: { type: "string" },
    created_at: dateTime,
  }),
  CommentPage: pageOf("CommentItem"),
  InquiryItem: obj({
    id: uuid,
    code: { type: "string" },
    name: { type: "string" },
    email: nullable({ type: "string" }),
    phone: nullable({ type: "string" }),
    message: { type: "string" },
    service_slug: nullable({ type: "string" }),
    status: { type: "string" },
    assignee_user_id: nullable(uuid),
    due_at: nullable(dateTime),
    suspected_spam: { type: "boolean" },
    created_at: dateTime,
  }),
  InquiryPage: pageOf("InquiryItem"),
  ApplicationItem: obj({
    id: uuid,
    code: { type: "string" },
    job_page_id: nullable(uuid),
    name: { type: "string" },
    email: { type: "string" },
    phone: nullable({ type: "string" }),
    status: { type: "string" },
    suspected_spam: { type: "boolean" },
    created_at: dateTime,
  }),
  ApplicationPage: pageOf("ApplicationItem"),
  PrivacyRequest: {
    type: "object",
    required: ["id", "kind", "status", "subject_type", "subject_ref", "received_at", "due_at"],
    properties: {
      id: uuid,
      company_id: uuid,
      subject_type: { type: "string", enum: ["inquiry", "job_application", "employee"] },
      subject_ref: { type: "string" },
      subject_id: uuid,
      kind: { type: "string", enum: [...PRIVACY_KINDS] },
      status: { type: "string", enum: [...STATUSES] },
      received_at: dateTime,
      due_at: dateTime,
      respond_due_at: nullable(dateTime),
      responded_at: nullable(dateTime),
      extended_at: nullable(dateTime),
      extension_days: nullable({ type: "integer" }),
      extension_reason: nullable({ type: "string" }),
      overdue: { type: "boolean" },
      respond_overdue: { type: "boolean" },
      closed_at: nullable(dateTime),
      handler: nullable({ type: "string" }),
      note: nullable({ type: "string" }),
      reject_reason: nullable({ type: "string" }),
      result: {},
    },
  },
  PrivacyRequestPage: pageOf("PrivacyRequest"),
  PrivacyRequestResult: obj({ request: { $ref: "#/components/schemas/PrivacyRequest" } }),
  PrivacyExport: obj({
    request: obj({
      id: uuid,
      kind: { type: "string" },
      subject_type: { type: "string" },
      received_at: dateTime,
      due_at: dateTime,
    }),
    generated_at: dateTime,
    data: { type: "object", additionalProperties: true },
  }),
  SyncResult: obj({
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "ok"],
        properties: {
          id: uuid,
          ok: { type: "boolean" },
          status: { type: "string", enum: ["accepted", "needs_review"] },
          reviewReason: nullable({ type: "string" }),
          eventId: uuid,
          httpStatus: { type: "integer" },
          code: { type: "string" },
          message: { type: "string" },
          retryAfterSec: { type: "integer" },
        },
      },
    },
  }),
};

// ---- schema request: từ zod thật ---------------------------------------------------------------------------------------

/** Bỏ `pattern` của zod khi đã có `format` chuẩn (uuid/email/date-time/date) — format đã nói đủ, regex chỉ gây nhiễu. */
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (node !== null && typeof node === "object") {
    const o = node as Json;
    const out: Json = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "$schema") continue;
      if (k === "pattern" && typeof o.format === "string") continue;
      out[k] = tidy(v);
    }
    return out;
  }
  return node;
}

function fromZod(schema: unknown): Json {
  const js = z.toJSONSchema(schema as z.ZodType, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  });
  return tidy(js) as Json;
}

function requestSchemas(): Record<string, Json> {
  const refProps = (fromZod(ObjectRef).properties ?? {}) as Record<string, Json>;
  return {
    LoginRequest: fromZod(LoginBody),
    AttendanceEventRequest: fromZod(EventBody),
    LeaveRequestInput: fromZod(LeaveInput),
    OtRequestInput: fromZod(OtInput),
    AdjustmentRequestInput: fromZod(AdjustmentInput),
    ApprovalDecisionRequest: fromZod(DecisionBody),
    TaskActionRequest: fromZod(TaskActionBody),
    CommentCreateRequest: {
      type: "object",
      required: ["object_type", "object_id", "body"],
      properties: { ...refProps, body: { type: "string", maxLength: 4000 } },
    },
    FileUploadRequest: {
      type: "object",
      required: ["object_type", "object_id", "file"],
      properties: {
        ...refProps,
        document_id: { ...uuid, description: "Có → thêm phiên bản mới cho tài liệu này." },
        title: { type: "string" },
        file: { type: "string", contentMediaType: "application/octet-stream", description: "Tối đa 20 MB." },
      },
    },
    SyncBatchRequest: fromZod(Batch),
    PrivacyRequestCreate: fromZod(CreateRequestInput),
    PrivacyRequestActionRequest: fromZod(ActionBody),
    InquiryRequest: fromZod(InquiryInput),
    RumRequest: fromZod(RumInput),
    ApplicationRequest: fromZod(ApplicationInput),
  };
}

// ---- registry ----------------------------------------------------------------------------------------------------------

const created = (schema: string, what: string): Record<number, Resp> => ({
  201: {
    description: `${what} (lần đầu).`,
    schema,
    headers: { "Idempotent-Replayed": REPLAY_HEADER },
  },
});
const REPLAY_HEADER = {
  description:
    "`true` khi phản hồi là bản phát lại của cùng Idempotency-Key + cùng nội dung (không ghi lần hai).",
  schema: { type: "string", enum: ["true"] },
};
/** Phản hồi 2xx của POST có guard: phát lại trả đúng status đã lưu kèm header Idempotent-Replayed. */
const idemOk = (status: number, schema: string, what: string): Record<number, Resp> => ({
  [status]: {
    description: `${what} (cũng là mã của bản phát lại).`,
    schema,
    headers: { "Idempotent-Replayed": REPLAY_HEADER },
  },
});

export const REGISTRY: Registry = {
  "/api/app/adjustments": {
    POST: {
      source: "lib/attendance/request-routes.ts#postAdjustment",
      operationId: "createAdjustment",
      tag: "Chấm công",
      summary: "Gửi yêu cầu sửa công (thêm/huỷ sự kiện)",
      permission: "Nhân viên gửi cho chính mình (`self`); tài khoản phải gắn hồ sơ nhân viên.",
      idempotency: "guard",
      body: { kind: "json", schema: "AdjustmentRequestInput" },
      ok: created("IdResult", "Đã tạo yêu cầu sửa công"),
      errors: [403, 404, 409, 422],
    },
  },
  "/api/app/applications": {
    GET: {
      source: "lib/inquiry/routes.ts#listApplications",
      operationId: "listApplications",
      tag: "Tuyển dụng",
      summary: "Danh sách hồ sơ ứng tuyển",
      permission: "`application.read` (HR) trong phạm vi công ty.",
      idempotency: "none",
      paged: true,
      ok: { 200: { description: "Một trang hồ sơ, mới nhất trước.", schema: "ApplicationPage" } },
      errors: [403],
    },
  },
  "/api/app/approvals": {
    GET: {
      source: "lib/attendance/request-routes.ts#getApprovals",
      operationId: "listApprovals",
      tag: "Phê duyệt",
      summary: "Hàng chờ duyệt trong phạm vi của người gọi",
      permission: "Người duyệt trong phạm vi (lọc quyền sau SQL, trần 500 ứng viên).",
      idempotency: "none",
      paged: true,
      ok: { 200: { description: "Một trang đơn chờ duyệt.", schema: "ApprovalPage" } },
    },
  },
  "/api/app/approvals/{type}/{id}/{decision}": {
    POST: {
      source: "lib/attendance/request-routes.ts#postDecision",
      operationId: "decideApproval",
      tag: "Phê duyệt",
      summary: "Duyệt hoặc từ chối một đơn",
      permission: "Người duyệt trong phạm vi và khác người tạo (`SELF_APPROVAL` → 409).",
      idempotency: "guard",
      params: [
        {
          name: "type",
          in: "path",
          required: true,
          schema: { type: "string", enum: ["leave", "ot", "adjustment"] },
          description: "Loại đơn.",
        },
        idParam("Id đơn."),
        {
          name: "decision",
          in: "path",
          required: true,
          schema: { type: "string", enum: ["approve", "reject"] },
          description: "Quyết định.",
        },
      ],
      body: { kind: "json", schema: "ApprovalDecisionRequest" },
      ok: idemOk(200, "OkResult", "Đã ghi quyết định"),
      errors: [403, 404, 409, 422],
    },
  },
  "/api/app/attendance/events": {
    POST: {
      source: "lib/attendance/routes.ts#postEvent",
      operationId: "recordAttendanceEvent",
      tag: "Chấm công",
      summary: "Ghi một sự kiện chấm công",
      description:
        "Idempotent theo bản ghi: `Idempotency-Key` (8–100 ký tự ASCII in được, không khoảng trắng — cùng luật với guard chung) là khoá UNIQUE trong DB, nên cùng khoá trả 200 với bản ghi cũ thay vì 201 (không có header `Idempotent-Replayed`; khoá khác nội dung → 409 `IDEMPOTENCY_CONFLICT`). Đây không phải lớp guard chung của `/api/app/*`. Toạ độ `geo` chỉ được lưu (mã hoá) khi cờ `GEO_CAPTURE_ENABLED` bật VÀ nhân viên có đồng ý riêng `geo_attendance` còn hiệu lực; ngược lại server bỏ toạ độ, không báo lỗi, và trả `geo_stored: false`.",
      permission: "`attendance.write_own`: chính chủ, còn làm việc.",
      idempotency: "handler",
      rateLimited: true,
      body: { kind: "json", schema: "AttendanceEventRequest" },
      ok: {
        200: { description: "Khoá đã dùng với cùng nội dung: trả bản ghi cũ.", schema: "EventResult" },
        201: { description: "Đã ghi sự kiện mới.", schema: "EventResult" },
      },
      errors: [403, 404, 409, 422],
    },
  },
  "/api/app/attendance/qr/{worksiteId}": {
    GET: {
      source: "lib/attendance/routes.ts#getQr",
      operationId: "getAttendanceQr",
      tag: "Chấm công",
      summary: "Cấp mã QR chấm công ngắn hạn cho địa điểm",
      permission: "`attendance.qr_display` tại chi nhánh của địa điểm.",
      idempotency: "none",
      params: [
        {
          name: "worksiteId",
          in: "path",
          required: true,
          schema: uuid,
          description: "Id địa điểm làm việc.",
        },
      ],
      ok: { 200: { description: "Mã QR và hạn dùng.", schema: "QrResult" } },
      errors: [403, 404],
    },
  },
  "/api/app/auth/login": {
    POST: {
      source: "lib/identity/routes.ts#loginHandler",
      operationId: "login",
      tag: "Xác thực",
      summary: "Đăng nhập, đặt cookie phiên",
      description:
        "Chống login CSRF: `Origin` phải khớp APP_ORIGIN (hoặc `Sec-Fetch-Site: same-origin`). Thành công đặt cookie phiên HttpOnly và trả `csrf_token` cho header `x-csrf-token`.",
      auth: "public",
      idempotency: "none",
      body: { kind: "json", schema: "LoginRequest" },
      ok: {
        200: {
          description: "Đã đăng nhập.",
          schema: "LoginResult",
          headers: {
            "Set-Cookie": {
              description: "Cookie phiên (HttpOnly, SameSite=Lax).",
              schema: { type: "string" },
            },
          },
        },
      },
      errors: [401, 403, 429],
    },
  },
  "/api/app/auth/logout": {
    POST: {
      source: "lib/identity/routes.ts#logoutHandler",
      operationId: "logout",
      tag: "Xác thực",
      summary: "Đăng xuất, huỷ phiên",
      permission: "Phiên hợp lệ.",
      idempotency: "none",
      ok: {
        200: {
          description: "Đã huỷ phiên; xoá cookie và dữ liệu cache của PWA.",
          schema: "OkResult",
          headers: {
            "Set-Cookie": { description: "Cookie phiên hết hạn.", schema: { type: "string" } },
            "Clear-Site-Data": { description: '"cache", "storage".', schema: { type: "string" } },
          },
        },
      },
    },
  },
  "/api/app/comments": {
    GET: {
      source: "lib/files/routes.ts#getComments",
      operationId: "listComments",
      tag: "Tệp và bình luận",
      summary: "Bình luận của một đối tượng",
      permission: "Ai đọc được đối tượng thì đọc được bình luận.",
      idempotency: "none",
      paged: true,
      params: [
        {
          name: "object_type",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["task", "project"] },
          description: "Loại đối tượng.",
        },
        { name: "object_id", in: "query", required: true, schema: uuid, description: "Id đối tượng." },
      ],
      ok: { 200: { description: "Một trang bình luận, cũ trước.", schema: "CommentPage" } },
      errors: [400, 403, 404],
    },
    POST: {
      source: "lib/files/routes.ts#postComment",
      operationId: "createComment",
      tag: "Tệp và bình luận",
      summary: "Thêm bình luận",
      permission: "Ai đọc được đối tượng thì bình luận được.",
      idempotency: "guard",
      rateLimited: true,
      body: { kind: "json", schema: "CommentCreateRequest" },
      ok: created("IdResult", "Đã tạo bình luận"),
      errors: [404, 422],
    },
  },
  "/api/app/files": {
    POST: {
      source: "lib/files/routes.ts#postFile",
      operationId: "uploadFile",
      tag: "Tệp và bình luận",
      summary: "Tải tệp lên (multipart)",
      description: "Tối đa 20 MB; kiểm kiểu thật theo nội dung, không tin tên tệp.",
      permission: "Quyền ghi trên đối tượng chứa.",
      idempotency: "guard",
      rateLimited: true,
      body: { kind: "multipart", schema: "FileUploadRequest" },
      ok: created("FileUploadResult", "Đã lưu tệp"),
      errors: [403, 404, 413, 422],
    },
  },
  "/api/app/files/{id}": {
    GET: {
      source: "lib/files/routes.ts#getFile",
      operationId: "downloadFile",
      tag: "Tệp và bình luận",
      summary: "Tải tệp về",
      description: "Luôn `Content-Disposition: attachment`, `nosniff`, không cache.",
      permission: "Quyền đọc đối tượng chứa tệp.",
      idempotency: "none",
      params: [idParam("Id tệp.")],
      ok: {
        200: {
          description: "Nội dung tệp.",
          raw: {
            type: "application/octet-stream",
            schema: { type: "string", contentMediaType: "application/octet-stream" },
          },
          headers: {
            "Content-Disposition": {
              description: "attachment; filename*=UTF-8''…",
              schema: { type: "string" },
            },
            ETag: { description: "sha256 của nội dung.", schema: { type: "string" } },
          },
        },
      },
      errors: [403, 404],
    },
  },
  "/api/app/inquiries": {
    GET: {
      source: "lib/inquiry/routes.ts#listInquiries",
      operationId: "listInquiries",
      tag: "Liên hệ",
      summary: "Danh sách yêu cầu liên hệ",
      permission: "`inquiry.manage` (kinh doanh) trong phạm vi công ty.",
      idempotency: "none",
      paged: true,
      ok: { 200: { description: "Một trang yêu cầu, mới nhất trước.", schema: "InquiryPage" } },
      errors: [403],
    },
  },
  "/api/app/leave-requests": {
    POST: {
      source: "lib/attendance/request-routes.ts#postLeave",
      operationId: "createLeaveRequest",
      tag: "Chấm công",
      summary: "Gửi đơn nghỉ",
      permission: "Nhân viên gửi cho chính mình (`self`).",
      idempotency: "guard",
      body: { kind: "json", schema: "LeaveRequestInput" },
      ok: created("IdResult", "Đã tạo đơn nghỉ"),
      errors: [403, 404, 409, 422],
    },
  },
  "/api/app/me": {
    GET: {
      source: "lib/identity/routes.ts#meHandler",
      operationId: "getMe",
      tag: "Xác thực",
      summary: "Thông tin phiên hiện tại",
      permission: "Phiên hợp lệ.",
      idempotency: "none",
      ok: { 200: { description: "Người dùng, vai trò, token CSRF.", schema: "MeResult" } },
    },
  },
  "/api/app/ot-requests": {
    POST: {
      source: "lib/attendance/request-routes.ts#postOt",
      operationId: "createOtRequest",
      tag: "Chấm công",
      summary: "Gửi đề nghị làm thêm giờ",
      permission: "Nhân viên gửi cho chính mình (`self`).",
      idempotency: "guard",
      body: { kind: "json", schema: "OtRequestInput" },
      ok: created("IdResult", "Đã tạo đề nghị làm thêm giờ"),
      errors: [403, 404, 409, 422],
    },
  },
  "/api/app/privacy/requests": {
    GET: {
      source: "lib/privacy/routes.ts#getRequests",
      operationId: "listPrivacyRequests",
      tag: "Quyền riêng tư",
      summary: "Danh sách yêu cầu của chủ thể dữ liệu (DSAR)",
      permission: "`privacy.manage` (HR).",
      idempotency: "none",
      paged: true,
      params: [
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: [...STATUSES] },
          description: "Lọc theo trạng thái.",
        },
        {
          name: "overdue",
          in: "query",
          schema: { type: "string", enum: ["1"] },
          description: "`1` = chỉ yêu cầu quá hạn thực hiện hoặc quá hạn phản hồi.",
        },
      ],
      ok: { 200: { description: "Một trang yêu cầu.", schema: "PrivacyRequestPage" } },
      errors: [400, 403],
    },
    POST: {
      source: "lib/privacy/routes.ts#postRequest",
      operationId: "createPrivacyRequest",
      tag: "Quyền riêng tư",
      summary: "Ghi nhận một yêu cầu của chủ thể dữ liệu",
      permission: "`privacy.manage` (HR).",
      idempotency: "guard",
      body: { kind: "json", schema: "PrivacyRequestCreate" },
      ok: created("PrivacyRequestResult", "Đã ghi nhận yêu cầu"),
      errors: [403, 404, 409, 422],
    },
  },
  "/api/app/privacy/requests/{id}/{action}": {
    GET: {
      source: "lib/privacy/routes.ts#getRequestExport",
      operationId: "exportPrivacyRequest",
      tag: "Quyền riêng tư",
      summary: "Xuất dữ liệu của chủ thể cho yêu cầu truy cập, chỉnh sửa hoặc cung cấp",
      description: "Là GET để không lưu phản hồi chứa PII vào bảng idempotency.",
      permission: "`privacy.manage` (HR).",
      idempotency: "none",
      params: [
        idParam("Id yêu cầu."),
        {
          name: "action",
          in: "path",
          required: true,
          schema: { type: "string", enum: ["export"] },
          description: "Luôn là `export`.",
        },
      ],
      ok: { 200: { description: "Dữ liệu của chủ thể.", schema: "PrivacyExport" } },
      errors: [403, 404, 409],
    },
    POST: {
      source: "lib/privacy/routes.ts#postRequestAction",
      operationId: "actOnPrivacyRequest",
      tag: "Quyền riêng tư",
      summary: "Bắt đầu, ghi nhận phản hồi, gia hạn, hoàn tất hoặc từ chối một yêu cầu",
      permission:
        "`privacy.manage` (HR). Từ chối và gia hạn bắt buộc có lý do (422); gia hạn tối đa một lần và chỉ khi chưa quá hạn (409).",
      idempotency: "guard",
      params: [
        idParam("Id yêu cầu."),
        {
          name: "action",
          in: "path",
          required: true,
          schema: { type: "string", enum: [...PRIVACY_ACTIONS] },
          description: "Hành động.",
        },
      ],
      body: { kind: "json", schema: "PrivacyRequestActionRequest" },
      ok: idemOk(200, "PrivacyRequestResult", "Đã chuyển trạng thái"),
      errors: [403, 404, 409, 422],
    },
  },
  "/api/app/sync": {
    POST: {
      source: "lib/offline/sync-route.ts#postSync",
      operationId: "syncOfflineQueue",
      tag: "Ngoại tuyến",
      summary: "Đồng bộ lô hàng chờ ngoại tuyến",
      description:
        "Không dùng header `Idempotency-Key`: mỗi bản ghi idempotent theo `id` bản ghi hàng chờ (= khoá chấm công). Mỗi bản ghi xử lý độc lập; kết quả từng bản ghi nằm trong `results` (HTTP 200 kể cả khi một bản ghi lỗi).",
      permission: "Như chấm công trực tuyến (`attendance.write_own`).",
      idempotency: "none",
      rateLimited: true,
      body: { kind: "json", schema: "SyncBatchRequest" },
      ok: { 200: { description: "Kết quả từng bản ghi.", schema: "SyncResult" } },
    },
  },
  "/api/app/tasks": {
    GET: {
      source: "lib/work/routes.ts#getTasks",
      operationId: "listMyTasks",
      tag: "Công việc",
      summary: "Việc của tôi",
      permission: "Phiên hợp lệ; chỉ việc do người gọi phụ trách hoặc đang chờ họ nghiệm thu.",
      idempotency: "none",
      paged: true,
      ok: { 200: { description: "Một trang việc.", schema: "TaskPage" } },
    },
  },
  "/api/app/tasks/{id}/{action}": {
    POST: {
      source: "lib/work/routes.ts#postTaskAction",
      operationId: "transitionTask",
      tag: "Công việc",
      summary: "Chuyển trạng thái công việc",
      description: "Khoá lạc quan: `version` phải bằng phiên bản hiện tại, lệch → 409 `VERSION_CONFLICT`.",
      permission: "Theo SPEC-work (người phụ trách / người nghiệm thu / quản lý dự án).",
      idempotency: "guard",
      params: [
        idParam("Id công việc."),
        {
          name: "action",
          in: "path",
          required: true,
          schema: { type: "string", enum: [...TASK_ACTIONS] },
          description: "Hành động chuyển trạng thái.",
        },
      ],
      body: { kind: "json", schema: "TaskActionRequest" },
      ok: idemOk(200, "TaskTransitionResult", "Đã chuyển trạng thái"),
      errors: [403, 404, 409, 422],
    },
  },
  "/api/healthz": {
    GET: {
      source: "lib/nen/health.ts#healthzHandler",
      operationId: "getLiveness",
      tag: "Vận hành",
      summary: "Liveness — không chạm phụ thuộc",
      auth: "public",
      idempotency: "none",
      ok: { 200: { description: "Tiến trình còn sống.", schema: "HealthResult" } },
    },
  },
  "/api/metrics": {
    GET: {
      source: "lib/http/metrics-route.ts#metricsHandler",
      operationId: "getMetrics",
      tag: "Vận hành",
      summary: "Metric Prometheus (nội bộ)",
      description:
        "Chỉ truy cập nội bộ bằng `Authorization: Bearer METRICS_TOKEN`; chưa đặt token → 404 như không tồn tại.",
      auth: "metrics",
      idempotency: "none",
      ok: {
        200: {
          description: "Exposition format Prometheus text 0.0.4.",
          raw: { type: "text/plain", schema: { type: "string" } },
        },
      },
    },
  },
  "/api/public/applications": {
    POST: {
      source: "lib/inquiry/routes.ts#postApplication",
      operationId: "submitApplication",
      tag: "Công khai",
      summary: "Nộp hồ sơ ứng tuyển",
      description: "Idempotent theo `submission_id`: gửi lại trả 200 với cùng mã hồ sơ.",
      auth: "public",
      idempotency: "none",
      body: { kind: "json", schema: "ApplicationRequest" },
      ok: {
        200: {
          description: "Đã có hồ sơ cùng `submission_id` (hoặc bị bẫy honeypot).",
          schema: "CodeResult",
        },
        201: { description: "Đã tạo hồ sơ.", schema: "CodeResult" },
      },
      errors: [404, 413, 429],
    },
  },
  "/api/public/inquiries": {
    POST: {
      source: "lib/inquiry/routes.ts#postInquiry",
      operationId: "submitInquiry",
      tag: "Công khai",
      summary: "Gửi yêu cầu liên hệ",
      description: "Idempotent theo `submission_id`: gửi lại trả 200 với cùng mã yêu cầu.",
      auth: "public",
      idempotency: "none",
      body: { kind: "json", schema: "InquiryRequest" },
      ok: {
        200: {
          description: "Đã có yêu cầu cùng `submission_id` (hoặc bị bẫy honeypot).",
          schema: "CodeResult",
        },
        201: { description: "Đã tạo yêu cầu.", schema: "CodeResult" },
      },
      errors: [413, 429],
    },
  },
  "/api/public/rum": {
    POST: {
      source: "lib/rum/routes.ts#postRum",
      operationId: "submitRumBeacon",
      tag: "Công khai",
      summary: "Gửi số đo web-vitals (RUM)",
      description:
        "Beacon của trình duyệt (`navigator.sendBeacon`), chỉ khi cờ `RUM_ENABLED` bật — tắt thì 404. Phải cùng nguồn (`Origin`). " +
        "Tối đa 2 KiB; `page` được chuẩn hoá thành nhãn có số giá trị bị chặn trước khi lưu; không lưu IP/user agent.",
      auth: "public",
      idempotency: "none",
      body: { kind: "json", schema: "RumRequest" },
      ok: { 204: { description: "Đã ghi số đo (không có thân)." } },
      errors: [403, 404, 429],
    },
  },
  "/api/readyz": {
    GET: {
      source: "lib/nen/health.ts#readyzHandler",
      operationId: "getReadiness",
      tag: "Vận hành",
      summary: "Readiness — kiểm DB",
      auth: "public",
      idempotency: "none",
      ok: {
        200: { description: "Sẵn sàng nhận request.", schema: "HealthResult" },
        503: { description: "Chưa sẵn sàng (DB không phản hồi hoặc đang tắt).", schema: "HealthResult" },
      },
    },
  },
};

/** Mặc định `auth` của mục registry khi không khai: route nội bộ cần phiên. */
const authOf = (op: Op): Auth => op.auth ?? "session";

// ---- dựng tài liệu -----------------------------------------------------------------------------------------------------

const PROBLEM_RESPONSES: Record<number, string> = {
  400: "Yêu cầu sai: JSON/biểu mẫu hỏng, tham số không hợp lệ (`VALIDATION`, kèm `fields`), thiếu hoặc sai `Idempotency-Key` (`IDEMPOTENCY_KEY_REQUIRED`).",
  401: "Chưa đăng nhập hoặc phiên hết hạn (`UNAUTHENTICATED`); đăng nhập sai (`INVALID_CREDENTIALS`).",
  403: "Không có quyền (`FORBIDDEN`), thiếu/sai token CSRF hoặc sai nguồn (`CSRF`).",
  404: "Không thấy đối tượng (cả khi không có quyền đọc).",
  409: "Xung đột: `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS` (kèm `Retry-After`), `SELF_APPROVAL`, trạng thái không cho phép.",
  413: "Dữ liệu gửi lên quá lớn (`PAYLOAD_TOO_LARGE`).",
  422: "Vi phạm nghiệp vụ, hoặc `Idempotency-Key` đã dùng cho nội dung khác (`IDEMPOTENCY_KEY_REUSED`).",
  429: "Vượt giới hạn tần suất (`RATE_LIMITED`), kèm `Retry-After` (giây).",
  500: "Lỗi hệ thống chưa lường (`INTERNAL`); không lộ chi tiết nội bộ.",
  503: "Backend xác thực/phân quyền tạm thời không dùng được (`AUTH_UNAVAILABLE`, fail-closed).",
};

const errorStatuses = (op: Op): number[] => {
  const s = new Set<number>([500, ...(op.errors ?? [])]);
  const auth = authOf(op);
  const write = op.body !== undefined || op.idempotency !== "none" || !!op.rateLimited;
  if (auth === "session") {
    s.add(401);
    s.add(503);
    if (write || op.source.includes("logout")) s.add(403); // CSRF
  }
  if (op.body?.kind === "json" || op.body?.kind === "multipart") s.add(400);
  if (op.body) s.add(413);
  if (op.paged) s.add(400);
  if (op.idempotency === "guard") [400, 409, 422].forEach((c) => s.add(c));
  if (op.idempotency === "handler") [400, 409].forEach((c) => s.add(c));
  if (op.rateLimited) s.add(429);
  if (auth === "metrics") return [];
  return [...s].sort((a, b) => a - b);
};

function buildOperation(op: Op): Json {
  const auth = authOf(op);
  const parameters: Json[] = [];
  for (const p of op.params ?? []) {
    parameters.push({
      name: p.name,
      in: p.in,
      required: p.in === "path" ? true : (p.required ?? false),
      description: p.description,
      schema: p.schema,
    });
  }
  if (op.paged) for (const n of pageParams) parameters.push({ $ref: `#/components/parameters/${n}` });
  if (op.idempotency === "guard") parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
  if (op.idempotency === "handler") parameters.push({ $ref: "#/components/parameters/IdempotencyKeyEvent" });

  const responses: Record<string, Json> = {};
  for (const [code, r] of Object.entries(op.ok)) {
    const res: Json = { description: r.description };
    if (r.headers) {
      res.headers = Object.fromEntries(
        Object.entries(r.headers).map(([k, h]) => [k, { description: h.description, schema: h.schema }]),
      );
    }
    if (r.schema)
      res.content = { "application/json": { schema: { $ref: `#/components/schemas/${r.schema}` } } };
    else if (r.raw) res.content = { [r.raw.type]: { schema: r.raw.schema } };
    responses[code] = res;
  }
  for (const code of errorStatuses(op)) {
    if (responses[String(code)]) continue;
    responses[String(code)] = { $ref: `#/components/responses/Problem${code}` };
  }
  if (auth === "metrics") {
    responses["401"] = {
      description: "Thiếu hoặc sai bearer token.",
      headers: { "WWW-Authenticate": { description: "Bearer", schema: { type: "string" } } },
      content: { "text/plain": { schema: { type: "string" } } },
    };
    responses["404"] = {
      description: "Chưa đặt METRICS_TOKEN (hoặc token cấu hình sai): coi như không tồn tại.",
      content: { "text/plain": { schema: { type: "string" } } },
    };
  }

  const out: Json = {
    operationId: op.operationId,
    tags: [op.tag],
    summary: op.summary,
    description: [op.description, op.permission ? `Quyền: ${op.permission}` : undefined]
      .filter(Boolean)
      .join("\n\n"),
  };
  if (out.description === "") delete out.description;
  if (op.permission) out["x-permission"] = op.permission;
  if (parameters.length > 0) out.parameters = parameters;
  if (op.body) {
    out.requestBody = {
      required: true,
      content: {
        [op.body.kind === "json" ? "application/json" : "multipart/form-data"]: {
          schema: { $ref: `#/components/schemas/${op.body.schema}` },
        },
      },
    };
  }
  out.responses = responses;
  if (auth === "public") out.security = [];
  else if (auth === "metrics") out.security = [{ metricsBearer: [] }];
  else
    out.security = [
      op.body || op.idempotency !== "none" || op.source.includes("logout")
        ? { cookieAuth: [], csrfToken: [] }
        : { cookieAuth: [] },
    ];
  if (op.breakingApproved) out["x-breaking-approved"] = op.breakingApproved;
  return out;
}

export function buildOpenApi(): Json {
  const paths: Record<string, Json> = {};
  for (const p of Object.keys(REGISTRY).sort()) {
    const item: Json = {};
    const entry = REGISTRY[p]!;
    for (const m of ["GET", "POST"] as const) {
      const op = entry[m];
      if (op) item[m.toLowerCase()] = buildOperation(op);
    }
    paths[p] = item;
  }
  const problemResponses: Record<string, Json> = {};
  for (const [code, description] of Object.entries(PROBLEM_RESPONSES)) {
    const res: Json = {
      description,
      content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
    };
    if (code === "429" || code === "409")
      res.headers = {
        "Retry-After": {
          description: "Số giây nên chờ trước khi thử lại.",
          schema: { type: "integer", minimum: 1 },
        },
      };
    problemResponses[`Problem${code}`] = res;
  }
  const tags = [
    ...new Set(Object.values(REGISTRY).flatMap((e) => Object.values(e).map((o) => o!.tag))),
  ].sort();
  return {
    openapi: "3.1.0",
    info: {
      title: "X-Company API",
      version: "1.0.0",
      description:
        "Hợp đồng HTTP của X-Company, SINH từ mã bằng `npm run -s gen:openapi` (không sửa tay). Là nguồn sự thật cho endpoint, kiểu dữ liệu và mã lỗi; docs/design/API-CONTRACT.md chỉ bổ sung văn xuôi. JSON UTF-8, thời điểm ISO 8601 UTC, id UUID.",
    },
    servers: [{ url: "/", description: "Cùng nguồn gốc với ứng dụng web." }],
    tags: tags.map((name) => ({ name })),
    ...(Object.keys(REMOVAL_APPROVALS).length > 0
      ? { "x-breaking-approved-removals": REMOVAL_APPROVALS }
      : {}),
    paths,
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "xc_session",
          description: "Cookie phiên HttpOnly; trên HTTPS tên là `__Host-xc_session`.",
        },
        csrfToken: {
          type: "apiKey",
          in: "header",
          name: "x-csrf-token",
          description:
            "Bắt buộc với request ghi nội bộ; lấy từ `csrf_token` của login hoặc GET /api/app/me. Request ghi còn phải cùng nguồn (Origin).",
        },
        metricsBearer: { type: "http", scheme: "bearer", description: "METRICS_TOKEN." },
      },
      parameters: {
        Limit: {
          name: "limit",
          in: "query",
          required: false,
          description: `Số dòng tối đa mỗi trang (mặc định ${PAGE_DEFAULT_LIMIT}, tối đa ${PAGE_MAX_LIMIT}); ngoài khoảng → 400.`,
          schema: { type: "integer", minimum: 1, maximum: PAGE_MAX_LIMIT, default: PAGE_DEFAULT_LIMIT },
        },
        Offset: {
          name: "offset",
          in: "query",
          required: false,
          description: `Vị trí bắt đầu (mặc định 0, tối đa ${PAGE_MAX_OFFSET}); ngoài khoảng → 400.`,
          schema: { type: "integer", minimum: 0, maximum: PAGE_MAX_OFFSET, default: 0 },
        },
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          description:
            "Bắt buộc (BE-API-008). 8–255 ký tự in được, nên là UUID v4 mới cho mỗi thao tác. Thiếu/sai → 400; cùng khoá + cùng nội dung → phát lại phản hồi cũ (header `Idempotent-Replayed: true`); cùng khoá + nội dung khác → 422; đang xử lý → 409 (`Retry-After: 1`). Lưu ≥ 24 giờ, phạm vi (công ty, người dùng, khoá).",
          schema: { type: "string", minLength: 8, maxLength: 255, pattern: "^[\\x21-\\x7e]{8,255}$" },
        },
        IdempotencyKeyEvent: {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          description:
            "Bắt buộc, 8–100 ký tự. Khoá UNIQUE của sự kiện chấm công trong DB: cùng khoá + cùng nội dung → 200 bản ghi cũ; khác nội dung → 409 `IDEMPOTENCY_CONFLICT`.",
          schema: { type: "string", minLength: 8, maxLength: 100 },
        },
      },
      responses: problemResponses,
      schemas: { ...SCHEMAS, ...requestSchemas() },
    },
  };
}

/** Sắp khoá đối tượng đệ quy theo thứ tự chèn của dựng (đã tất định) — không cần; chỉ định dạng bằng prettier như `format:check`. */
export async function renderOpenApi(doc: Json = buildOpenApi()): Promise<string> {
  const file = path.join(root, OPENAPI_FILE);
  const cfg = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(JSON.stringify(doc), { ...cfg, parser: "json", filepath: file });
}

export function readCommitted(rootDir: string = root): string | null {
  try {
    return readFileSync(path.join(rootDir, OPENAPI_FILE), "utf8");
  } catch {
    return null;
  }
}

if (process.argv[1] === import.meta.filename) {
  const text = await renderOpenApi();
  mkdirSync(path.join(root, "docs/api"), { recursive: true });
  writeFileSync(path.join(root, OPENAPI_FILE), text);
  console.log(`gen-openapi: đã ghi ${OPENAPI_FILE} (${Object.keys(REGISTRY).length} đường dẫn)`);
}
