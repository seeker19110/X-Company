# Quyền tối thiểu (BASE-SEC-006)

> Tài liệu quyền của tiến trình, CSDL, khoá và token CI. Phần bảng GitHub Actions **sinh từ workflow thật** và
> `npm run -s check:ci-policy` đỏ khi lệch (nới quyền phải hiện trong PR). Phần máy chủ là **yêu cầu khi dựng hạ tầng** —
> chưa có production (RUNBOOK `status: nháp`); chủ dự án xác nhận trên máy thật (việc người, ghi ngày ở cuối).

## Tiến trình trên máy chủ (tự host, PM2 — ADR-0001)

- Ứng dụng và worker chạy bằng user hệ điều hành riêng, **không root**, không thuộc nhóm `sudo`/`wheel`; PM2 khởi động
  bằng `pm2 startup` cho đúng user đó (unit systemd có `User=`). Script runtime không gọi `sudo`.
- Thư mục ghi được của user ứng dụng chỉ gồm thư mục dữ liệu (`FILE_STORAGE_DIR`, log của PM2); mã nguồn chỉ đọc.
- Cổng nghe mặc định `127.0.0.1` (`npm start` dùng `-H ${HOST:-127.0.0.1}`); chỉ Caddy (user riêng) nghe 80/443.
- Không có container image nên vế "Dockerfile `USER` không root" chưa áp dụng; khi thêm image thì bắt buộc `USER` không root.

## CSDL PostgreSQL

| Role | Dùng cho | Quyền |
| --- | --- | --- |
| owner (qua `MIGRATE_DATABASE_URL`) | chỉ chạy migration (`npm run -s db:migrate`) | sở hữu schema; không dùng trong tiến trình phục vụ |
| `xc_app_rw` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE — migrations/0001_app_role.sql) | role nhóm của ứng dụng | SELECT/INSERT/UPDATE/DELETE bảng, dùng sequence, EXECUTE hàm; không tạo bảng, không bỏ qua RLS |
| login của ứng dụng (qua `DATABASE_URL`) | ứng dụng + worker | chỉ là thành viên `xc_app_rw` (test dựng y như vậy: tests/helpers/db.ts) |

## Khoá và token ngoài CI

- KMS (OpenBao/Vault transit): token của ứng dụng chỉ có `encrypt`/`decrypt` trên đúng một khoá transit; xoay khoá bằng
  token quản trị riêng (docs/ops/kms-deploy.md).
- Sao lưu off-site (restic): khoá ghi của máy chủ không có quyền xoá ở đích (OPS-DR-007); quyền xoá/prune do vai trò riêng.
- Webhook cảnh báo (`ALERT_WEBHOOK_URL`): URL chứa khoá, chỉ để gửi; lưu như bí mật.

## GitHub Actions — quyền GITHUB_TOKEN theo job

Mức workflow mặc định `contents: read`; job cần ghi tự khai quyền tối thiểu kèm lý do ngay trong workflow.

<!-- workflow-perms:start (sinh bởi node scripts/lib/workflow-perms.mjs --write) -->
| Workflow | Job | Quyền GITHUB_TOKEN | Nguồn |
| --- | --- | --- | --- |
| ci.yml | gate | contents: read | workflow |
| ci.yml | test | contents: read | workflow |
| ci.yml | e2e | contents: read | workflow |
| ci.yml | readme-smoke | contents: read | workflow |
| ci.yml | lighthouse | contents: read | workflow |
| ci.yml | dast | contents: read | workflow |
| ci.yml | drills | contents: read | job |
| ci.yml | quality | contents: read | workflow |
| codeql.yml | codeql | contents: read, security-events: write | job |
| dep-audit.yml | dep-audit | contents: read | workflow |
| maintenance.yml | eol-check | contents: read | workflow |
| maintenance.yml | link-check | contents: read, issues: write | job |
| merge-gate.yml | merge-gate | contents: read | workflow |
| osv-scanner.yml | osv-scanner | contents: read | workflow |
| pr-policy.yml | pr-policy | contents: read | workflow |
| pr-steward.yml | steward | actions: write, checks: read, contents: write, issues: write, pull-requests: write, statuses: read | job |
| release.yml | release-please | contents: write, issues: write, pull-requests: write | job |
| release.yml | release-assets | contents: write | job |
| secret-scan.yml | gitleaks | contents: read | workflow |
<!-- workflow-perms:end -->

## Xác nhận trên máy thật (việc người)

- Người xác nhận: `<chủ dự án điền>` · ngày: `<điền>` · máy: `<điền>` — user không root, `pm2 startup` đúng user, role DB như bảng.
