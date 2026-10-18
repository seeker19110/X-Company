Ngày 18 tháng 10 năm 2026 \| Phiên bản 1.0

# 1 Quyết định tổng thể

Đề xuất phát triển một nền tảng liên thông gồm website công ty để giới thiệu và tiếp nhận khách hàng, webapp để điều hành doanh nghiệp, và PWA để nhân viên làm việc trên điện thoại. Trọng tâm của bản vận hành đầu tiên là quản lý tổ chức, chấm công, lập kế hoạch, giao việc, nghiệm thu kết quả và báo cáo. Các phân hệ bổ sung được triển khai theo mức ưu tiên để hệ thống sớm dùng được và tiếp tục mở rộng có kiểm soát.

Ưu tiên kiểm tra và mở rộng XBOSS theo hướng đã chọn trước đây. Tuần đầu cần đối chiếu mã nguồn, dữ liệu và quy trình hiện có với kế hoạch này; giữ phần đáp ứng yêu cầu, sửa phần chưa đạt và bổ sung phần thiếu. Những nhận xét về XBOSS trong các đợt đánh giá trước là đầu vào cho kiểm tra, không thay cho bằng chứng hiện trạng. projects-template theo hướng gọn được dùng làm nền quy trình phát triển; một người hoặc agent chính chịu trách nhiệm tích hợp và nghiệm thu.

Quy mô thiết kế ban đầu là 20 đến 200 nhân viên, nhiều phòng ban và địa điểm, với khả năng có nhân viên văn phòng, đi công tác hoặc làm tại công trường. Đây là giả định dự toán. Kiến trúc chuẩn bị để kiểm thử ở quy mô 1.000 nhân viên, nhưng năng lực thực tế chỉ được công bố sau đo tải. Tiếng Việt là ngôn ngữ mặc định; lịch làm việc dùng múi giờ Asia/Ho_Chi_Minh.

## Các quyết định chính

- Website công khai và khu nội bộ có bề mặt truy cập riêng; chỉ nội dung đã duyệt được đưa ra công khai.

- Webapp và PWA dùng chung nghiệp vụ, tài khoản và dữ liệu. PWA là trải nghiệm cài đặt và làm việc trên điện thoại của ứng dụng nội bộ.

- Phân quyền, nhật ký thay đổi, khôi phục dữ liệu và xử lý ngoại tuyến nằm trong phạm vi nền tảng ngay từ đầu.

- Chấm công ghi nhận thời gian làm việc; giờ dự án phục vụ phân bổ công sức; tiến độ phản ánh kết quả được chấp nhận. Ba nhóm dữ liệu này được đối chiếu nhưng không thay thế nhau.

- Phê duyệt sửa công, nghỉ phép, tăng ca và khóa kỳ phải hoàn thành cùng luồng chấm công để có thể thử trọn một kỳ.

- AI được bổ sung khi dữ liệu đã ổn định, phục vụ tóm tắt và gợi ý có nguồn. Quyết định công, lương và nghiệm thu do người có thẩm quyền thực hiện.

## Các mốc dự kiến

| **Mốc**                | **Thời gian tính từ khi khởi động** | **Kết quả**                                                |
|------------------------|-------------------------------------|------------------------------------------------------------|
| Website công ty        | Tuần 4 đến 6                        | Nội dung đã duyệt, CMS, liên hệ và tuyển dụng cơ bản       |
| Bản dùng thí điểm      | Tuần 12 đến 14                      | Chấm công, phê duyệt, công việc, tiến độ và PWA cốt lõi    |
| P0 dùng chính thức     | Tuần 16 đến 20                      | Qua đủ một kỳ công, đối soát và các cổng chất lượng        |
| P1 hoàn thiện vận hành | Tuần 24 đến 28                      | Kế hoạch nguồn lực, CRM gọn, chi phí, tài sản và tri thức  |
| Dự phòng lịch          | Thêm tối đa 4 tuần để lập ngân sách | Xử lý khoảng trống được phát hiện, không tự tăng tính năng |

Lịch này là ước tính cơ sở cho đội khoảng 5 đến 6 người quy đổi toàn thời gian. Cuối tuần 2 phải cập nhật lịch và tổng công theo kết quả kiểm tra XBOSS. Mốc dùng chính thức phụ thuộc kết quả nghiệm thu và ngày bắt đầu kỳ công thực tế.

# 2 Mục tiêu kinh doanh và nguyên tắc đo lường

Website phải giúp khách hàng hiểu công ty làm gì, xem được năng lực có bằng chứng và gửi yêu cầu đến đúng người. Khu nội bộ phải giúp nhân viên biết hôm nay làm gì, quản lý biết điểm nào đang vướng và HR chốt công với dữ liệu truy vết được.

Các chỉ tiêu dưới đây là mục tiêu đề xuất. Đo hiện trạng trong giai đoạn khảo sát để có mốc so sánh; mục tiêu hiệu quả không được trình bày như kết quả đã đạt.

| **Mục tiêu**             | **Chỉ tiêu đề xuất**                                                          | **Cách đo và người phụ trách**                |
|--------------------------|-------------------------------------------------------------------------------|-----------------------------------------------|
| Tiếp nhận khách hàng     | 100% yêu cầu hợp lệ có người phụ trách và trạng thái                          | Nhật ký biểu mẫu và hộp yêu cầu; kinh doanh   |
| Nhân viên sử dụng        | Ít nhất 90% người trong phạm vi pilot dùng luồng chính hằng tuần sau đào tạo  | Sự kiện sử dụng phù hợp từng vai trò; Product |
| Chấm công tin cậy        | Mọi sai lệch ảnh hưởng công hoặc lương được giải thích và xử lý trước khóa kỳ | Biên bản đối soát; HR                         |
| Công việc rõ trách nhiệm | 100% việc đang thực hiện có người chịu trách nhiệm, hạn và kết quả cần giao   | Truy vấn chất lượng dữ liệu; trưởng nhóm      |
| Theo dõi tiến độ         | Mọi mốc trễ hoặc bị chặn có nguyên nhân, người xử lý và lần cập nhật gần nhất | Dashboard ngoại lệ; quản lý dự án             |
| Giảm việc hành chính     | Mục tiêu giảm 30% thời gian tổng hợp báo cáo và công sau hai kỳ ổn định       | So sánh thời gian trước và sau; HR và quản lý |

Số giờ có mặt, số lần đăng nhập và số lượng task không được dùng riêng lẻ làm thước đo hiệu suất cá nhân. Báo cáo cần thể hiện chất lượng kết quả, mức độ phức tạp, phụ thuộc và nguyên nhân chậm.

# 3 Cấu trúc sản phẩm và trải nghiệm

## Website công ty

Các trang chính gồm Trang chủ, Giới thiệu, Dịch vụ, Dự án tiêu biểu, Năng lực và chứng nhận, Tin tức, Tuyển dụng và Liên hệ. Trang dịch vụ mô tả vấn đề khách hàng gặp, phạm vi công ty xử lý, quy trình triển khai và hành động tiếp theo. Hồ sơ dự án chỉ dùng thông tin, hình ảnh và khách hàng được phép công bố; các chứng nhận và số liệu năng lực có người chịu trách nhiệm xác minh.

Biểu mẫu liên hệ thu tên, phương thức liên hệ, nhu cầu và tệp tùy chọn theo giới hạn đã công bố. Sau gửi thành công, hệ thống tạo một hồ sơ có mã, nguồn, người nhận, thời hạn xử lý và lịch sử. Chống spam theo nhiều lớp; chỉ dùng thử thách bổ sung khi cần. Hồ sơ ứng viên được tách quyền khỏi khách tiềm năng và quản trị nội dung.

CMS hỗ trợ bản nháp, xem trước, yêu cầu duyệt, xuất bản, hẹn giờ và hoàn tác phiên bản. Có ảnh đại diện, mô tả trang, đường dẫn, canonical, sitemap, redirect và văn bản thay thế cho ảnh. Chuẩn bị cấu trúc đa ngôn ngữ; tiếng Anh triển khai ở P1 nếu có nội dung được duyệt. Không tự dịch rồi công bố tài liệu năng lực hoặc hợp đồng.

## Webapp nội bộ

Điều hướng theo vai trò, ưu tiên Hôm nay, Công việc, Dự án, Lịch và chấm công, Phê duyệt, Tài liệu, Báo cáo. Nhân viên thấy việc của mình; quản lý thấy ngoại lệ của nhóm; HR thấy các ca và đơn cần xử lý; lãnh đạo thấy các mốc, nguồn lực và rủi ro trọng yếu. Các phân hệ ít dùng được đặt trong menu mở rộng thay vì chiếm màn hình đầu.

## PWA trên điện thoại

Bốn mục điều hướng chính là Hôm nay, Công việc, Chấm công và Cá nhân. Màn hình Hôm nay hiển thị ca, địa điểm, các việc ưu tiên, trở ngại và yêu cầu đang chờ. Các thao tác chính có vùng bấm lớn, dùng được bằng một tay, thông báo lỗi bằng lời dễ hiểu và hướng dẫn cách xử lý. Màu sắc luôn đi cùng nhãn; biểu mẫu lưu nháp để tránh nhập lại khi mạng yếu.

