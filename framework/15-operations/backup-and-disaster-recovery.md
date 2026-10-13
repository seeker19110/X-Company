---
title: Sao lưu & DR: RPO/RTO, diễn tập khôi phục, multi-region
kind: module
prefix: OPS-DR
applies_to: [web-app, api-service, ai-agent, agentic-system, data-ml, monorepo, blockchain, mobile-app, desktop-app, embedded-iot]
updated: 2026-10-13
---

# Sao lưu & DR: RPO/RTO, diễn tập khôi phục, multi-region

> Chính sách sao lưu và khôi phục thảm hoạ ở mức **hệ thống**: RPO/RTO theo quy mô, 3-2-1, PITR, mã hoá, bất biến, và **diễn tập
> khôi phục có bằng chứng** — backup chưa khôi phục thử là chưa có backup. Kỹ thuật backup riêng của CSDL (pg_dump vs base backup,
> WAL, logical vs physical) là nhà của [`../09-database/backup-and-recovery.md`](../09-database/backup-and-recovery.md);
> dựng lại hạ tầng từ code ở [`infrastructure-as-code.md`](infrastructure-as-code.md).

## Nguyên tắc

- **Backup là để khôi phục**: chỉ số duy nhất có nghĩa là "khôi phục được trong RTO với mất mát ≤ RPO", đo bằng diễn tập, không bằng log "backup success".
- **3-2-1**: 3 bản (1 chính + 2 sao lưu), 2 loại phương tiện/hệ thống khác nhau, 1 bản offsite (vùng/tài khoản/nhà cung cấp khác).
- **Tách tài khoản và quyền**: bản sao lưu nằm trong tài khoản/dự án khác với production, quyền xoá tách khỏi quyền ghi; bất biến (Object Lock/WORM) để ransomware hoặc lệnh `rm` sai không xoá được.
- **RPO/RTO là quyết định sản phẩm**, ghi ở PROJECT.md/ADR theo quy mô; chi phí DR tăng phi tuyến khi RPO → 0 nên chọn có chủ.
- **Mọi thứ cần khôi phục đều trong phạm vi**: CSDL, object storage, bí mật/khoá, cấu hình, hàng đợi, bộ nhớ agent, state IaC, chứng chỉ — không chỉ DB.
- **Khôi phục cũng là code**: runbook khôi phục có lệnh cụ thể, chạy được bởi người không phải tác giả, tự động hoá tới mức có thể.

## Quyết định

| Quy mô | RPO mặc định | RTO mặc định | Cơ chế tối thiểu | Diễn tập |
|---|---|---|---|---|
| **S** (thử nghiệm, dữ liệu không thật) | 24 giờ | 1 ngày làm việc | Snapshot/dump hằng ngày, giữ 7 ngày, offsite 1 bản | 1 lần trước khi lên M |
| **M** (production có người dùng) | ≤ 1 giờ (PITR) | ≤ 4 giờ | PITR (WAL/binlog archive) + snapshot ngày + 3-2-1 + bất biến ≥ 30 ngày | Hàng quý, có bằng chứng |
| **L** (lớn, ngành quản lý) | ≤ 5 phút | ≤ 1 giờ (một vùng) / ≤ 4 giờ (mất vùng) | Replica đồng bộ/async đa vùng + PITR + backup đa tài khoản + DR site | Hàng quý + diễn tập mất vùng hàng năm |

| Tình huống | Lựa chọn | Điều kiện |
|---|---|---|
| CSDL managed (RDS/Cloud SQL/Supabase/Neon…) | Bật PITR + snapshot tự động của nhà cung cấp **và** export định kỳ sang tài khoản khác | Snapshot cùng tài khoản không chống được mất tài khoản/xoá nhầm project |
| CSDL tự host PostgreSQL | pgBackRest/Barman (base backup + WAL archive) tới object storage | `wal_level=replica`, `archive_mode=on`, `archive_command` không ghi đè; xem 09 |
| Object storage | Versioning + replication sang bucket khác vùng/tài khoản + Object Lock | Dữ liệu người dùng (upload) thường bị quên |
| SQLite/edge | Litestream/ snapshot định kỳ sang object storage | Ứng dụng desktop/CLI/IoT: hướng dẫn người dùng export + kiểm tra toàn vẹn |
| Multi-region | Chỉ khi L hoặc SLA yêu cầu; active-passive trước active-active | Active-active cần xử lý xung đột dữ liệu — ADR bắt buộc |
| Công cụ file/VM | restic (BSD-2) / Velero (K8s, Apache-2.0) / snapshot cloud | Mã hoá client-side với khoá trong KMS |

## Checklist

