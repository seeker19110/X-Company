// i18n-ignore-file: lỗi kết nối KMS cho người vận hành (không tới người dùng cuối)
// Phần MẠNG của KMS Transit (T-052), tách khỏi lib/ vì lib/ không được chứa client mạng (DB-TX-003): lib/crypto/kms.ts chỉ biết
// giao diện `TransitTransport`; ở đây hiện thực bằng `fetch` tới API tương thích Vault/OpenBao (`/v1/<mount>/…`, header `X-Vault-Token`).
// TLS: Node `fetch` dùng kho CA hệ thống; CA riêng (OpenBao tự ký/CA nội bộ) khai bằng NODE_EXTRA_CA_CERTS=<tệp PEM> khi chạy tiến
// trình — KHÔNG có tuỳ chọn tắt kiểm chứng chứng chỉ. Không theo chuyển hướng (redirect: "error"). Token chỉ ở header, không vào lỗi/log.
import type { TransitRequest, TransitResponse, TransitTransport } from "../lib/crypto/kms.ts";

/** `addr` = gốc URL của KMS (vd https://127.0.0.1:8200). `fetchFn` tiêm được để test. */
export function fetchTransitTransport(addr: () => string, fetchFn: typeof fetch = fetch): TransitTransport {
  return {
    async request(req: TransitRequest): Promise<TransitResponse> {
      const res = await fetchFn(`${addr()}/v1/${req.path}`, {
        method: req.method,
        headers: {
          "X-Vault-Token": req.token,
          ...(req.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        redirect: "error",
        signal: AbortSignal.timeout(req.timeoutMs),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        // thân rỗng/không phải JSON (vd 204, 503 từ proxy): chỉ cần mã trạng thái
      }
      return { status: res.status, json };
    },
  };
}