Thông báo tập trung vào việc mới, đổi hạn, kết quả duyệt và ngoại lệ cần xử lý. Hỗ trợ giờ yên lặng, bản tổng hợp và chống gửi trùng. Nội dung nhạy cảm không xuất hiện đầy đủ trên màn hình khóa. Một thông báo đẩy không thay cho trạng thái chính thức trong ứng dụng.

# 4 Phạm vi theo mức ưu tiên

P0 là phạm vi phải đạt trước khi dùng làm hệ thống vận hành chính thức. P1 bổ sung các luồng cần thiết để điều hành đầy đủ hơn. P2 là phần mở rộng phải được lập phạm vi và ngân sách riêng theo lợi ích thực tế.

| **Phân hệ**           | **P0**                                                                                    | **P1 hoặc P2**                                                          |
|-----------------------|-------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| Website và nội dung   | Trang công ty, dịch vụ, dự án, CMS, liên hệ, tuyển dụng cơ bản                            | P1 tiếng Anh và hồ sơ năng lực; P2 cổng khách hàng                      |
| Tổ chức và tài khoản  | Công ty, chi nhánh, phòng ban, nhân viên, quản lý trực tiếp, phân quyền, thu hồi truy cập | P1 tiếp nhận nhân sự, bàn giao, kỹ năng, chứng chỉ và SSO theo nhu cầu  |
| Chấm công             | Ca, vào ra, nghỉ, công tác, tăng ca, sửa công, duyệt, đối soát, khóa kỳ, xuất dữ liệu     | P1 đổi ca nâng cao và tích hợp máy; P2 payroll chuyên sâu               |
| Kế hoạch và công việc | Dự án, đầu việc, mốc, phụ thuộc cơ bản, kế hoạch tuần, List, Kanban và Calendar           | P1 Gantt, công việc định kỳ, mẫu dự án, kế hoạch nguồn lực              |
| Tiến độ và chất lượng | Baseline, lịch sử thay đổi, báo cáo, bằng chứng, nghiệm thu, trả lại, trở ngại            | P1 so sánh và tái lập kế hoạch nâng cao, khối lượng chi tiết; P2 dự báo |
| Giờ theo dự án        | Khai giờ theo công việc khi cần, duyệt và đối chiếu                                       | P1 định mức và chi phí nhân công; P2 tính phí khách hàng                |
| Phê duyệt             | Luồng theo loại đơn, phạm vi người duyệt, hạn và lịch sử                                  | P1 ủy quyền có thời hạn và luồng theo ngưỡng                            |
| Tài liệu và trao đổi  | Bình luận theo đối tượng, đính kèm riêng tư, phiên bản và tìm kiếm cơ bản                 | P1 kho tri thức; P2 tích hợp chữ ký số theo yêu cầu                     |
| Khách hàng            | Hộp yêu cầu và chuyển thành dự án có kiểm soát                                            | P1 lead, cơ hội, báo giá và lịch sử liên hệ ở mức gọn                   |
| Chi phí và tài sản    | Chuẩn bị liên kết dữ liệu theo dự án                                                      | P1 đề nghị chi, tạm ứng, duyệt, hạn mức; cấp phát và thu hồi tài sản    |
| Báo cáo               | Công cần xử lý, việc trễ, tiến độ nghiệm thu, giờ và tải công việc                        | P1 ngân sách, chi phí và báo cáo định kỳ                                |
| PWA và vận hành       | Cài đặt, dữ liệu cần thiết ngoại tuyến, hàng chờ đồng bộ, giám sát và backup              | P1 mở rộng thao tác ngoại tuyến; P2 native khi có yêu cầu phần cứng     |
| Tự động hóa và AI     | Quy tắc nhắc việc, định tuyến và cảnh báo có thể kiểm tra                                 | P1 mở rộng quy tắc; P2 AI tóm tắt và gợi ý có dẫn nguồn                 |

Kế toán pháp định, thuế và bảo hiểm, tính lương phức tạp, kho đầy đủ, CRM toàn diện, chat hoặc video riêng và BIM là các dự án mở rộng. Bản đầu xuất bảng công đã duyệt để hệ thống lương hoặc kế toán hiện có tiếp nhận.

# 5 Vai trò và phân quyền

Quyền là kết hợp giữa vai trò, công ty, đơn vị, dự án, quan hệ với dữ liệu và trạng thái nghiệp vụ. Một người có thể giữ nhiều vai trò. Việc là quản lý một dự án không tự cấp quyền đọc hồ sơ nhân sự của các thành viên.

| **Vai trò**                | **Quyền nghiệp vụ mặc định**                                       | **Ranh giới cần kiểm tra**                                        |
|----------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------|
| Nhân viên                  | Công, đơn từ và hồ sơ cá nhân; việc và tài liệu được giao          | Công và hồ sơ HR của mình; dữ liệu khác theo phạm vi được chia sẻ |
| Trưởng nhóm                | Kế hoạch, phân công, công và đơn cần xác nhận trong nhóm           | Không tự duyệt đơn của chính mình                                 |
| Quản lý dự án              | Tiến độ, nhân lực, giờ và nghiệm thu của dự án được giao           | Không tự mở quyền xem GPS, lương hoặc hồ sơ HR                    |
| HR và quản lý công         | Ca, nghỉ, ngoại lệ, đối soát và khóa kỳ theo phạm vi               | Quyền hồ sơ nhạy cảm và xuất dữ liệu được cấp riêng               |
| Kế toán                    | Bảng công đã khóa, khoản chi đã duyệt và dữ liệu phục vụ hạch toán | Không sửa sự kiện chấm công gốc                                   |
| Kinh doanh và biên tập     | Nội dung website hoặc khách tiềm năng theo nhiệm vụ                | Hồ sơ ứng viên thuộc phạm vi tuyển dụng riêng                     |
| Lãnh đạo                   | Tổng quan và xem chi tiết theo quyền đã cấp                        | Mọi xem và xuất dữ liệu nhạy cảm đều chịu chính sách              |
| Quản trị kỹ thuật          | Cấu hình, tài khoản, triển khai và giám sát                        | Truy cập dữ liệu nghiệp vụ nhạy cảm cần quyền riêng và lưu vết    |
| Khách hàng và đối tác ở P2 | Mốc, việc và tài liệu đã chia sẻ cho tổ chức đó                    | Không thấy tài liệu nội bộ, chi phí nội bộ hoặc dự án khác        |

Quyền được kiểm tra ở máy chủ trên mọi đường truy cập: màn hình, API, tìm kiếm, xuất báo cáo, tệp, worker và thông báo. Mặc định từ chối khi thiếu quyền. Ma trận các trường hợp được phép và bị cấm là một phần bắt buộc của bộ nghiệm thu.

# 6 Quy trình chấm công và quản lý thời gian

## Dữ liệu và trạng thái

Chấm công gồm ba lớp. Lớp sự kiện gốc ghi nhận thao tác vào hoặc ra; lớp tổng hợp áp dụng ca, ngày nghỉ và chính sách; lớp bảng công đã duyệt là số liệu được khóa để chuyển sang tính lương. Yêu cầu điều chỉnh tạo lịch sử mới, giữ nguyên bằng chứng gốc trong thời hạn lưu áp dụng.

Mỗi sự kiện có mã chống trùng, nhân viên, công ty, ca, điểm làm việc, loại vào hoặc ra, thời gian thiết bị, thời gian máy chủ nhận, nguồn và phiên bản chính sách. Khi dùng định vị, ghi độ chính xác và thời điểm lấy vị trí. Bằng chứng có chính sách lưu riêng, tách khỏi dữ liệu công tổng hợp.

Trạng thái trên điện thoại phân biệt Đã lưu trên thiết bị, Đã gửi lên hệ thống và Đã được xác nhận. Luồng bảng công là Nháp, Nhân viên đối chiếu, Quản lý xác nhận, HR chốt và Khóa. Sau khóa, thay đổi đi qua điều chỉnh có người duyệt và phiên bản xuất mới.

## Phương thức chấm công đề xuất

| **Bối cảnh**               | **Phương thức mặc định**                                                                       | **Cách xử lý ngoại lệ**                                              |
|----------------------------|------------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| Văn phòng                  | Tài khoản cá nhân và QR động tại điểm làm việc; có thể dùng kiosk được quản lý                 | Quản lý xác nhận khi thiếu thiết bị hoặc mã không hoạt động          |
| Công trường hoặc di chuyển | Ca và địa điểm được giao; định vị tại thao tác khi có căn cứ phù hợp; QR khi có điểm kiểm soát | GPS kém, sai địa điểm hoặc mạng yếu chuyển sang đề nghị cần xác minh |
| Công tác hoặc làm từ xa    | Lịch đã được duyệt và check-in theo chế độ phù hợp                                             | Gắn lý do và người phụ trách; không áp vùng công trường máy móc      |
| Ngoại tuyến                | Lưu đề nghị trên thiết bị, đồng bộ khi có mạng                                                 | Máy chủ kiểm tra lại, quản lý xử lý trường hợp chưa đủ tin cậy       |