- [ ] `OPS-DR-001` **MUST** RPO và RTO được ghi số cụ thể theo quy mô trong `PROJECT.md`/ADR cho từng loại dữ liệu (CSDL, file, bí mật, cấu hình); kiến trúc backup đáp ứng số đó. → Kiểm: bảng RPO/RTO tồn tại; tần suất backup ≤ RPO (so cấu hình với bảng bằng script/review). · Nguồn: NIST SP 800-34r1 (RPO/RTO trong BIA)
- [ ] `OPS-DR-002` **MUST** Backup tự động theo lịch cho **mọi** kho dữ liệu trong phạm vi (CSDL, object storage, queue bền, bộ nhớ agent/vector store, state IaC, bí mật/khoá) — có danh sách phạm vi. → Kiểm: `docs/ops/BACKUP-SCOPE.md` liệt kê kho ↔ cơ chế ↔ lịch ↔ retention; mỗi kho trong IaC có mục tương ứng (script đối chiếu). · Nguồn: NIST SP 800-34r1; CISA 3-2-1
- [ ] `OPS-DR-003` **MUST** Áp 3-2-1: ≥ 2 bản sao lưu, 2 hệ thống khác nhau, ≥ 1 bản ở vùng/tài khoản/nhà cung cấp khác production. → Kiểm: cấu hình replication/export sang bucket ở account id khác (IaC); liệt kê trong BACKUP-SCOPE. · Nguồn: CISA/CERT "Data Backup Options" (3-2-1)
- [ ] `OPS-DR-004` **MUST** Backup mã hoá at-rest và in-transit; khoá mã hoá backup được sao lưu riêng (KMS multi-region/escrow) — mất khoá = mất backup. → Kiểm: cấu hình mã hoá bucket/backup; khoá KMS có bản sao/escrow ghi trong runbook; test giải mã từ tài khoản DR. · Nguồn: NIST SP 800-34r1; [`../12-security/secrets-management.md`](../12-security/secrets-management.md)
- [ ] `OPS-DR-005` **MUST** **Diễn tập khôi phục** toàn bộ (restore vào môi trường sạch, chạy smoke test, đo thời gian và dữ liệu mất) trước khi lên production và theo lịch (M: hàng quý); kết quả lưu làm bằng chứng. → Kiểm: `docs/ops/dr-drills.md` có ngày, người, RTO đo được, RPO đo được, lỗi gặp, hành động; lifecycle G8 "backup đã thử khôi phục". · Nguồn: lifecycle G8; catalog stored 09 §1.3 ([BLOCKER] backup có test restore); SRE Book
- [ ] `OPS-DR-006` **MUST** Giám sát backup: job thất bại hoặc **không chạy** (absent) → alert; kiểm toàn vẹn (checksum/`pg_verifybackup`/restore mẫu tự động) sau mỗi backup. → Kiểm: alert `backup_last_success_age > RPO`; log verify; diễn tập tắt job → alert nổ. · Nguồn: [`slo-and-alerting.md`](slo-and-alerting.md); PostgreSQL docs (continuous archiving)
- [ ] `OPS-DR-007` **MUST** Quyền xoá backup tách khỏi quyền ghi của ứng dụng và admin thường; identity production không xoá được bản offsite. → Kiểm: IAM policy: app/CI chỉ `PutObject`; xoá cần vai trò riêng có MFA; test xoá bằng identity app → bị từ chối. · Nguồn: CIS Benchmark cloud; NIST SP 800-207
- [ ] `OPS-DR-008` **MUST** Runbook khôi phục có lệnh cụ thể cho từng kho (restore DB tới thời điểm T, khôi phục bucket, dựng lại hạ tầng từ IaC, xoay bí mật), kèm thứ tự phụ thuộc và cách xác minh; người không phải tác giả chạy được trong diễn tập. → Kiểm: `docs/ops/runbooks/restore-*.md`; diễn tập do người khác tác giả thực hiện (ghi tên). · Nguồn: NIST SP 800-34r1; [`../templates/RUNBOOK.md`](../templates/RUNBOOK.md)
- [ ] `OPS-DR-009` **MUST@M** PITR cho CSDL production (WAL/binlog archive liên tục) để khôi phục tới thời điểm bất kỳ trong ≥ 7 ngày; diễn tập khôi phục tới thời điểm giữa hai snapshot. → Kiểm: cấu hình PITR bật (managed) hoặc `archive_mode=on` + archive liên tục không gap; drill ghi thời điểm khôi phục. · Nguồn: PostgreSQL docs — Continuous Archiving and PITR
- [ ] `OPS-DR-010` **MUST@M** Backup **bất biến** (Object Lock/WORM hoặc tài khoản chỉ ghi) với thời gian giữ ≥ 30 ngày để chống ransomware/xoá nhầm; retention tổng theo luật/nghiệp vụ. → Kiểm: cấu hình Object Lock (compliance/governance mode) trong IaC; test xoá trước hạn → bị từ chối. · Nguồn: CISA ransomware guidance (chưa fetch lại 2026-10-13); NIST SP 800-34r1
- [ ] `OPS-DR-011` **MUST@M** Khôi phục được **toàn bộ môi trường** (hạ tầng từ IaC + dữ liệu từ backup + bí mật) trên tài khoản/vùng khác trong RTO; diễn tập ≥ 1 lần/năm. → Kiểm: drill "mất tài khoản/vùng" có thời gian đo ≤ RTO. · Nguồn: NIST SP 800-34r1; [`infrastructure-as-code.md`](infrastructure-as-code.md)
- [ ] `OPS-DR-012` **MUST@M** Dữ liệu người dùng tải lên (object storage) có versioning + replication; xoá mềm với thời gian khôi phục (vd 30 ngày) trước khi xoá cứng, trừ yêu cầu xoá theo luật. → Kiểm: bucket versioning + lifecycle; test xoá rồi khôi phục file. · Nguồn: [`../08-backend/files-and-media.md`](../08-backend/files-and-media.md); [`../16-compliance-privacy/consent-and-user-rights.md`](../16-compliance-privacy/consent-and-user-rights.md)
- [ ] `OPS-DR-013` **MUST@L** Multi-region: replica ở vùng thứ hai với RPO ≤ 5 phút, failover có runbook và diễn tập hàng năm; DNS/traffic chuyển được trong RTO; xung đột dữ liệu (nếu active-active) có ADR. → Kiểm: drill failover vùng với thời gian; ADR multi-region. · Nguồn: NIST SP 800-34r1 (alternate site)
- [ ] `OPS-DR-014` **MUST@L** Backup/bản sao chịu ràng buộc lưu trú dữ liệu (data residency) theo luật áp dụng; vùng offsite được chọn có chủ đích và ghi ở 16. → Kiểm: vùng bucket DR trong IaC khớp bảng pháp lý. · Nguồn: [`../16-compliance-privacy/vietnam-data-law.md`](../16-compliance-privacy/vietnam-data-law.md)
- [ ] `OPS-DR-015` **SHOULD** Backup trước mỗi migration/thay đổi schema rủi ro và trước thao tác hàng loạt trên dữ liệu; id snapshot ghi vào PR/ticket. → Kiểm: bước `pre-migration snapshot` trong pipeline deploy; PR có snapshot id. · Nguồn: [`../09-database/migrations.md`](../09-database/migrations.md); P8
- [ ] `OPS-DR-016` **SHOULD** Retention backup theo bảng có lý do (vận hành 30 ngày, tháng 12 tháng, năm theo luật) và tự động xoá sau hạn; không giữ mãi mãi. → Kiểm: lifecycle policy trong IaC khớp bảng; chi phí storage backup theo dõi. · Nguồn: [`cost-management.md`](cost-management.md); tối thiểu hoá dữ liệu (16)
- [ ] `OPS-DR-017` **SHOULD** Khôi phục mẫu tự động hàng tuần: restore backup mới nhất vào môi trường tạm, chạy truy vấn kiểm tra, huỷ môi trường; thất bại → alert. → Kiểm: job lịch tuần với log; alert khi fail. · Nguồn: SRE Book (kiểm backup liên tục)
- [ ] `OPS-DR-018` **SHOULD** Ứng dụng desktop/mobile/CLI/IoT lưu dữ liệu cục bộ: có export/import hoặc đồng bộ, kiểm toàn vẹn file, hướng dẫn người dùng sao lưu; cập nhật firmware/app không mất dữ liệu (test). → Kiểm: test nâng cấp giữ dữ liệu; tính năng export. · Nguồn: P11; hồ sơ desktop/mobile/embedded
- [ ] `OPS-DR-019` **SHOULD** Bộ nhớ/trạng thái của agent (memory store, vector index, outbox) nằm trong phạm vi backup và khôi phục nhất quán với CSDL chính (cùng thời điểm hoặc có thể dựng lại từ nguồn). → Kiểm: BACKUP-SCOPE có mục agent state; drill khôi phục kiểm nhất quán. · Nguồn: [`../13-ai-engineering/rag-and-knowledge.md`](../13-ai-engineering/rag-and-knowledge.md)
- [ ] `OPS-DR-020` **MAY** Chaos "xoá nhầm" trên staging (xoá bảng/bucket) để đo thời gian khôi phục thật và kiểm quyền xoá. → Kiểm: biên bản game day. · Nguồn: SRE Book
- [ ] `OPS-DR-021` **MAY** Backup bản sao lạnh ngoài cloud chính (nhà cung cấp khác/offline) cho dữ liệu sống còn. → Kiểm: lịch export + checksum. · Nguồn: CISA 3-2-1

