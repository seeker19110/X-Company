---
title: Đúng dữ liệu: thời gian, tiền, đơn vị, mã hoá ký tự, ca biên
kind: baseline
prefix: BASE-DATA
applies_to: [all]
updated: 2026-10-13
---

# Đúng dữ liệu: thời gian, tiền, đơn vị, mã hoá ký tự, ca biên

> Sàn "đúng nghiệp vụ" mà type-checker không bắt được: mã hoá UTF-8 và chuẩn hoá Unicode, phân biệt `null`/rỗng/0,
> ca biên và tràn số, validate ngữ nghĩa ở biên, idempotency cho ghi. Quy tắc **chi tiết** về thời gian, tiền, đơn vị,
> ID và so sánh chuỗi là nhà của [`../18-cross-cutting/units-time-and-money.md`](../18-cross-cutting/units-time-and-money.md)
> — ở đây chỉ tóm tắt và trỏ; **cách test** ca biên là nhà của
> [`../14-testing-quality/unit-and-logic-edge-cases.md`](../14-testing-quality/unit-and-logic-edge-cases.md).

## Nguyên tắc

- **Đúng › an toàn › ít hơn › kiểm được › nhanh** (P3): mất/sai dữ liệu đắt hơn mọi thứ khác.
- **Một biểu diễn chuẩn cho mỗi loại dữ liệu** ở ranh giới lưu trữ và trao đổi: UTF-8, NFC, UTC RFC 3339, số nguyên
  đơn vị nhỏ nhất cho tiền, đơn vị ghi trong tên.
- **"Không có" ≠ "bằng 0" ≠ "rỗng"**: ba trạng thái khác nhau, kiểu dữ liệu phải phân biệt được.
- **Ca biên là ca thường**: rỗng, một phần tử, rất nhiều, giá trị cực, ký tự lạ, cùng lúc — mỗi nhánh logic phức tạp có
  ít nhất một test ca biên.
- **Ghi hai lần phải cho cùng kết quả** (idempotency) vì mạng, người dùng và agent đều gửi lại.

## Quyết định

| Câu hỏi | Chọn | Khi nào không dùng |
|---|---|---|
| Mã hoá ký tự | **UTF-8** mọi nơi: mã nguồn, CSDL (`utf8mb4` với MySQL, `UTF8` Postgres), HTTP (`charset=utf-8`), file, JSON (RFC 8259 bắt buộc UTF-8). | Giao thức cũ bắt buộc mã hoá khác → chuyển đổi ở biên, ghi ADR. |
| Chuẩn hoá Unicode | **NFC** khi lưu và so sánh chuỗi người nhập (tên, tag, username); tiếng Việt gõ Telex/VNI có thể sinh dạng tổ hợp (NFD) → phải chuẩn hoá. | NFKC/NFKD chỉ cho mục đích tìm kiếm/so khớp định danh, không ghi đè dữ liệu gốc (xoá phân biệt có nghĩa). |
| Số nguyên lớn | JSON số nguyên ngoài ±(2^53−1) → truyền dạng **chuỗi**; JS dùng `BigInt`; ID 64-bit luôn là chuỗi trên dây. | Hệ chỉ Java/Go/Python nội bộ dùng int64 trong binary protocol (protobuf) thì giữ số. |
| Thập phân | Tiền: số nguyên đơn vị nhỏ nhất (`amount_minor` + `currency`) hoặc `DECIMAL(p,s)`; khoa học/đo lường: float64 có ghi sai số. | Không bao giờ float cho tiền, tỷ lệ phần trăm có làm tròn, hay so sánh bằng. |
| Validate ở đâu | Syntactic (kiểu/định dạng) + semantic (phạm vi, quan hệ: `end > start`, tồn kho ≥ 0) tại **biên tiến trình**; ràng buộc nhất quán quan trọng lặp lại ở **CSDL** (`CHECK`, `UNIQUE`, FK). | Không validate lại ở mỗi hàm nội bộ; CSDL không thay cho validate ở biên (thông điệp lỗi xấu). |

## Checklist