QR nên có chữ ký máy chủ và thời hạn ngắn theo cấu hình, thí dụ 30 đến 60 giây ở đợt thử. Chống gửi lặp gắn với nhân viên và hành động; QR dùng chung không bị vô hiệu chỉ vì người đầu tiên đã quét. Tín hiệu QR, vị trí, ca và thời gian hỗ trợ đối soát. W3C xác nhận Geolocation API không bảo đảm tọa độ là vị trí thật, vì vậy sản phẩm không thể bảo đảm chống chấm công hộ tuyệt đối bằng GPS hoặc QR. \[1\]

## Các quy tắc bắt buộc

- Ca 22 giờ đến 6 giờ hôm sau thuộc một ca nghiệp vụ. Khi cần phân loại giờ theo ngày lịch, hệ thống phân đoạn nhưng vẫn liên kết cùng ca. Frappe HR cũng mô tả ca có giờ kết thúc nhỏ hơn giờ bắt đầu là ca qua ngày. \[2\]

- Xử lý nhiều lần vào ra, nghỉ giữa ca, ca tách đoạn, chuyển địa điểm, ca chồng lấn và sự kiện đến sai thứ tự.

- Thiếu checkout tạo ngoại lệ. Giờ ra do hệ thống ước tính phải gắn nhãn; không được trình bày như nhân viên đã bấm.

- Giờ có mặt, OT đề nghị, OT được duyệt và giờ dự án hiển thị riêng. Việc đi sớm hoặc về muộn không tự tạo OT đã được chấp thuận.

- Ghi nhận riêng sự đồng ý làm thêm của người lao động khi áp dụng; không đồng nhất với việc quản lý duyệt OT. Hướng dẫn của Chính phủ dẫn điều kiện này tại Điều 107 Bộ luật Lao động. \[20\]

- Kiểm tra hạn mức tăng ca đồng thời theo ngày, tháng và năm, với cấu hình có nguồn, ngày hiệu lực và căn cứ cho ngoại lệ. Hướng dẫn của Bộ Nội vụ năm 2026 nhấn mạnh các giới hạn phải được đáp ứng đồng thời. \[3\]

- Nghỉ phép được quản lý qua sổ biến động số dư, tránh sửa trực tiếp số dư không có lịch sử. Đơn nghỉ trùng ca được phát hiện trước duyệt.

- Cấu hình ca, nghỉ, làm tròn và điều chuyển có ngày hiệu lực; thay cấu hình mới không âm thầm tính lại kỳ đã khóa.

- Không cộng trùng khoảng thời gian giữa hai thiết bị hoặc hai dự án. Chênh lệch giữa công và giờ dự án có lý do, không tự đồng nhất các tổng.

- Người đề nghị không tự duyệt. P0 có người duyệt thay thế được chỉ định khi kiêm nhiệm; P1 bổ sung chức năng ủy quyền với phạm vi và thời hạn rõ ràng.

- Log đến muộn sau khóa kỳ không sửa số liệu chính thức ngay. HR quyết định điều chỉnh có kiểm soát.

## Chốt công tháng

HR mở kỳ và công bố thời hạn đối chiếu. Nhân viên rà công; quản lý xác nhận trường hợp thiếu hoặc bất thường; HR đối chiếu ca, nghỉ, OT và các điều chỉnh. Chỉ khóa khi các sai lệch trọng yếu đã được xử lý. Bản xuất có mã kỳ, phiên bản, thời gian, người xuất và tổng kiểm tra. Kế toán xác nhận nhận đúng phiên bản; một bản điều chỉnh thay thế hoặc bổ sung phải được nhận diện rõ.

# 7 Lập kế hoạch giao việc và theo dõi tiến độ

## Mô hình kế hoạch

Phân cấp cơ bản là Công ty, mục tiêu, dự án, giai đoạn hoặc hạng mục, công việc và checklist. Mỗi dự án có chủ nhiệm, phạm vi, ngày bắt đầu, hạn, mốc bàn giao và baseline được duyệt. Kế hoạch ca trả lời khi nào nhân viên làm; kế hoạch nguồn lực trả lời ai còn khả năng nhận việc; kế hoạch dự án trả lời kết quả nào phải đạt vào lúc nào.

Mỗi công việc có một người chịu trách nhiệm chính, người phối hợp tùy chọn, người nghiệm thu, hạn, ưu tiên, công sức hoặc khối lượng dự kiến, tiêu chí hoàn thành và bằng chứng. P0 hỗ trợ quan hệ phụ thuộc cơ bản, cảnh báo hạn không phù hợp và kế hoạch tuần. P1 bổ sung Gantt, việc định kỳ, mẫu và phân bổ nguồn lực. Luồng của Plane về Modules và Cycles là nguồn tham khảo để phân nhóm và tổ chức chu kỳ công việc. \[4\] \[5\]

Quản lý lập kế hoạch tuần từ các mốc dự án và việc tồn, kiểm tra ca và nghỉ đã duyệt, sau đó giao người, hạn và đầu ra. Nhân viên có thể phản hồi quá tải hoặc thiếu điều kiện. Việc đổi hạn, người chịu trách nhiệm hoặc phạm vi giữ lịch sử, đồng thời thông báo đúng người bị ảnh hưởng.

## Hoàn thành và nghiệm thu

Luồng mặc định gồm Chưa làm, Đang làm, Chờ nghiệm thu và Hoàn tất. Hỗ trợ đánh dấu bị chặn, trả lại, hủy hoặc mở lại với lý do. Một việc thiếu bằng chứng bắt buộc hoặc chưa được nghiệm thu không được tính là hoàn tất. Các việc hành chính nhỏ có thể dùng quy tắc hoàn thành giản lược đã cấu hình; kết quả quan trọng phải có người kiểm tra độc lập phù hợp.

Dashboard hiển thị ba con số khác nhau: tiến độ theo kế hoạch, tiến độ người thực hiện báo cáo và tiến độ đã được nghiệm thu. Số giờ đã dùng chỉ phản ánh công sức. Trọng số dùng tính tiến độ được duyệt cùng baseline, tính trên hạng mục lá để không cộng trùng cha và con.

Ví dụ minh họa: ba hạng mục có trọng số 20, 30 và 50; tỷ lệ đã nghiệm thu lần lượt 100%, 50% và 0%. Tiến độ nghiệm thu của dự án bằng 35%. Việc thêm nhiều task nhỏ không tự làm con số tăng. Đổi phạm vi hoặc trọng số cần phê duyệt và lưu baseline cũ; hủy task không được tính như hoàn thành.

## Cảnh báo và báo cáo quản lý

- Cảnh báo việc quá hạn, mốc có nguy cơ trễ, việc bị chặn lâu và người được phân bổ quá khả năng.

- Xem kế hoạch so với thực tế, khối lượng được chấp nhận, việc trả lại và lý do làm lại.

- Mỗi cảnh báo có người xử lý và hành động tiếp theo, tránh chỉ tô màu đỏ không có trách nhiệm.

- Tiến độ tổng cao không được che khuất một mốc quan trọng đang trễ. Luôn có bảng mốc bàn giao độc lập.

- Báo cáo đi xuống được đến công việc, bằng chứng và quyết định nghiệm thu để kiểm tra số liệu.

# 8 Các quy trình liên thông và phần bổ sung

## Từ khách hàng đến bàn giao

Yêu cầu website đi vào hộp tiếp nhận, được giao người phụ trách và đánh giá. Khi đủ điều kiện, hồ sơ liên kết với báo giá hoặc hợp đồng. P0 tạo dự án trực tiếp; P1 bổ sung tạo từ mẫu. Dự án được giao nhân lực, thực hiện, nghiệm thu và bàn giao. Nội dung để công bố thành dự án tiêu biểu phải qua duyệt riêng, tách khỏi hồ sơ nội bộ.

P1 chỉ bao gồm CRM gọn: khách hàng, người liên hệ, lead, cơ hội, trạng thái, lịch sử và báo giá hoặc tệp liên quan. Không tự xây hệ thống marketing hoặc quản trị bán hàng phức tạp trong cùng đợt.

## Nhân sự từ tiếp nhận đến bàn giao

Nhân viên mới được tạo hồ sơ, cấp quyền theo nhiệm vụ, gán ca và quản lý, nhận tài liệu bắt buộc và tài sản. Khi điều chuyển, quyền và lịch thay đổi theo ngày hiệu lực nhưng lịch sử công giữ bối cảnh cũ. Khi nghỉ việc, thu hồi phiên và quyền, bàn giao việc, tài sản và hồ sơ; dữ liệu được giữ hoặc xóa theo chính sách từng loại.

## Chi phí và tài sản

P1 quản lý đề nghị tạm ứng hoặc chi phí gắn dự án, chứng từ, người duyệt, hạn mức và trạng thái đối soát. Báo cáo chỉ thể hiện ngân sách và chi phí đã được nhập hoặc tích hợp với nguồn rõ ràng; không tự gọi là lợi nhuận kế toán khi chưa có dữ liệu kế toán đầy đủ.

Tài sản ở P1 giới hạn ở danh mục, mã QR, người giữ, cấp phát, thu hồi, hỏng và bảo trì cơ bản. Mua hàng, tồn kho, khấu hao và kế toán tài sản là phần mở rộng hoặc tích hợp.

## Tri thức và tự động hóa