## Bẫy thường gặp

1. **"Backup success" trong log nhưng chưa bao giờ restore** → file rỗng/hỏng/thiếu WAL khi cần. Tránh: `OPS-DR-005/017`.
2. **Snapshot cùng tài khoản với production** → xoá nhầm project/tài khoản bị khoá/ransomware mất cả hai. Tránh: offsite khác tài khoản (`OPS-DR-003/007`).
3. **Quên khoá mã hoá**: backup mã hoá bằng khoá chỉ có ở production đã mất. Tránh: `OPS-DR-004` (escrow khoá).
4. **Chỉ backup DB**, quên upload của người dùng, bí mật, state IaC, bộ nhớ agent. Tránh: BACKUP-SCOPE (`OPS-DR-002`).
5. **`archive_command` ghi đè hoặc trả 0 khi lỗi** → chuỗi WAL gãy, PITR vô dụng mà không ai biết. Tránh: lệnh `test ! -f … && cp` + verify (`OPS-DR-006/009`).
6. **Restore vào production để "thử"** → ghi đè dữ liệu thật. Luôn restore vào môi trường tạm.
7. **RTO trên giấy 1 giờ, thực tế 1 ngày** vì runbook thiếu bước dựng hạ tầng/xoay bí mật. Tránh: drill toàn môi trường (`OPS-DR-011`).
8. **Retention vô hạn** → chi phí tăng và vi phạm tối thiểu hoá dữ liệu; **retention 7 ngày** → lỗi logic phát hiện sau 2 tuần không khôi phục được. Tránh: bảng retention có lý do.
9. **Xoá mềm không có xoá cứng** → yêu cầu xoá dữ liệu cá nhân không thực hiện được trọn vẹn (kể cả trong backup — ghi chính sách).
10. **Active-active đa vùng "cho an toàn"** không xử lý xung đột → dữ liệu lệch hai vùng. Active-passive trước; ADR nếu cần active-active.

