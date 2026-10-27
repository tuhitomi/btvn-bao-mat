# Kết quả kiểm tra ngày 24/10/2026

Đã chạy trên Windows với Node.js **v24.20.0**. Toàn bộ thay đổi vẫn chưa stage, chưa commit và chưa push.

## Kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| `npm run check` | Cú pháp JavaScript hợp lệ |
| `npm test` | **12/12 test đạt**, không bỏ qua test nào |
| `npm audit --omit=dev` | **0 lỗ hổng được npm báo cáo** tại thời điểm chạy |
| `docker compose config --quiet` | Cấu hình Compose hợp lệ |
| E2E với MinIO thật | **7/7 nhóm kiểm tra đạt** |

E2E chạy ba tiến trình Node riêng (User, Order, Gateway), cùng MinIO được biên dịch trực tiếp từ source upstream commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` bằng Go 1.27.3. Không dùng storage giả trong E2E. Go được tải từ go.dev và đối chiếu SHA-256 của nhà phát hành trước khi sử dụng.

Bảy nhóm đã kiểm tra:

1. Request thiếu JWT bị từ chối.
2. Routing đúng và không giả mạo được user qua query hoặc header.
3. Dashboard tổng hợp đúng hồ sơ và đơn hàng.
4. Upload/read ảnh thật qua MinIO: PUT URL có hạn 300 giây, không cấp GET hoặc quyền ghi key khác; dùng lại PUT URL staging không thay đổi ảnh đã duyệt.
5. File giả định dạng ảnh bị từ chối khi complete.
6. File lớn hơn 5 MiB bị từ chối khi complete.
7. Gửi 11 request trong một giây: 10 thành công, 1 bị chặn HTTP 429.

Chi tiết lần chạy: [reports/e2e.json](../reports/e2e.json). Các báo cáo ở `reports/` nằm trên máy và được gitignore.

## Độ trễ đo được

50 mẫu thành công cho mỗi đường đi, làm nóng 5 lần, gọi tuần tự theo cặp và xen kẽ thứ tự. Giữ nguyên JWT và rate limit của gateway; nghỉ 140 ms giữa các cặp.

| Đường đi | Trung bình | p50 | p95 |
|---|---:|---:|---:|
| Gọi thẳng User service | 11,379 ms | 10,504 ms | 19,809 ms |
| Qua Gateway + JWT | 21,419 ms | 21,221 ms | 33,010 ms |

Gateway tăng trung bình **10,040 ms** trong lần chạy này. Đây là phép đo HTTP loopback trên máy Windows, không phải kết quả tải production. [Báo cáo](../reports/latency.md), [mẫu JSON](../reports/latency.json), [mẫu CSV](../reports/latency.csv).

## Phần chưa kiểm chứng bằng container

Docker Desktop trên máy gặp lỗi khởi động backend liên quan `sailor-ingest.sock`; Linux engine không hoạt động. Vì vậy chưa build hoặc chạy toàn bộ stack container trên máy này. Đã kiểm tra cú pháp Compose, xác minh digest của các image nền và chạy toàn bộ E2E bằng các tiến trình native với MinIO thật. Cấu hình MinIO build từ source đã pin commit, tránh phụ thuộc vào image Docker Hub đã bị gỡ.