Kho tài liệu có chủ sở hữu, phiên bản, ngày rà soát và đối tượng được đọc. Bình luận gắn trực tiếp với việc, đơn và dự án. Quy tắc tự động tạo việc định kỳ, nhắc trước hạn, định tuyến biểu mẫu và báo cáo tổng hợp phải có người sở hữu, lịch sử và cách tắt.

AI ở P2 có thể tóm tắt tuần, gợi ý việc tiếp theo, tìm tài liệu hoặc phát hiện thiếu thông tin. Kết quả dẫn về nguồn nội bộ mà người đọc có quyền xem. Hạn chế dữ liệu gửi ra ngoài, đặt hạn mức chi phí và giữ phê duyệt của con người cho thay đổi có tác động nghiệp vụ.

# 9 Gói chuyên ngành công trường

XBOSS có bối cảnh phát triển liên quan quản lý thi công, nên kế hoạch dự trù một gói chuyên ngành có thể nối vào lõi dự án. Phạm vi và lịch thực hiện gói này được quyết định sau khi kiểm tra nghiệp vụ thực tế và khả năng tái sử dụng module hiện có.

- Phân cấp dự án theo khu vực, tầng, hệ thống và hạng mục BOQ; liên kết đầu việc với khối lượng và bản vẽ.

- Nhật ký ngày ghi tổ đội, nhân công, điều kiện, công việc và khối lượng đã thực hiện.

- Bản vẽ có phiên bản; công việc nhận biết revision đang dùng, thay đổi cần được truyền đạt.

- RFI, trình duyệt vật tư, yêu cầu vật tư, checklist QA/QC và yêu cầu nghiệm thu.

- Tách khối lượng thi công, khối lượng nội bộ xác nhận và khối lượng khách hàng nghiệm thu.

- Punch list, lỗi, làm lại và xác nhận đóng; liên kết bằng chứng trước và sau xử lý.

- Phát sinh hoặc đổi thiết kế được đánh giá ảnh hưởng phạm vi, tiến độ và chi phí trước cập nhật baseline.

Khi tính tiến độ từ BOQ, không cộng trực tiếp mét ống, bộ thiết bị và mét vuông. Dùng trọng số đã duyệt theo phương pháp dự án lựa chọn; khối lượng vượt kế hoạch phải được ghi nhận là phát sinh để xử lý. Gói đầy đủ về kho, mua hàng, BIM và thanh toán hợp đồng không nằm mặc định trong dự toán P0 cộng P1.

# 10 PWA và làm việc khi mạng yếu

PWA phải được thiết kế theo từng nghiệp vụ. Việc cài lên màn hình chính không tự tạo khả năng làm việc ngoại tuyến hoặc đồng bộ đúng dữ liệu. Các khả năng phụ thuộc trình duyệt phải có phương án thay thế và được kiểm tra trên thiết bị thật.

| **Khả năng**     | **Quyết định thiết kế**                                           | **Giới hạn cần thể hiện**                                          |
|------------------|-------------------------------------------------------------------|--------------------------------------------------------------------|
| Cài đặt          | Manifest, biểu tượng, HTTPS và hướng dẫn theo thiết bị            | Trải nghiệm cài đặt khác nhau giữa nền tảng                        |
| Xem ngoại tuyến  | Cache các việc được giao, lịch ca và dữ liệu tối thiểu đã đồng bộ | Hiển thị thời điểm cập nhật gần nhất                               |
| Ghi khi mất mạng | Lưu nháp, cập nhật công việc và đề nghị chấm công vào hàng chờ    | Bản chưa gửi chưa được máy chủ xác nhận                            |
| Đồng bộ          | Đồng bộ khi mở ứng dụng, trở lại foreground hoặc bấm Đồng bộ      | Background Sync chỉ bổ sung ở trình duyệt hỗ trợ \[7\]             |
| Thông báo đẩy    | Xin quyền đúng thời điểm; luôn có hộp thông báo trong app         | iOS và iPadOS hỗ trợ Web Push cho webapp Home Screen từ 16.4 \[6\] |
| Tệp và camera    | Nén ảnh, giới hạn dung lượng, hiển thị tiến trình và thử lại      | Tệp lớn có thể cần mở ứng dụng để hoàn thành gửi                   |
| Dữ liệu cục bộ   | Theo dõi dung lượng, lỗi lưu và số bản đang chờ                   | IndexedDB và cache có thể bị trình duyệt thu hồi \[8\]             |

P0 hỗ trợ xem dữ liệu đã tải, ghi nháp, gửi báo cáo tiến độ và đề nghị chấm công. Phê duyệt, đổi quyền, khóa bảng công và quyết định liên quan tiền phải thực hiện trực tuyến. Trước khi áp dụng thao tác gửi muộn, máy chủ kiểm tra lại tài khoản, phạm vi, phiên bản dữ liệu và trạng thái kỳ.

Mỗi lệnh có khóa chống trùng. Gửi lại cùng khóa và nội dung trả lại cùng kết quả; cùng khóa khác nội dung bị phát hiện. Hai thiết bị tạo hai khóa khác nhau vẫn phải qua ràng buộc nghiệp vụ để tránh hai lần vào ca đang mở. Cập nhật công việc dùng phiên bản để phát hiện xung đột; không dùng quy tắc bản gửi cuối luôn thắng cho công, tiền, quyền hoặc phê duyệt. Nâng cấp ứng dụng và service worker phải giữ hoặc chuyển đổi hàng chờ tương thích, không xóa các bản chưa gửi.

Đăng xuất xóa dữ liệu riêng trên thiết bị. Nếu còn bản chưa gửi, giao diện hiển thị số lượng và cho đồng bộ, khóa tạm phiên hoặc đăng xuất kèm xóa theo chính sách đã công bố. Không âm thầm mất nháp và không để tài khoản tiếp theo thấy dữ liệu cũ. Thiết bị dùng chung mặc định không cache hồ sơ riêng. Thu hồi quyền từ máy chủ không thể xóa ngay dữ liệu trên thiết bị đang hoàn toàn mất mạng; do đó phải giảm dữ liệu cache và kiểm tra lại quyền khi kết nối.

P0 dùng QR hoặc camera theo khả năng thiết bị. Nếu cần NFC, Bluetooth, định danh phần cứng hay tác vụ nền đặc thù, phải làm thử riêng trên thiết bị mục tiêu rồi mới cam kết; đó có thể là căn cứ chọn ứng dụng native ở P2. Đăng ký thiết bị trong PWA được hiểu là đăng ký phiên cài đặt hoặc trình duyệt, không được mô tả thành IMEI hay mã phần cứng bất biến.

# 11 Kiến trúc kỹ thuật đề xuất

## Phương án nền tảng

Ưu tiên mở rộng kiến trúc chia module trong một ứng dụng của XBOSS. Website công khai có thể triển khai riêng để tách tải truy cập, cache và nội dung marketing; khu nội bộ dùng API và bộ quy tắc nghiệp vụ chung. Các module có ranh giới rõ nhưng dùng giao dịch cơ sở dữ liệu ở nơi cần tính nhất quán. Chỉ tách dịch vụ khi tải, bảo mật hoặc cách triển khai tạo ra nhu cầu được chứng minh.

Nếu cần xây thành phần mới phù hợp với hệ thống hiện tại, cấu hình tham chiếu là Next.js và TypeScript cho giao diện, PostgreSQL cho dữ liệu quan hệ, kho tệp tương thích S3 và một worker cho tác vụ nền. Giữ hệ thống xác thực, hàng đợi và hạ tầng đang dùng nếu đạt tiêu chí. Tài liệu Next.js cung cấp hướng dẫn PWA nhưng phần ngoại tuyến vẫn phải được thiết kế và kiểm thử riêng. \[9\]

| **Lớp**          | **Thành phần mục tiêu**                                  | **Trách nhiệm**                                   |
|------------------|----------------------------------------------------------|---------------------------------------------------|
| Giao diện        | Website công khai, webapp và PWA                         | Hiển thị theo quyền, biểu mẫu, trạng thái đồng bộ |
| API và nghiệp vụ | Các module tổ chức, công, việc, tiến độ, duyệt, tài liệu | Kiểm quyền, xác thực dữ liệu và giao dịch         |
| Dữ liệu          | Cơ sở dữ liệu quan hệ và kho tệp private                 | Ràng buộc, lịch sử, phiên bản và quyền tệp        |
| Tác vụ nền       | Worker và hàng đợi bền vững                              | Xuất báo cáo, xử lý ảnh, nhắc việc và tích hợp    |
| Vận hành         | CI/CD, giám sát, backup, quản lý bí mật                  | Phát hành có kiểm soát, phục hồi và điều tra lỗi  |

Một công ty có nhiều pháp nhân hoặc chi nhánh chưa đồng nghĩa sản phẩm SaaS phục vụ nhiều doanh nghiệp độc lập. P0 có company_id, membership và phạm vi dữ liệu rõ ràng; billing thuê bao, đăng ký tenant và vận hành SaaS là quyết định riêng.

## Dữ liệu cốt lõi

