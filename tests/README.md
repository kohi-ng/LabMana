# Kiểm thử mô phỏng 3D (Bước 4/4 · Pha chế)

Chạy bằng Node + Chromium headless (WebGL phần mềm), không cần GPU, không cần build.

```bash
mkdir -p /tmp/lab3d-deps && cd /tmp/lab3d-deps && npm init -y
npm i three@0.149.0 gsap@3.12.5 puppeteer-core @sparticuz/chromium@123
cd <thư mục repo>
NM_DIR=/tmp/lab3d-deps/node_modules OUT=/tmp/lab3d-out node tests/lab3d.test.mjs all
```

Tham số: `audit` · `numbers` · `seek` · `ui` · `all`.

| Bộ | Kiểm tra |
|---|---|
| `audit` | Không xuyên thấu/chồng chéo giữa các dụng cụ (hộp bao định hướng + SAT, mẫu 0,1 s) cho 7 kịch bản: cân chất rắn (thể tích/khối lượng), pha loãng (micropipet/pipet/ống đong), theo khối lượng, chất có màu |
| `numbers` | Số trên cân (LCD), thể tích bình, thể tích dụng cụ khớp kết quả `computeMix`; góc nghiêng rót đơn điệu theo thể tích |
| `seek` | Cùng thời điểm → cùng trạng thái dù tua từ phía trước, phía sau hay ngẫu nhiên |
| `ui` | Phát/tạm dừng, bước trước/tiếp, chương, thanh tua, tốc độ, lặp, góc nhìn, phím tắt, hủy |

Lưu ý: GPU phần mềm chậm nên test chờ theo điều kiện; kết quả không phản ánh hiệu năng trên điện thoại thật.