- [ ] `BASE-DATA-001` **MUST** Mọi file mã nguồn, cấu hình, template và dữ liệu văn bản là UTF-8 (không BOM, trừ nơi bắt buộc); CSDL và kết nối khai báo UTF-8 (`utf8mb4`/`UTF8`); HTTP response có `charset=utf-8`. → Kiểm: `.editorconfig` `charset = utf-8`; `file --mime-encoding` trên repo không có `iso-8859`/`utf-16`; test tích hợp lưu và đọc lại chuỗi `"Tiếng Việt 🇻🇳"` nguyên vẹn. · Nguồn: RFC 8259 §8.1; W3C i18n (UTF-8 declarations)
- [ ] `BASE-DATA-002` **MUST** Chuỗi do người nhập được **chuẩn hoá NFC** trước khi lưu/so sánh/làm khoá; tìm kiếm dùng case-folding + normalization, không `lower()` ASCII. → Kiểm: test: `"Việt"` dạng NFD và NFC nhập vào cho cùng một bản ghi/khoá; `unicodedata.normalize`/`String.prototype.normalize`/`golang.org/x/text/unicode/norm` xuất hiện ở lớp validate. · Nguồn: UAX #15 (rev. 58, Unicode 18.0.0); OWASP Input Validation CS (normalization)
- [ ] `BASE-DATA-003` **MUST** Phân biệt **thiếu** (`null`/`None`/`undefined`), **rỗng** (`""`, `[]`) và **0/false** trong kiểu dữ liệu, schema CSDL và API; không dùng `||`/`or` để lấy mặc định cho giá trị có thể hợp lệ là 0/rỗng. → Kiểm: lint `strict-boolean-expressions`/`prefer-nullish-coalescing` (TS), `pyright strictOptional`; test cho đầu vào `0`, `""`, `[]`, `null` ở mỗi trường số/chuỗi/danh sách tuỳ chọn. · Nguồn: khung cũ `quality-supplements.md` N2 §6
- [ ] `BASE-DATA-004` **MUST** Mọi đầu vào được validate **cú pháp và ngữ nghĩa** ở biên bằng schema runtime; phạm vi (min/max/độ dài/số phần tử) ghi tường minh; quan hệ (`end ≥ start`, tổng = các phần) kiểm trước khi ghi. → Kiểm: schema có giới hạn cho mọi trường chuỗi/số/mảng; test gửi giá trị ngoài phạm vi và quan hệ sai nhận lỗi có mã. · Nguồn: OWASP Input Validation CS; ASVS 5.0 V2
- [ ] `BASE-DATA-005` **MUST** Số tiền lưu/tính bằng **số nguyên đơn vị nhỏ nhất** hoặc kiểu decimal, luôn đi kèm mã tiền tệ ISO 4217, không float; quy tắc chi tiết ở [`../18-cross-cutting/units-time-and-money.md`](../18-cross-cutting/units-time-and-money.md). → Kiểm: schema CSDL không có cột tiền kiểu `FLOAT/REAL/DOUBLE`; lint cấm `parseFloat`/`float(` ở module tiền; test `0.1 + 0.2` không xuất hiện sai số trong tổng. · Nguồn: Python `decimal` docs; ISO 4217 (SIX list-one)
- [ ] `BASE-DATA-006` **MUST** Thời điểm lưu/tính bằng **UTC** với kiểu có múi giờ (`timestamptz`, `Instant`, `datetime` aware), trao đổi bằng RFC 3339; chỉ đổi sang giờ địa phương khi hiển thị (quy tắc chi tiết ở [`../18-cross-cutting/units-time-and-money.md`](../18-cross-cutting/units-time-and-money.md)). → Kiểm: schema không có `timestamp without time zone` cho thời điểm; lint cấm `datetime.now()` naive/`new Date().toString()`; test ranh giới ngày và DST. · Nguồn: RFC 3339; RFC 9557
- [ ] `BASE-DATA-007` **MUST** Số nguyên vượt 2^53−1 (ID 64-bit, số lượng lớn) không đi qua JSON dạng số; dùng chuỗi hoặc `BigInt`; phép cộng/nhân tiền và đếm có kiểm tràn ở ngôn ngữ không tự tràn an toàn. → Kiểm: API trả ID 64-bit dạng chuỗi (test); Go/Rust/Java dùng kiểu đủ rộng hoặc `checked_*`; test giá trị `MAX_SAFE_INTEGER + 1` không bị làm tròn. · Nguồn: RFC 8259 §6; MDN `Number.MAX_SAFE_INTEGER`
- [ ] `BASE-DATA-008` **MUST** Thao tác ghi có thể bị gửi lại (API tạo đơn/thanh toán, webhook, job, tool của agent) là **idempotent**: idempotency key hoặc khoá tự nhiên `UNIQUE`; nhận lại cùng key → cùng kết quả, không tạo bản ghi/tính tiền thứ hai. → Kiểm: test gửi cùng request hai lần (và đồng thời) → một bản ghi, cùng response. · Nguồn: [`../08-backend/api-design.md`](../08-backend/api-design.md); [`../09-database/transactions-and-consistency.md`](../09-database/transactions-and-consistency.md); catalog 23 §4.1 (SePay HMAC + idempotent)
- [ ] `BASE-DATA-009` **MUST** Thao tác nhiều bước trên dữ liệu là **giao dịch** (tất cả hoặc không): dùng transaction CSDL hoặc outbox/saga với bù trừ; không để trạng thái nửa vời. → Kiểm: test giả lỗi ở bước giữa → không có bản ghi mồ côi; chi tiết [`../09-database/transactions-and-consistency.md`](../09-database/transactions-and-consistency.md). · Nguồn: P3
- [ ] `BASE-DATA-010` **MUST** Ràng buộc nhất quán quan trọng (duy nhất, khoá ngoại, không âm, enum) được **CSDL/kho** thực thi, không chỉ ở mã ứng dụng. → Kiểm: schema/migration có `UNIQUE`, `FK`, `CHECK`; test chèn vi phạm trực tiếp vào CSDL bị từ chối. · Nguồn: [`../09-database/data-modeling.md`](../09-database/data-modeling.md)
- [ ] `BASE-DATA-011` **SHOULD** Mỗi nhánh logic nghiệp vụ phức tạp (tính giá, phân trang, lịch, quyền) có ≥ 1 test **ca biên**: rỗng, một, nhiều, giá trị cực, off-by-one, ký tự Unicode/emoji, đồng thời. → Kiểm: review checklist + coverage nhánh; cách test ở [`../14-testing-quality/unit-and-logic-edge-cases.md`](../14-testing-quality/unit-and-logic-edge-cases.md). · Nguồn: khung cũ `quality-supplements.md` N2 §6
- [ ] `BASE-DATA-012` **SHOULD** Độ dài chuỗi giới hạn theo **ký tự Unicode (code point/grapheme)** nơi người dùng thấy, theo **byte** nơi lưu trữ; hai giới hạn được ghi rõ (tên Nhật 4 ký tự = 12 byte UTF-8). → Kiểm: test chuỗi có emoji/tiếng Việt đạt giới hạn ký tự nhưng vượt byte được xử lý đúng (không cắt giữa ký tự). · Nguồn: W3C i18n (personal names); UAX #15
- [ ] `BASE-DATA-013` **SHOULD** Phép **so sánh và sắp xếp** chuỗi cho người dùng dùng collation theo locale (ICU/`Intl.Collator`/`COLLATE` của CSDL), không so byte; so bằng để làm khoá thì sau NFC + case-fold. → Kiểm: test sắp xếp danh sách tiếng Việt (`a, ă, â, b…`) đúng thứ tự từ điển. · Nguồn: UTS #10 (rev. 55)
- [ ] `BASE-DATA-014` **SHOULD** Dữ liệu từ nguồn ngoài (import CSV/Excel, API đối tác, output LLM) đi qua cùng schema validate như input người dùng; lỗi từng dòng được báo cáo, không làm hỏng cả batch im lặng. → Kiểm: test import file có 1 dòng lỗi → báo cáo dòng đó, các dòng khác xử lý theo chính sách đã khai báo. · Nguồn: P6; catalog 23 §4.5 (ranh giới tin cậy với output model)
- [ ] `BASE-DATA-015` **SHOULD** Đơn vị đo xuất hiện trong **tên trường/kiểu** (`timeout_ms`, `size_bytes`, `weight_kg`, `amount_minor`), không ngầm định; chuyển đổi đơn vị tập trung một nơi. → Kiểm: lint tên trường số không có hậu tố đơn vị trong schema/CSDL → cảnh báo; chi tiết ở [`../18-cross-cutting/units-time-and-money.md`](../18-cross-cutting/units-time-and-money.md). · Nguồn: P5
- [ ] `BASE-DATA-016` **SHOULD** Làm tròn và chia (phần trăm, thuế, chia đơn hàng) có **quy tắc tường minh** (mode, số chữ số) và tổng các phần bằng tổng gốc. → Kiểm: test phân bổ 100 đồng cho 3 phần → tổng = 100, chênh lệch ≤ 1 đơn vị nhỏ nhất. · Nguồn: Python `decimal` (`quantize`, rounding modes)
- [ ] `BASE-DATA-017` **MAY** Property-based testing (fast-check, Hypothesis 6.x, `testing/quick`) cho hàm thuần xử lý dữ liệu để tự sinh ca biên. → Kiểm: ≥ 1 property test cho module tính toán cốt lõi. · Nguồn: [`../14-testing-quality/unit-and-logic-edge-cases.md`](../14-testing-quality/unit-and-logic-edge-cases.md)
- [ ] `BASE-DATA-018` **MAY** Fixture dữ liệu test chứa **Unicode khó** (tiếng Việt NFD/NFC, emoji, RTL, zero-width, tên dài) được dùng chung cho mọi test input. → Kiểm: file fixture tồn tại và được import ở test biên. · Nguồn: [`../14-testing-quality/test-data-and-fixtures.md`](../14-testing-quality/test-data-and-fixtures.md)

