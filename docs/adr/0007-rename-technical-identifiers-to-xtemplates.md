# ADR-0007: Đổi định danh kỹ thuật sang `.xtemplates` / `xt`, thay ADR-0006

- **Trạng thái:** Đã chấp nhận (thay thế ADR-0006)
- **Trạng thái triển khai:** Đã triển khai (`scripts/xt.py`, `xt.yaml`, `.xtemplates/`, `XT_*`; `scripts/install.py`
  `migrate_legacy`/`legacy_refs`; test `tests/test_install.py` `LegacyMigrationTest`)
- **Ngày:** 2026-10-15

## Bối cảnh

ADR-0006 đổi tên hiển thị sang X-Templates nhưng giữ định danh kỹ thuật của tên cũ X-stored: thư mục cài `.xstored/`,
`xs.py`, `xs.yaml`, biến `XS_*`, đuôi `.xstored-new`. Chủ repo yêu cầu (2026-10-15) tên dự án đúng **ở mọi chỗ**, kể cả các
định danh này. Tên repo trên GitHub đã kiểm cùng ngày: `seeker19110/X-Templates`.

Ràng buộc từ ADR-0006 vẫn đúng: đổi `.xstored/` phá dự án đã cài nếu không có đường di chuyển — hook trỏ
`.xstored/scripts/`, manifest hash nằm trong `.xstored/`, `dev-task.sh` chỉ đọc một tên file lệnh (thiếu file = cổng no-op).

## Quyết định

Đổi hết sang tên mới và để `install.py` tự di chuyển dự án đã cài; không giữ lớp đọc song song tên cũ.

| Cũ (≤ 2.x) | Mới (3.0.0) |
|---|---|
| `.xstored/` | `.xtemplates/` |
| `scripts/xs.py` | `scripts/xt.py` |
| `xs.yaml` | `xt.yaml` |
| `XS_ROOT`, `XS_DEBUG`, `XS_FRAMEWORK`, `XS_FRAMEWORK_LINK`, `XS_PROGRESS_BASE`, `XS_RECORD_TIMEOUT` | `XT_*` cùng hậu tố |
| `*.xstored-new` | `*.xtemplates-new` |

Chạy lại `install.py` trên dự án cài bản ≤ 2.x:
1. Chép manifest `.xstored/harness.sha256.json` sang `.xtemplates/` (nếu chưa có) để hook người dùng chưa sửa vẫn được
   cập nhật tại chỗ (AUD-HAR-004), rồi xoá `.xstored/` — bản sao chỉ đọc, cài lại được; symlink thì không đi theo.
2. Đổi `xs.yaml` → `xt.yaml` khi chưa có `xt.yaml`; có cả hai thì giữ cả hai và cảnh báo gộp tay.
3. Liệt kê file người dùng còn nhắc tên cũ (`*.md` ở gốc, `xt.yaml`, `.claude/`, `.github/workflows/`) để sửa tay —
   copy-if-absent không đè file người dùng.

Tài liệu lịch sử giữ tên cũ vì là sự kiện đã xảy ra: `research/`, báo cáo audit đã ký, mục cũ của `CHANGELOG.md`,
nội dung ADR-0001…0006.

## Lý do

- Tên kỹ thuật lệch tên dự án làm người mới phải học hai tên; người dùng yêu cầu đúng tên ở mọi chỗ.
- Đường di chuyển nằm trong `install.py` — đúng lệnh dự án đích vốn chạy để cập nhật khung — nên chi phí mỗi dự án là
  một lần chạy lại install + sửa vài file được liệt kê, không phải lớp tương thích sống mãi trong `xt.py`/hook/`dev-task.sh`.

## Các phương án đã cân nhắc

- **Giữ ADR-0006 (không đổi định danh):** không phá gì, nhưng trái yêu cầu của chủ repo. Loại.
- **Đổi tên + đọc song song tên cũ một bản lớn** (`dev-task.sh` đọc `xs.yaml` khi thiếu `xt.yaml`, `xt.py` nhận `XS_*`):
  êm hơn cho dự án quên chạy lại install, nhưng thêm nhánh mã + test + coverage ở 4 nơi và kéo dài hai tên. Loại; thay bằng
  di chuyển một lần trong install và cảnh báo liệt kê.

## Hệ quả

- Thay đổi phá vỡ → bản phát hành kế tiếp là **3.0.0** (SemVer). Dự án đã cài phải chạy lại `install.py` từ bản mới.
- Dự án chưa chạy lại install vẫn chạy hook cũ trỏ `.xstored/` (bản cũ còn nguyên) — không vỡ cho tới khi cập nhật.
- Hook trong `.claude/hooks/` mà người dùng đã tự sửa không được cập nhật (copy-if-absent) và vẫn trỏ `.xstored/` — sau khi
  install xoá thư mục cũ, hook đó fail-open (không chặn, không đọc bằng chứng) cho tới khi sửa theo danh sách cảnh báo hoặc
  gộp bản `.xtemplates-new`. Install liệt kê đúng các file này.
- Biến môi trường `XS_*` đặt trong CI/shell của dự án đích không còn tác dụng; danh sách cảnh báo của install chỉ quét
  `.github/workflows/`, biến đặt nơi khác phải tự đổi.
