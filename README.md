# X-Company

Website công ty, webapp điều hành nội bộ (tổ chức, chấm công, công việc, nghiệm thu, báo cáo) và PWA cho nhân viên —
dành cho công ty 20–200 nhân viên cần chốt công bằng dữ liệu truy vết và nhìn thấy điểm vướng của công việc.
Trạng thái: **đang xây P0** (chưa có bản phát hành, chưa có người dùng thật). Phạm vi: [PROJECT.md](PROJECT.md).

## Bắt đầu nhanh (clone sạch → test xanh, 3 lệnh)

```bash
git clone https://github.com/seeker19110/X-Company.git && cd X-Company
npm ci
npm test
```

`npm test` tự dựng PostgreSQL tạm bằng `initdb` (xem mục Yêu cầu); không có PostgreSQL thì test **đỏ**, không tự bỏ qua.

## Yêu cầu môi trường

- Node.js `>= 22.12` (production dự kiến Node 24 LTS) và npm — khai báo ở `package.json` (`engines`).
- PostgreSQL 16 hoặc 17 có `initdb`/`pg_ctl` trên máy (hoặc đặt sẵn `DATABASE_URL` trỏ tới một CSDL trống để test) —
  xem [scripts/with-test-db.sh](scripts/with-test-db.sh). Production dự kiến PostgreSQL 17.
- Python 3 chỉ cần cho công cụ khung `.xtemplates/` (cổng `dev-task.sh gate`, kiểm liên kết).

## Cài đặt & chạy

```bash
npm ci               # cài đúng theo package-lock.json
npm run dev          # chạy dev (Next.js) tại http://localhost:3000
npm run build        # build production
npm run start        # chạy bản build
npm run db:migrate   # áp migration (cần MIGRATE_DATABASE_URL — role owner riêng, xem Cấu hình)
```

Các lệnh chuẩn cho người và agent nằm ở [xt.yaml](xt.yaml); [AGENTS.md](AGENTS.md) mục "Lệnh" trích nguyên văn.

## Chạy test và cổng chất lượng

```bash
npm test                              # unit + test DB trên PostgreSQL thật (node:test)
npm run -s coverage                   # test kèm ngưỡng coverage
npm run -s e2e                        # Playwright (khi đã có luồng E2E)
.xtemplates/scripts/dev-task.sh gate  # build · typecheck · lint · test — cổng trước commit
npm run -s check:repo-docs            # tệp dự án (README, LICENSE, SECURITY…) còn đủ và khớp
npm run -s check:docs                 # spec, threat model, rủi ro, data map, dữ liệu test
```

## Cấu hình

Biến môi trường mẫu ở `.env.example` (chỉ tên biến, không giá trị). **Không commit** giá trị thật. Hai loại URL CSDL tách vai trò:
`DATABASE_URL` cho ứng dụng lúc chạy (role không phải owner/superuser) và `MIGRATE_DATABASE_URL` chỉ cho `npm run db:migrate`.
Cách đặt, xoay và xử lý khi lộ bí mật: [docs/ops/RUNBOOK.md](docs/ops/RUNBOOK.md).

## Tài liệu

| Cần gì | Đọc |
|---|---|
| Vấn đề, người dùng, phạm vi MVP, NFR, khung pháp lý | [PROJECT.md](PROJECT.md) · [SCOPE.md](SCOPE.md) |
| Spec từng tính năng (tiêu chí chấp nhận AC-…) | [docs/specs/](docs/specs/) |
| Kiến trúc, hợp đồng API, quyết định | [docs/design/ARCHITECTURE.md](docs/design/ARCHITECTURE.md) · [docs/design/API-CONTRACT.md](docs/design/API-CONTRACT.md) · [docs/adr/](docs/adr/) · [docs/autopilot/DECISIONS.md](docs/autopilot/DECISIONS.md) |
| Bảo mật | [SECURITY.md](SECURITY.md) · [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) |
| Vận hành, sự cố, khôi phục | [docs/ops/RUNBOOK.md](docs/ops/RUNBOOK.md) · [docs/ops/INCIDENT-RESPONSE.md](docs/ops/INCIDENT-RESPONSE.md) · [docs/ops/runbooks/](docs/ops/runbooks/) |
| Rủi ro, phụ thuộc | [docs/RISKS.md](docs/RISKS.md) |
| Bàn giao | [docs/handover/accounts.md](docs/handover/accounts.md) · [docs/handover/renewals.md](docs/handover/renewals.md) · [PROGRESS.md](PROGRESS.md) |
| Quy tắc cho agent | [AGENTS.md](AGENTS.md) |

## Đóng góp & liên hệ

Đọc [CONTRIBUTING.md](CONTRIBUTING.md) (nhánh, Conventional Commits, squash merge, cổng) và
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Câu hỏi: [SUPPORT.md](SUPPORT.md). **Lỗ hổng bảo mật: không mở issue công khai** —
báo riêng theo [SECURITY.md](SECURITY.md). Chủ dự án: [@seeker19110](https://github.com/seeker19110).

## Giấy phép

Độc quyền, bảo lưu mọi quyền (`UNLICENSED` trong `package.json`) — xem [LICENSE](LICENSE). Kho mã công khai không có nghĩa là
được phép dùng lại.