## Bẫy thường gặp

- **`value || default`** biến `0` và `""` hợp lệ thành mặc định. Dùng `??`/kiểm `is None`.
- **"Việt" ≠ "Việt"**: hai chuỗi trông giống nhau nhưng NFD/NFC khác nhau → trùng tài khoản, tìm không ra. NFC ở biên.
- **`utf8` của MySQL là 3 byte** → emoji và một số ký tự lỗi. Dùng `utf8mb4`.
- **ID 64-bit qua JSON thành số** → JS làm tròn, hai ID khác nhau thành một. Chuỗi.
- **`0.1 + 0.2`** trong tiền; `Decimal(3.14)` từ float mang sai số của float — tạo Decimal từ **chuỗi**.
- **Cắt chuỗi theo byte** giữa một ký tự UTF-8 → ký tự hỏng, JSON không hợp lệ. Cắt theo grapheme.
- **Hai click = hai đơn hàng**: thiếu idempotency key; disable nút không phải biện pháp server.
- **Validate CSDL thay cho biên**: người dùng nhận "duplicate key value violates unique constraint". Biên báo lỗi đẹp; CSDL là lưới cuối.
- **Test chỉ có "happy path"** với 3 phần tử; production gặp 0 phần tử và 100.000 phần tử.

## Cổng tự động

