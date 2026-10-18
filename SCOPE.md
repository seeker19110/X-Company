# SCOPE — kiểm soát thay đổi phạm vi

Phạm vi MVP (P0) đóng băng tại cổng G1 (2026-10-18, D-006): xem [PROJECT.md](PROJECT.md) mục 3 (F-001…F-012) và "Không làm (lúc này)".
Thay đổi sau G1 chỉ qua tệp này (PM-PRIO-004).

## Điều kiện để xét thay đổi
1. Có lý do đo được (rủi ro pháp lý/an toàn, chặn luồng chính R-001…R-005 ở PROJECT.md mục 4, hoặc yêu cầu của chủ sản phẩm).
2. Nêu tác động: ước lượng, rủi ro (`docs/RISKS.md`), spec/AC phải sửa.
3. **Mục bị đẩy ra để bù** (hoặc ghi "không bù" kèm lý do và người chịu chi phí).
4. Người quyết: chủ sản phẩm (@seeker19110); điểm kỹ thuật phiên chính tự duyệt ghi `D-NNN` ở [docs/autopilot/DECISIONS.md](docs/autopilot/DECISIONS.md), người đổi ý lúc nào cũng được.
5. Mỗi thay đổi là một commit sửa `PROJECT.md` có message `docs(scope): …` nêu mục bị đổi, kèm một dòng ở bảng dưới.

## Nhật ký thay đổi phạm vi
| ID | Ngày | Thay đổi | Người quyết | Mục bị đẩy ra / bù | Căn cứ |
|---|---|---|---|---|---|
| SC-001 | 2026-10-18 | Đính kèm tệp ở form liên hệ công khai chuyển từ P0 sang P1 (P0 chỉ nhận tệp từ người dùng nội bộ đã đăng nhập) | autopilot (phiên chính tự duyệt), chờ chủ sản phẩm xác nhận | chính mục này đẩy sang P1; không bù | D-013, SPEC-website-cms |

Thay đổi chưa quyết (để trống bảng này là bình thường): thêm dòng khi có.
