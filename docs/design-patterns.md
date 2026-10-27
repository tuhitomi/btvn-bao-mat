# Giải thích bài làm

## Routing

Client dùng một địa chỉ `http://localhost:8080`. Gateway có danh sách route cố định, không nhận URL backend từ client. `/users` gọi User, `/orders` gọi Order; cấu trúc nội bộ không xuất hiện trong hợp đồng API client.

## Offloading

Gateway xác thực JWT một lần rồi chuyển danh tính đã xác thực tới service. Token dùng RS256: User ký bằng private key, Gateway kiểm tra bằng public key. Gateway kiểm tra issuer và audience để không chấp nhận token của ứng dụng khác, bắt buộc hạn dùng và từ chối thuật toán khác. Mọi endpoint ứng dụng, kể cả login hoặc request có token sai, đều chịu giới hạn 10 request trong mỗi cửa sổ trượt 1 giây theo peer IP. `/health` là ngoại lệ liveness.

Service không tin danh tính do client tự khai. Ngoài việc không publish port, User/Order đòi khóa nội bộ. Gateway tự tạo header, không sao chép các header định danh từ request ngoài vào. Khóa này là biện pháp bổ sung của lab; chưa phải xác thực mạnh giữa các workload bằng mTLS.

## Aggregation

`GET /dashboard` đọc `sub` từ JWT và gọi đồng thời `/users/me`, `/orders`. `Promise.allSettled` giữ được dữ liệu của service còn sống. Mỗi lời gọi có timeout 2 giây. Trả `partial: true` nếu thiếu một phần, `null` cho phần bị lỗi và mã service trong `errors`. Nếu cả hai phần đều lỗi, HTTP 503. Gateway chỉ kết hợp dữ liệu; việc chọn đơn hàng của user do Order thực hiện.

Luồng lỗi có thể thử bằng `docker compose stop order` rồi gọi dashboard, sau đó `docker compose start order`. Các kiểm thử tự động cũng dựng upstream trả lỗi và upstream không trả lời để xác minh các nhánh này mà không làm gián đoạn hệ thống đang chạy.

## Valet Key

1. Client đăng nhập và xin quyền upload từ `/users/me/avatar/upload-url`.
2. User tạo key ngẫu nhiên dưới `pending/<sub>/...`, lưu ticket có owner, loại ảnh, hạn dùng; trả PUT URL được ký cho endpoint MinIO client truy cập được, hiệu lực 300 giây.
3. Client PUT file trực tiếp tới MinIO; gateway không trung chuyển file.
4. Client gọi `/users/me/avatar/complete`. User kiểm tra owner và hạn ticket, đọc object từ MinIO, kiểm tra giới hạn dung lượng và magic bytes.
5. User ghi chính các byte đã kiểm tra vào key `approved/<sub>/...` mới, xóa staging, lưu con trỏ avatar và trả URL đọc ngắn hạn. PUT URL staging còn sống không thể sửa key đã duyệt.

URL có chữ ký là bearer capability: ai biết URL cũng có quyền tương ứng trong thời hạn của nó. Do đó request log không ghi query string, Authorization header hay body. PUT URL không cấp quyền GET/LIST. Chữ ký gắn với bucket, key, thao tác và hostname; thời hạn upload không phải thời hạn lưu trữ ảnh.

## Phép đo

Đường trực tiếp: công cụ đo -> User service với khóa nội bộ và identity. Đường gateway: công cụ đo -> Gateway kiểm JWT, rate limit, định tuyến -> cùng User service. Cả hai trả cùng hồ sơ `user-1`. Phần tăng thêm phản ánh bước mạng cục bộ và xử lý tại gateway trong lần chạy cụ thể, không khái quát thành benchmark production.

Chương trình xen kẽ thứ tự để giảm thiên lệch, làm nóng kết nối và báo phân vị từ các phản hồi thành công. Các request 429 hoặc lỗi không được đưa vào thống kê như thể là request thành công. Số liệu thô được lưu để kiểm tra lại.