| Việc kiểm | Công cụ (license) | Lệnh | Đặt ở | Ngưỡng |
|---|---|---|---|---|
| Mã hoá file | EditorConfig (`charset = utf-8`) + editorconfig-checker 7.0.0 (MIT) | `editorconfig-checker` | hook + CI | 0 |
| Null/0/rỗng | typescript-eslint `prefer-nullish-coalescing`, `strict-boolean-expressions`; pyright `strict` | `lint`, `typecheck` | CI | 0 |
| Kiểu cột cấm | script SQL lint / `squawk` (Postgres, GPL-3.0) | grep migration `FLOAT|REAL|DOUBLE|timestamp without time zone` | CI | 0 ở cột tiền/thời điểm |
| Float trong tiền | Semgrep/ESLint rule tự viết cho `modules/money/**` | `lint` | CI | 0 |
| Ca biên | fast-check (MIT) · Hypothesis 6.169.0 (MPL-2.0) · fixture Unicode | `test` | CI | property test cho module lõi |
| Idempotency | test tích hợp gửi trùng + đồng thời | `test` | CI | 1 bản ghi |
| Ràng buộc CSDL | test chèn vi phạm trực tiếp | `test` | CI | bị từ chối |

## Nguồn

- RFC 8259 The JSON Data Interchange Format (§6 số, §8.1 UTF-8): <https://www.rfc-editor.org/rfc/rfc8259> — xác minh 2026-10-13
- UAX #15 Unicode Normalization Forms, rev. 58 (Unicode 18.0.0, 2026-08-12): <https://unicode.org/reports/tr15/> — xác minh 2026-10-13
- UTS #10 Unicode Collation Algorithm, rev. 55: <https://unicode.org/reports/tr10/> — xác minh 2026-10-13
- Unicode 18.0.0 (2026-09-16): <https://www.unicode.org/versions/Unicode18.0.0/> — xác minh 2026-10-13
- W3C i18n — Character encodings in HTML: <https://www.w3.org/International/questions/qa-html-encoding-declarations>; Personal names: <https://www.w3.org/International/questions/qa-personal-names> — xác minh 2026-10-13
- OWASP Cheat Sheet Series — Input Validation: <https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html> — xác minh 2026-10-13
- MDN `Number.MAX_SAFE_INTEGER` (2^53−1): <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER> — xác minh 2026-10-13
- Python `decimal` (ROUND_HALF_EVEN mặc định, `quantize`): <https://docs.python.org/3/library/decimal.html> — xác minh 2026-10-13
- RFC 3339 / RFC 9557: <https://www.rfc-editor.org/rfc/rfc3339>, <https://www.rfc-editor.org/rfc/rfc9557> — xác minh 2026-10-13
- ISO 4217 List One (SIX, xuất bản 2026-09-17): <https://www.six-group.com/en/products-services/financial-information/data-standards.html> — xác minh 2026-10-13
- Hypothesis 6.169.0, editorconfig-checker 7.0.0 (registry, xác minh 2026-10-13)
- Khung cũ X-stored `quality-supplements.md` N2 §6 (chống lỗi logic), commit `1b80fe4`; catalog `seeker19110/stored` 23 §4.1/§4.5 (không float cho tiền, không để model tính giá), đọc 2026-10-13.