| **Nhóm**              | **Các thực thể chính**                                                                    |
|-----------------------|-------------------------------------------------------------------------------------------|
| Tổ chức và danh tính  | Company, Branch, Department, Worksite, User, Membership, Role, Session                    |
| Nhân sự và lịch       | Employee, EmploymentHistory, ShiftTemplate, ShiftAssignment, HolidayCalendar, LeaveLedger |
| Chấm công             | AttendanceEvent, Evidence, Adjustment, AttendanceSummary, AttendancePeriod                |
| Công việc và kế hoạch | Project, WorkPackage, Task, Dependency, Milestone, Allocation, PlanBaseline               |
| Kết quả và thời gian  | ProgressReport, Acceptance, TimesheetEntry                                                |
| Phê duyệt và tệp      | ApprovalRequest, ApprovalDecision, Document, DocumentVersion, FileObject                  |
| Vận hành              | AuditEvent, Notification, OutboxEvent, Job, ImportBatch                                   |

Lưu thời điểm chuẩn UTC, đồng thời giữ múi giờ và ngày nghiệp vụ của ca. Các khóa ngoại quan trọng phải giữ đúng phạm vi công ty. Tiền dùng kiểu số chính xác và đơn vị tiền tệ rõ ràng; khối lượng lưu kèm đơn vị. Hồ sơ lịch sử không bị viết lại theo phòng ban hiện tại của nhân viên.

Mỗi loại dữ liệu có một nguồn chính thức. Nếu tích hợp HR hoặc kế toán khác, xác định rõ hệ nào quản lý hồ sơ nhân viên, bảng công, tài khoản hay chi phí; có ánh xạ mã và đối soát. Không để hai hệ thống cùng tự quyết số liệu chuẩn.

## Tính nhất quán và tích hợp

Sự kiện nghiệp vụ và thông điệp cần xử lý nền được ghi trong cùng giao dịch, qua cơ chế outbox hoặc hàng đợi tương đương. Worker có thử lại giới hạn, lịch sử lỗi và hàng lỗi cần xử lý. Gửi thông báo thất bại không làm mất một lần chấm công đã ghi bền vững. API tích hợp có xác thực, phiên bản, khóa chống trùng và giới hạn tốc độ; webhook được kiểm tra nguồn.

Các tích hợp ưu tiên gồm import và export Excel hoặc CSV, email giao dịch, lịch làm việc và máy chấm công đang sử dụng. Kết nối tài khoản doanh nghiệp, kế toán, chữ ký số hoặc kênh thông báo khác chỉ triển khai khi xác định được nguồn chính thức và hợp đồng API phù hợp.

# 12 Bảo mật và bảo vệ dữ liệu

## Kiểm soát kỹ thuật

- Tài khoản nội bộ được mời hoặc cấp từ danh sách nhân viên. Quy trình đặt lại mật khẩu, thu hồi phiên, bàn giao công việc và quyền truy cập phải được kiểm thử; tài khoản cá nhân không chuyển cho người khác.

- Bắt buộc xác thực bổ sung cho quản trị và vai trò nhạy cảm; quyền của phiên được kiểm lại khi có thay đổi quan trọng.

- Kiểm quyền phía máy chủ trên mỗi request và tài nguyên theo nguyên tắc tối thiểu, mặc định từ chối. Đây cũng là các nguyên tắc OWASP khuyến nghị. \[10\]

- Với PostgreSQL, có thể dùng RLS như lớp bảo vệ bổ sung. Tài khoản ứng dụng không dùng superuser hoặc BYPASSRLS; phải kiểm tra trường hợp chủ bảng được bỏ qua chính sách. RLS không thay kiểm quyền của API, worker và tệp. \[11\]

- Tệp nội bộ nằm trong vùng private. URL có thời hạn chỉ được cấp sau kiểm quyền; dữ liệu cần thu hồi ngay sử dụng điểm tải có xác thực thay vì phụ thuộc URL còn hạn.

- Kiểm loại và dung lượng tệp, cách ly tệp chưa kiểm tra; không gửi hồ sơ nhạy cảm lên dịch vụ quét công khai. Bản xuất và tệp tạm cũng có thời hạn xóa.

- HTTPS, cookie phiên an toàn, chống CSRF và XSS, giới hạn tốc độ, quản lý bí mật riêng và che dữ liệu cá nhân trong log.

- Nhật ký ghi ai làm gì, đối tượng, thời điểm, lý do và kết quả. Ứng dụng ghi nối tiếp; lưu bản sao cần thiết tách quyền để hỗ trợ kiểm toán. Không gọi audit bất biến tuyệt đối chỉ vì giao diện không cho sửa.

## Căn cứ và yêu cầu vận hành dữ liệu

Mốc pháp lý được kiểm tra cho kế hoạch là ngày 18 tháng 10 năm 2026. Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 có hiệu lực từ 01/01/2026. \[12\] Nghị định 356/2025/NĐ-CP cùng có hiệu lực từ ngày này và thay Nghị định 13/2023/NĐ-CP. Nghị định phân loại dữ liệu định vị và sinh trắc là nhạy cảm; không nên tự áp dụng miễn trừ chỉ vì công ty nhỏ. \[13\]

Các yêu cầu thiết kế đề xuất là chỉ thu dữ liệu cần cho mục đích đã xác định, lấy vị trí tại thao tác cần thiết, có đường xử lý khi nhân viên không thể cung cấp vị trí và tách quyền xem bằng chứng. Nhận diện khuôn mặt không thuộc P0. Trước khi bật thu GPS hoặc ảnh, HR và người phụ trách dữ liệu xác lập mục đích, căn cứ xử lý, người nhận, thời hạn lưu và cách tiếp nhận yêu cầu; lưu bằng chứng đồng ý khi căn cứ áp dụng yêu cầu điều đó.

Lập danh mục dữ liệu và nhà cung cấp cloud, email, push, analytics, AI và backup để rà soát luồng xử lý thực tế, nghĩa vụ đánh giá tác động và chuyển dữ liệu. Có quy trình phát hiện, xử lý, ghi nhận và thông báo sự cố theo trường hợp luật định. Các yêu cầu này cần được người phụ trách HR và pháp chế xác nhận trước vận hành.

Hồ sơ ứng viên, dữ liệu nhân viên, GPS, ảnh bằng chứng, bảng công và bản xuất có lịch lưu riêng. Hướng dẫn của Chính phủ về dữ liệu người lao động thể hiện nghĩa vụ lưu hoặc xóa theo pháp luật và thỏa thuận phù hợp; vì vậy nghỉ việc không dẫn đến xóa mọi hồ sơ ngay và cũng không cho phép giữ mọi dữ liệu vô thời hạn. \[14\]

# 13 Chỉ tiêu chất lượng và vận hành

Các con số dưới đây là mục tiêu nghiệm thu đề xuất, cần chứng minh bằng bài đo trên cấu hình đã chọn.

| **Hạng mục**                  | **Mục tiêu**                                                    | **Điều kiện đo**                                                                                |
|-------------------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Website trên thiết bị di động | LCP không quá 2,5 giây; INP không quá 200 ms; CLS không quá 0,1 | Mục tiêu ở phân vị 75 của dữ liệu thực tế; trước phát hành dùng cấu hình đo lặp xác định \[16\] |
| Khả năng tiếp cận             | Hướng tới WCAG 2.2 AA ở luồng chính                             | Bàn phím, focus, nhãn, lỗi biểu mẫu, tương phản và trình đọc màn hình \[15\]                    |
| Ghi chấm công                 | p95 xử lý máy chủ dưới 1 giây sau ghi bền vững                  | Không gồm xin GPS, đường truyền hoặc tải ảnh; đo cả tỷ lệ lỗi                                   |
| Đợt dồn vào ca                | 200 yêu cầu trong 10 giây kèm gửi lại và tải công việc hỗn hợp  | Không mất hoặc tạo công trùng; thử thêm dữ liệu 1.000 nhân viên                                 |
| Sẵn sàng dịch vụ              | SLO nội bộ 99,9% theo tháng sau pilot                           | Có đo uptime, phân loại lỗi và người trực xử lý                                                 |
| Khôi phục cơ sở dữ liệu       | RPO tối đa 15 phút; RTO mục tiêu tối đa 4 giờ                   | Có WAL hoặc PITR phù hợp, diễn tập khôi phục thật                                               |
| Khôi phục tệp                 | RPO mục tiêu tối đa 1 giờ cho tệp thông thường                  | Versioning, backup riêng và đối chiếu metadata; hồ sơ trọng yếu có chính sách chặt hơn          |
| Tính đúng của công            | Không còn sai lệch trọng yếu chưa giải thích khi khóa kỳ        | Đối soát toàn bộ nhóm pilot với HR                                                              |

RPO là mức dữ liệu có thể mất tính theo thời gian; RTO là thời gian mục tiêu để khôi phục. RPO của tệp và cơ sở dữ liệu khác nhau, nên không gọi cả hệ thống có RPO 15 phút. Kiểm thử khôi phục phải đối chiếu tệp và metadata trước mở lại. Một sự cố cần đủ 4 giờ phục hồi sẽ làm vượt SLO 99,9% của tháng đó; SLO vận hành thường ngày không phải bảo đảm mọi thảm họa được giải quyết trong vài chục phút.

Backup hằng ngày không đáp ứng RPO theo phút. Với dịch vụ quản lý sẵn, phải kiểm tra phạm vi sao lưu; chẳng hạn Supabase nêu rõ backup cơ sở dữ liệu không chứa các đối tượng tệp của Storage API. \[19\] Lịch diễn tập đề xuất là trước lần chuyển dữ liệu chính, sau thay đổi quan trọng và ít nhất mỗi quý.