## Cổng tự động

| Việc | Công cụ (license) | Lệnh / cấu hình | Đặt ở | Ngưỡng |
|---|---|---|---|---|
| Phạm vi backup khớp IaC | script đối chiếu `BACKUP-SCOPE.md` với tài nguyên dữ liệu trong state | — | CI IaC | kho không có mục = đỏ |
| Backup chạy & tươi | metric `backup_last_success_timestamp` | alert `time() - ts > RPO` | runtime | nổ = page/ticket theo SEV |
| Toàn vẹn | `pg_verifybackup` / checksum restic (`restic check`) | sau mỗi backup | job backup | fail = alert |
| Restore mẫu tự động | job lịch tuần restore → smoke query → huỷ | — | CI/cron | fail = alert |
| Bất biến & tách quyền | checkov/conftest trên IaC bucket | Object Lock bật; policy xoá tách | CI IaC | thiếu = đỏ |
| Mã hoá | checkov `CKV_*_ENCRYPTION` | — | CI IaC | thiếu = đỏ |
| Drill có bằng chứng | script đọc `dr-drills.md` | ngày drill gần nhất ≤ 90 ngày (M) | CI lịch | quá hạn = cảnh báo; GO/NO-GO yêu cầu |
| Snapshot trước migration | bước pipeline | id snapshot vào log/PR | deploy | thiếu = dừng |

## Nguồn

- NIST SP 800-34 Rev. 1 — Contingency Planning Guide for Federal Information Systems (11/2010; BIA, RPO/RTO, alternate site): <https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final> — xác minh 2026-10-13 (định nghĩa RPO/RTO nằm trong PDF, chưa trích nguyên văn).
- CISA/CERT (Carnegie Mellon) — "Data Backup Options" (2012): quy tắc 3-2-1 "3 copies, 2 media types, 1 offsite": <https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf> — xác minh 2026-10-13 (đọc PDF bằng pdftotext).
- PostgreSQL docs — Continuous Archiving and Point-in-Time Recovery (`wal_level`, `archive_mode`, `archive_command` không ghi đè, base backup + WAL liên tục): <https://www.postgresql.org/docs/current/continuous-archiving.html> — xác minh 2026-10-13.
- Google SRE Book — Data Integrity (kiểm backup bằng restore liên tục) — (chưa fetch lại 2026-10-13).
- Lifecycle G8 của khung ([`../00-method/lifecycle.md`](../00-method/lifecycle.md)): "backup đã thử khôi phục"; catalog `seeker19110/stored` 09 §1.3 ([BLOCKER] backup có test restore), đọc 2026-10-13.
- (chưa xác minh 2026-10-13) pgBackRest, Barman, restic, Velero, Litestream phiên bản/license; CISA ransomware guidance — xác minh trước khi dùng.
