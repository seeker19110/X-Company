---
title: Nhật ký diễn tập xoay khoá (SEC-SECRET-008)
status: faithful-fixture — diễn tập cục bộ tự động, KHÔNG phải staging/production
---

# Nhật ký xoay khoá

> Sinh bởi `npm run -s kms:drill` (scripts/kms-rotation-drill.ts): OpenBao thật cục bộ, thời lượng đo từ lúc `rotate` tới khi đọc lại xong mọi dữ liệu. Chưa có diễn tập trên staging/hạ tầng thật (việc của chủ dự án).

| Ngày (UTC) | Môi trường | Dữ liệu | Việc đã làm | Thời lượng | Kết quả |
|---|---|---|---|---|---|
| 2026-10-19 | OpenBao 2.7.1 cục bộ (raft+TLS tự ký), Postgres tạm, máy dev | 200 dòng + 5 tệp | khoá chủ → v2; rewrap 200 dòng + 5 tệp; đọc lại 200 dòng, 5 tệp | 0.23 s (< 60 phút) | ĐẠT |