Giám sát cần có tỷ lệ lỗi, độ trễ, tuổi bản ghi chưa đồng bộ, tuổi tác vụ nền, lỗi upload, dung lượng và trạng thái backup. Mỗi cảnh báo có chủ xử lý và runbook. Có môi trường phát triển, thử nghiệm và production tách biệt; dữ liệu thử ưu tiên giả lập hoặc được giảm nhận diện.

# 14 Lộ trình thực hiện và các cổng nghiệm thu

Thời gian tính từ T0 là khi đội bắt đầu dự án và có đầu mối nghiệp vụ. Công việc có thể chạy song song khi đã thống nhất hợp đồng dữ liệu; các cổng nghiệm thu phải được thực hiện đúng thứ tự.

| **Giai đoạn**                    | **Khoảng tuần**               | **Kết quả và điều kiện qua cổng**                                                                                     |
|----------------------------------|-------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| G0 Khảo sát và kiểm tra XBOSS    | 1 đến 2                       | Bản đồ module; danh mục giữ, sửa, bổ sung; mẫu ca; ma trận quyền; UX; dự toán cập nhật                                |
| G1 Nền tảng và website           | 3 đến 6                       | Danh tính, tổ chức, audit, pipeline; CMS, website và luồng yêu cầu khách hàng                                         |
| G2 Chấm công và công việc cơ bản | 5 đến 10                      | Ca, nghỉ, OT, sửa công, duyệt, khóa kỳ, export; giao việc và kế hoạch tuần                                            |
| G3 PWA và tiến độ liên thông     | 9 đến 14                      | Ngoại tuyến, chống trùng, nghiệm thu, giờ dự án, báo cáo; sẵn sàng pilot                                              |
| G4 Pilot và P0 dùng chính thức   | 13 đến 20                     | Đủ một kỳ công thực tế; đối soát; bảo mật, đo tải, restore, đào tạo và chuyển nguồn chính thức                        |
| G5 Hoàn thiện P1                 | Khoảng 8 tuần sau G4          | Gantt và capacity, CRM gọn, chi phí và tài sản cơ bản, tri thức, báo cáo và tích hợp; kết thúc dự kiến tuần 24 đến 28 |
| G6 Mở rộng P2                    | Sau P1 theo quyết định đầu tư | Gói công trường sâu, AI, cổng khách hàng, native hoặc ERP theo phạm vi riêng                                          |

G2 phải tạo được luồng chấm công đến chốt kỳ hoàn chỉnh; không đợi cuối dự án mới thêm phê duyệt sửa công. Pilot bắt đầu ở ngày đầu kỳ công phù hợp sau khi các luồng cốt lõi sẵn sàng. Nếu kỳ đó đã bắt đầu hoặc quy trình chưa đủ, mốc chuyển chính thức được dịch theo kỳ tiếp theo. Với ca phức tạp hoặc sai lệch chưa rõ, thử thêm một kỳ.

## Các nhóm việc có thể làm song song

- Nhóm website và CMS làm việc sau khi chốt nội dung, cấu trúc và hợp đồng tiếp nhận biểu mẫu.

- Nhóm công và nhân sự xây ca, log, nghỉ, OT và quy tắc khóa kỳ.

- Nhóm công việc và PWA xây thao tác nhân viên, tiến độ, nghiệm thu và hàng chờ.

- Tech lead giữ mô hình dữ liệu, quyền, giao dịch, triển khai và kiểm tra tích hợp.

- QA chuẩn bị ca mẫu, trường hợp trái quyền và lỗi mạng ngay từ đầu; người phụ trách nghiệp vụ xác nhận kết quả mong đợi.

Không chia việc để nhiều người cùng sửa một nền dữ liệu chưa thống nhất. Các nhánh nhỏ có đầu ra, phạm vi và bằng chứng nghiệm thu rõ; tích hợp thường xuyên để tránh gom rủi ro vào cuối.

# 15 Nhân lực và ngân sách dự kiến

## Đội thực hiện

| **Vai trò**                     | **Mức tham gia dự kiến**  | **Trách nhiệm**                                  |
|---------------------------------|---------------------------|--------------------------------------------------|
| Product hoặc BA                 | 0,5 người toàn thời gian  | Quy trình, backlog, điều phối nghiệp vụ và UAT   |
| Tech lead kiêm backend          | 1 người                   | Kiến trúc, dữ liệu, bảo mật và tích hợp          |
| Lập trình viên fullstack và PWA | 2 người                   | Website, giao diện, module nghiệp vụ và đồng bộ  |
| QA                              | 1 người                   | Nghiệp vụ, phân quyền, thiết bị và hồi quy       |
| UX và UI                        | 0,5 người ở giai đoạn đầu | Luồng, hệ giao diện và thử với người dùng        |
| DevOps và bảo mật               | 0,2 đến 0,4 người         | Pipeline, backup, giám sát và rà soát triển khai |

Tổng khoảng 5,2 đến 5,4 người quy đổi toàn thời gian ở giai đoạn cao điểm; mức tham gia thay đổi theo giai đoạn. Phía công ty cần một người quyết định sản phẩm, một đầu mối HR và đại diện quản lý nhóm hoặc dự án để xác nhận nghiệp vụ định kỳ. Rà soát pháp lý chuyên sâu hoặc kiểm thử bảo mật bên ngoài được dự trù riêng khi cần.

## Công phát triển và cách quy đổi tiền

Một người-tháng được quy đổi thành 20 ngày công. Ước lượng bao gồm phân tích, thiết kế, phát triển, kiểm thử, tích hợp, tài liệu và hỗ trợ chuyển đổi; không phải chỉ thời gian viết code. Dải dự toán phụ thuộc mức tái sử dụng XBOSS và dữ liệu phải chuyển, được cập nhật sau G0.

Với đội quy đổi khoảng 5,2 đến 5,4 người, đầu trên 40 người-tháng có thể cần sử dụng cửa sổ dự phòng đến khoảng tuần 32 hoặc bổ sung nguồn lực phù hợp. Không cam kết vừa giữ tổng công tối đa vừa hoàn thành trong 28 tuần với cùng đội.

| **Phạm vi**            | **Tổng công dự kiến** | **Ví dụ chi phí với 30 triệu đồng mỗi người-tháng** | **Sau dự phòng ngân sách 20%** |
|------------------------|-----------------------|-----------------------------------------------------|--------------------------------|
| P0 đến dùng chính thức | 20 đến 26 người-tháng | 600 đến 780 triệu đồng                              | 720 đến 936 triệu đồng         |
| Tổng P0 cộng P1        | 32 đến 40 người-tháng | 960 đến 1.200 triệu đồng                            | 1.152 đến 1.440 triệu đồng     |

30 triệu đồng là suất quy đổi giả định để làm mô hình ngân sách, không phải khảo sát lương hoặc báo giá thị trường. Thay bằng chi phí đội thực tế để tính lại. Hàng tổng P0 cộng P1 đã bao gồm P0, không cộng hai hàng với nhau. Phần dự phòng tiền hỗ trợ xử lý bất định và không tự động cấp thêm phạm vi. Thuế, hạ tầng, dịch vụ mua ngoài và gói công trường đầy đủ chưa nằm trong các con số trên.

Nếu phần lõi XBOSS dùng lại được nhiều, tổng công có thể giảm sau kiểm chứng. Nếu thiếu quyền, đồng bộ hoặc migration, phải bổ sung công tương ứng; không lấy việc có sẵn repository làm bằng chứng đã hoàn thành nghiệp vụ. AI hỗ trợ soạn mã và tài liệu, còn chất lượng công, quyền và dữ liệu vẫn cần các cổng kiểm tra.

## Hạ tầng và bảo trì

| **Khoản**            | **Khoảng lập ngân sách**          | **Phạm vi giả định**                                                                                     |
|----------------------|-----------------------------------|----------------------------------------------------------------------------------------------------------|
| Hạ tầng pilot        | 2 đến 4 triệu đồng mỗi tháng      | Tải nhỏ, chạy song song nguồn công hiện có, backup hằng ngày                                             |
| Hạ tầng production   | 6 đến 12 triệu đồng mỗi tháng     | 20 đến 200 người; DB và PITR phù hợp, app, worker, staging, tệp, backup, giám sát và email trong hạn mức |
| Bảo trì và hỗ trợ    | 0,2 đến 0,5 người-tháng mỗi tháng | Vá lỗi, nâng cấp, đối soát vận hành, hỗ trợ và diễn tập; chưa phải trực 24 giờ                           |
| Mở rộng theo sử dụng | Theo đo thực tế                   | Ảnh hoặc video lớn, SMS, AI, chữ ký số, nhiều tích hợp hoặc trực 24 giờ                                  |

Các khoản trên là dự toán kỹ thuật. Giá nhà cung cấp chỉ là một phần của tổng chi phí. Ví dụ tham chiếu ngày 18/10/2026: Supabase Pro bắt đầu từ 25 USD mỗi tháng; cấu hình ví dụ Pro, Small compute và PITR 7 ngày sau compute credit là khoảng 130 USD mỗi tháng. Con số này chưa bao gồm toàn bộ hệ thống. \[17\] \[18\]

# 16 Chuyển dữ liệu pilot và đưa vào vận hành

## Chuẩn bị dữ liệu

Lập danh mục mã nhân viên, đơn vị, quản lý, lịch ca, ngày nghỉ, số dư phép, dự án và việc đang mở. Xác định nguồn dữ liệu chính, chủ sở hữu và thời điểm chốt. Chỉ chuyển dữ liệu cần thiết; giữ bản lưu có quyền truy cập thích hợp cho lịch sử chưa cần đưa vào hệ thống mới.

Import có bước xem trước, kiểm tra trùng, báo lỗi theo hàng, đối chiếu tổng và mã phiên nhập. Import lại cùng bộ không tạo nhân viên hoặc giao dịch trùng. Chạy thử ít nhất một lần trên môi trường thử, đối chiếu số người, số dư phép, phân công và các tổng công quan trọng trước khi chuyển thật.

## Pilot

Chọn khoảng 20 đến 30 người nếu quy mô cho phép, bao gồm HR, quản lý, nhân viên văn phòng hoặc hiện trường, người dùng iPhone, Android và mạng yếu. Với công ty nhỏ hơn, chọn nhóm đủ các tình huống thay vì cố đạt số lượng. Có ca qua ngày hoặc OT khi hoạt động thực tế có các trường hợp này.

Trong pilot, quy trình hiện tại vẫn là nguồn công chính thức; hệ thống mới chạy đối chiếu. Thực hiện ít nhất một kỳ công đầy đủ từ mở đến khóa. Mọi chênh lệch có nguyên nhân và người xử lý; không dùng tỷ lệ đúng 99% để bỏ qua sai lệch có ảnh hưởng tiền lương.

## Chuyển nguồn chính thức

- Ghi rõ thời điểm chuyển, phạm vi đơn vị, người chịu trách nhiệm và cách nhận hỗ trợ.

- Có backup, đối soát dữ liệu cuối, kiểm thử quyền và xác nhận đủ cổng nghiệm thu.

- Đào tạo theo vai trò bằng quy trình thật: nhân viên, quản lý, HR và quản trị.

- Giữ cửa sổ hỗ trợ tăng cường sau chuyển, theo dõi hằng ngày các ngoại lệ công và đồng bộ.

- Rollback ứng dụng không được xóa các lần chấm công mới đã nhận. Giữ nhật ký phát sinh để đối soát hoặc nhập lại khi cần.

- Sau chuyển, hệ thống mới là nguồn chính thức trong phạm vi đã công bố; hệ thống cũ giữ chế độ tham chiếu phù hợp.

# 17 Danh sách nghiệm thu bắt buộc

Chỉ xác nhận hoàn thành khi có bằng chứng chạy được trên môi trường nghiệm thu, kết quả đối soát và người chịu trách nhiệm ký nhận theo vai trò. Nhãn ưu tiên tính năng P0 hoặc P1 không được dùng thay cho mức nghiêm trọng lỗi.

| **Mã** | **Tình huống và kết quả phải đạt**                                                                            | **Chủ xác nhận**      |
|--------|---------------------------------------------------------------------------------------------------------------|-----------------------|
| AT01   | Website nhận một yêu cầu hợp lệ thành đúng một hồ sơ có người phụ trách; bản CMS chưa duyệt không công khai   | Kinh doanh và Product |
| AT02   | Từ chối công, tệp và export ngoài phạm vi được cấp quyền; tài liệu nhóm được chia sẻ hợp lệ vẫn truy cập được | QA và Tech lead       |
| AT03   | Ca qua đêm, nghỉ giữa ca, nhiều lần vào ra và giờ chồng lấn cho đúng kết quả ca mẫu                           | HR                    |
| AT04   | Gửi lặp, gửi lại sau timeout và hai thiết bị không tạo công trùng; giữ đủ sự kiện để điều tra                 | QA                    |
| AT05   | Offline hiển thị chờ và có biên nhận khi gửi; lệch giờ chuyển xác minh; mất quyền bị từ chối áp dụng thao tác | QA và HR              |
| AT06   | Sửa công có trước sau, lý do và người duyệt; log đến muộn không sửa kỳ khóa âm thầm                           | HR                    |
| AT07   | Đơn nghỉ và OT cập nhật công, số dư và lịch nguồn lực đúng; không tự duyệt đơn của mình                       | HR và quản lý         |
| AT08   | Tách giờ có mặt, OT được duyệt và giờ dự án; giải thích được mọi chênh lệch trọng yếu                         | HR và kế toán         |
| AT09   | Việc thiếu điều kiện không hoàn tất; nghiệm thu, trả lại và mở lại đều lưu lịch sử                            | Quản lý dự án         |
| AT10   | Dự án mẫu tính đúng tiến độ thủ công; chia task không tăng tiến độ; cha con không cộng trùng                  | Quản lý dự án và QA   |
| AT11   | Cảnh báo nghỉ hoặc quá tải khi phân công; đổi hạn và baseline giữ lịch sử                                     | Trưởng nhóm           |
| AT12   | Logout và đổi tài khoản không lộ dữ liệu cũ; thu hồi quyền có hiệu lực ở API và điểm tải được bảo vệ          | QA và Tech lead       |
| AT13   | Luồng chính chạy trên iPhone Safari và PWA, Android Chrome và PWA, Chrome hoặc Edge desktop                   | QA                    |
| AT14   | Đạt bài đo tải đã thống nhất, không mất ghi nhận; thông báo lỗi không làm hỏng giao dịch chính                | Tech lead             |
| AT15   | Khôi phục thử được DB, tệp, cấu hình và khóa cần thiết; kiểm tính nhất quán và ghi thời gian thực tế          | DevOps                |
| AT16   | Pilot đủ kỳ công, hết sai lệch trọng yếu, tài liệu và người hỗ trợ sẵn sàng                                   | HR và chủ sản phẩm    |

Không mở rộng production khi còn lỗi nghiêm trọng về rò dữ liệu, mất hoặc tính sai công, ghi trùng, sai quyền, sai kỳ khóa hoặc không khôi phục được. Lỗi nhỏ được ghi nợ với ảnh hưởng, cách xử lý tạm, chủ sở hữu và hạn giải quyết.

# 18 Backlog để giao đội phát triển

Danh sách dưới đây là cấp gói việc để chuyển thành issue và chia sprint. Mỗi gói phải có đầu vào, đầu ra, phụ thuộc, người chịu trách nhiệm và bằng chứng; chi tiết từng màn hình được chốt trong phân tích.

| **Mã** | **Gói việc**                         | **Ưu tiên** | **Phụ thuộc chính**              |
|--------|--------------------------------------|-------------|----------------------------------|
| F01    | Kiểm tra XBOSS và dữ liệu hiện có    | P0          | Bắt đầu                          |
| F02    | Chốt quy tắc ca và bộ ví dụ HR       | P0          | F01                              |
| F03    | Ma trận quyền và danh mục dữ liệu    | P0          | F01                              |
| F04    | Luồng UX và hệ giao diện             | P0          | F02 F03                          |
| F05    | Môi trường pipeline bí mật backup    | P0          | F01                              |
| F06    | Tài khoản tổ chức và phạm vi quyền   | P0          | F03 F05                          |
| W01    | Cấu trúc và nội dung website         | P0          | F04                              |
| W02    | CMS nháp duyệt và phiên bản          | P0          | F06 W01                          |
| W03    | Website SEO hiệu năng và tiếp cận    | P0          | W01 W02                          |
| W04    | Liên hệ tuyển dụng và định tuyến     | P0          | F03 W02                          |
| H01    | Hồ sơ nhân viên và lịch sử đơn vị    | P0          | F06                              |
| H02    | Ca lịch nghỉ và phiên bản chính sách | P0          | F02 H01                          |
| H03    | Sự kiện công QR và chống trùng       | P0          | H02                              |
| H04    | Nghỉ phép OT và sửa công có duyệt    | P0          | H03                              |
| H05    | Tổng hợp đối soát khóa kỳ và export  | P0          | H04                              |
| T01    | Dự án hạng mục nhiệm vụ và mốc       | P0          | F06 F04                          |
| T02    | Kế hoạch tuần phụ thuộc và lịch      | P0          | T01 H02                          |
| T03    | Bằng chứng nghiệm thu và mở lại      | P0          | T01 D01                          |
| T04    | Baseline trọng số và tiến độ         | P0          | T02 T03                          |
| T05    | Giờ dự án và đối chiếu công          | P0          | T01 H05                          |
| D01    | Tệp private phiên bản và kiểm quyền  | P0          | F03 F05 F06                      |
| D02    | Bình luận thông báo và hàng đợi      | P0          | D01 F06                          |
| P01    | PWA cài đặt và màn hình Hôm nay      | P0          | F04 F06                          |
| P02    | Offline hàng chờ và xung đột         | P0          | P01 H03 T03 D02                  |
| P03    | Logout cache và thiết bị dùng chung  | P0          | P02                              |
| R01    | Dashboard công tiến độ và ngoại lệ   | P0          | H05 T04 T05                      |
| Q01    | Tự động kiểm tra quyền và ca mẫu     | P0          | F03 F02 F06 D01 H05              |
| Q02    | Kiểm thử mạng yếu và thiết bị thật   | P0          | P02 P03                          |
| Q03    | Import thử đo tải và restore         | P0          | H05 R01 F05                      |
| Q04    | Pilot đủ kỳ đào tạo và chuyển đổi    | P0          | Q01 Q02 Q03 W03 W04 D02          |
| E01    | Gantt capacity định kỳ và mẫu dự án  | P1          | Q04 T02                          |
| E02    | CRM gọn và liên kết báo giá dự án    | P1          | Q04 W04                          |
| E03    | Đề nghị chi tạm ứng và hạn mức       | P1          | Q04 F06                          |
| E04    | Danh mục tài sản cấp phát thu hồi    | P1          | Q04 H01                          |
| E05    | Tri thức onboarding và bàn giao      | P1          | Q04 D01                          |
| E06    | Tích hợp ưu tiên và báo cáo định kỳ  | P1          | Q04 R01                          |
| X01    | Gói công trường được xác định lại    | P2          | Kiểm tra nghiệp vụ riêng         |
| X02    | AI có nguồn và quyền dữ liệu         | P2          | Dữ liệu vận hành ổn định         |
| X03    | Cổng khách hàng hoặc native          | P2          | Nhu cầu và lợi ích được xác nhận |

Phụ thuộc Q01 là điều kiện để hoàn tất chạy bộ kiểm tra; việc chuẩn bị ca mẫu bắt đầu sớm từ F02 và F03. Với Q04, website và thông báo phải đạt trước khi xác nhận toàn bộ P0; các phần này không ngăn bắt đầu pilot riêng của luồng chấm công khi đã đủ điều kiện.

# 19 Rủi ro quản trị thay đổi và bàn giao

| **Rủi ro**                     | **Biện pháp**                                                              | **Chủ trách nhiệm** |
|--------------------------------|----------------------------------------------------------------------------|---------------------|
| Phạm vi phình thành ERP        | Giữ ranh giới P0 và P1; thêm yêu cầu phải đánh đổi hoặc cập nhật ngân sách | Product             |
| Không đủ phần tái sử dụng      | Kiểm tra theo module ở G0; cập nhật công và migration bằng bằng chứng      | Tech lead           |
| Sai công do quy tắc không rõ   | HR chốt ví dụ đầu vào đầu ra; quản lý phiên bản chính sách                 | HR                  |
| GPS hoặc mạng không tin cậy    | Hàng ngoại lệ, nhiều tín hiệu và kiểm tra tại địa điểm thật                | QA và HR            |
| Rò dữ liệu qua tệp hoặc export | Kiểm quyền xuyên suốt, hạn chế cache, kiểm thử các đường bị cấm            | Tech lead           |
| Mất hoặc trùng khi đồng bộ     | Idempotency, ràng buộc, biên nhận và bài thử lỗi mạng                      | Backend và QA       |
| Dữ liệu nhập sai               | Preview, mã đợt nhập, đối soát và khôi phục                                | Chủ dữ liệu         |
| Nhân viên không dùng           | Hôm nay đơn giản, đào tạo theo vai trò, công bố nguồn chính thức           | Product và quản lý  |
| Phụ thuộc một người            | Runbook và người thứ hai tự diễn tập triển khai khôi phục                  | Tech lead           |
| Chi phí tăng do tệp hoặc AI    | Hạn mức, cảnh báo, thời hạn lưu và tối ưu theo số đo                       | Chủ hệ thống        |

Quy trình phát triển dùng backlog có ưu tiên, nhánh nhỏ, review theo rủi ro và CI kiểm tra những hành vi quan trọng. Mỗi thay đổi được mô tả bằng vấn đề, hành vi mới, bằng chứng và rủi ro. Các agent có thể nghiên cứu hoặc làm phần độc lập; agent chính giữ hợp đồng dữ liệu và chịu trách nhiệm tích hợp. Không coi số lượng agent hoặc số test là thước đo tiến độ.

Bộ bàn giao gồm mã nguồn và hướng dẫn dựng môi trường; đặc tả nghiệp vụ và ma trận quyền; sơ đồ dữ liệu và API tích hợp; migration; bộ ca mẫu và kết quả UAT; hướng dẫn người dùng; runbook triển khai, backup, restore và xử lý sự cố; danh sách tài khoản dịch vụ theo quyền; ngân sách vận hành; backlog chưa hoàn thành. Mọi khoản nợ kỹ thuật có mã, ảnh hưởng, chủ xử lý, biện pháp tạm và hạn rà soát.

Khi kết thúc P1, định nghĩa hoàn thiện là toàn bộ phạm vi đã duyệt vận hành được, có người chịu trách nhiệm, dữ liệu truy vết và khôi phục được, nhân viên dùng được, các sai lệch trọng yếu đã giải quyết. P2 được đầu tư theo lợi ích và mức sẵn sàng, không làm mất ranh giới nghiệm thu của phiên bản đã bàn giao.

# 20 Nguồn tham khảo

Các nguồn dưới đây được kiểm tra ngày 18 tháng 10 năm 2026. Các mốc thời gian, chỉ tiêu chất lượng và chi phí nội bộ trong kế hoạch là đề xuất lập kế hoạch, không phải cam kết của nhà cung cấp. Khi chốt triển khai phải rà soát lại cấu hình, giá và quy định áp dụng.

\[1\] W3C Geolocation. Giới hạn bảo đảm vị trí và cơ chế quyền. [<u>https://www.w3.org/TR/geolocation/</u>](https://www.w3.org/TR/geolocation/)

\[2\] Frappe HR Shift Type. Cấu hình ca và ca qua ngày. [<u>https://docs.frappe.io/hr/shift-type</u>](https://docs.frappe.io/hr/shift-type)

\[3\] Chính phủ và Bộ Nội vụ. Xác định số giờ làm thêm vượt quy định. [<u>https://chinhsachonline.chinhphu.vn/xac-dinh-so-gio-lam-them-vuot-quy-dinh-91336.htm</u>](https://chinhsachonline.chinhphu.vn/xac-dinh-so-gio-lam-them-vuot-quy-dinh-91336.htm)

\[4\] Plane Modules. Tổ chức nhóm công việc. [<u>https://docs.plane.so/core-concepts/modules</u>](https://docs.plane.so/core-concepts/modules)

\[5\] Plane Cycles. Tổ chức chu kỳ thực hiện. [<u>https://docs.plane.so/core-concepts/cycles</u>](https://docs.plane.so/core-concepts/cycles)

\[6\] WebKit. Web Push for Web Apps on iOS and iPadOS. [<u>https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/</u>](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

\[7\] MDN. Background Synchronization API. [<u>https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API</u>](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)

\[8\] WebKit. Updates to Storage Policy. [<u>https://webkit.org/blog/14403/updates-to-storage-policy/</u>](https://webkit.org/blog/14403/updates-to-storage-policy/)

\[9\] Next.js. Hướng dẫn xây PWA. [<u>https://nextjs.org/docs/app/guides/progressive-web-apps</u>](https://nextjs.org/docs/app/guides/progressive-web-apps)

\[10\] OWASP. Authorization Cheat Sheet. [<u>https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html</u>](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

\[11\] PostgreSQL. Row Security Policies. [<u>https://www.postgresql.org/docs/current/ddl-rowsecurity.html</u>](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

\[12\] Cổng văn bản Chính phủ. Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15. [<u>https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroup=</u>](https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroup=)

\[13\] Công báo Chính phủ. Nghị định 356/2025/NĐ-CP. [<u>https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/17/356signed-1768638052103952849513.pdf</u>](https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/17/356signed-1768638052103952849513.pdf)

\[14\] Chính phủ. Bảo vệ dữ liệu người lao động khi chấm dứt hợp đồng. [<u>https://xaydungchinhsach.chinhphu.vn/doanh-nghiep-phai-xoa-du-lieu-ca-nhan-nguoi-lao-dong-khi-cham-dut-hop-dong-119250728094419409.htm</u>](https://xaydungchinhsach.chinhphu.vn/doanh-nghiep-phai-xoa-du-lieu-ca-nhan-nguoi-lao-dong-khi-cham-dut-hop-dong-119250728094419409.htm)

\[15\] W3C. Web Content Accessibility Guidelines 2.2. [<u>https://www.w3.org/TR/WCAG22/</u>](https://www.w3.org/TR/WCAG22/)

\[16\] web.dev. Web Vitals. [<u>https://web.dev/articles/vitals</u>](https://web.dev/articles/vitals)

\[17\] Supabase. Pricing and Fees. [<u>https://supabase.com/pricing</u>](https://supabase.com/pricing)

\[18\] Supabase. Manage Point in Time Recovery usage. [<u>https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery</u>](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery)

\[19\] Supabase. Database Backups. [<u>https://supabase.com/docs/guides/platform/backups</u>](https://supabase.com/docs/guides/platform/backups)

\[20\] Chính phủ. Làm thêm giờ thế nào là đúng quy định. [<u>https://chinhsachonline.chinhphu.vn/lam-them-gio-the-nao-la-dung-quy-dinh-71802.htm</u>](https://chinhsachonline.chinhphu.vn/lam-them-gio-the-nao-la-dung-quy-dinh-71802.htm)
