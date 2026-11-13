# LabMana — Thiết kế dữ liệu (Schema v2)

## 0. Những gì đổi so với v1

- **Cấu trúc đặt tên đúng giáo trình**: `sections[]` giờ gọi là "Thí nghiệm" (vd "Thí nghiệm 1:
  tính chất của muối kim loại kiềm thổ"), `steps[]` bên trong là "Thao tác" (thường ứng với các
  mục 1.1/1.2 trong giáo trình). Mỗi thao tác có thể có tiêu đề riêng; để trống thì dùng nội dung
  hướng dẫn làm tiêu đề.
- Mỗi step có thêm `observation` và `explanation` — hai cột đúng như *Mẫu báo cáo thực hành*
  ("HIỆN TƯỢNG QUAN SÁT THỰC TẾ" / "GIẢI THÍCH VÀ PTPƯ MINH HỌA"), mỗi cột có thể bật/tắt và đổi
  nhãn tùy thao tác.
- `images[]` đổi từ mảng URL string sang mảng object `{file_id, url, name}` để quản lý/xóa file
  trên Google Drive. `normalizeExperiment()` vẫn đọc được URL string cũ (bài soạn từ v1) và tự
  bọc thành object tương đương, nên **không cần migrate dữ liệu cũ**.
- `execution_logs` có thêm `observation_text`, `explanation_text`, `photo_file_id` (bên cạnh
  `photo_url` như cũ) để khớp với 2 cột mới và cho phép xóa ảnh trên Drive khi cần.
- `assigned_role` là tên thành viên được ủy quyền từ `config/lab.team_members`; không còn danh
  sách vai trò riêng trong từng bài.
- Ảnh không còn đi qua Cloud Storage — xem mục 7.

## 1. Nguyên tắc

- **Mỗi thao tác (step) có `id` ổn định** (chuỗi ngẫu nhiên, vd `s_k3j9x2a`). Rẽ nhánh và nhật
  ký thực hiện đều tham chiếu bằng `id`, **không** dùng số thứ tự — nên kéo/đổi chỗ thao tác
  không làm hỏng dữ liệu.
- **Thứ tự thực hiện** = thứ tự phẳng hoá (flatten) của `sections[] → steps[]`.
- Mọi thao tác chưa ghi nhận đều có thể mở và thực hiện độc lập; điều kiện rẽ nhánh không khóa
  các bước khác.

## 2. Collection `experiments/{expId}` (tab Kế hoạch)

```jsonc
{
  "schema_version": 2,
  "title": "Bài 1 — Phân nhóm IIA, IIIA",
  "description": "Xác định tính chất của muối, hydroxid kim loại kiềm thổ và nhôm",
  "created_at_ms": 1731484800000,
  "updated_at_ms": 1731484900000,
  "sections": [
    {
      "id": "p_a1b2c3",
      "section_name": "Thí nghiệm 1: tính chất của muối kim loại kiềm thổ",
      "steps": [
        {
          "id": "s_k3j9x2a",
          "title": "Tạo kết tủa với $\\ce{Na2SO4}$",
          "text": "Lấy 3 ống nghiệm... Nhỏ từ từ vào mỗi ống 5 giọt dung dịch $\\ce{Na2SO4}$ 0,1 M.",
          "images": [
            { "file_id": "1AbCDeFGhiJK...", "url": "https://script.google.com/macros/s/AKfycb.../exec?id=1AbCDeFGhiJK...", "name": "ThiNghiem1_20251113_143022.jpg" }
          ],
          "assigned_role": "Người lấy hóa chất",
          "observation": { "enabled": true,  "label": "Hiện tượng quan sát thực tế" },
          "explanation": { "enabled": true,  "label": "Giải thích và PTPƯ minh họa" },
          "require_input": {                                 // null = không cần nhập số liệu định lượng
            "label": "Thể tích NaOH tiêu tốn",
            "unit": "mL",
            "type": "number"                                 // "number" | "text"
          },
          "require_photo": false,
          "branch_logic": [                                  // chỉ khi require_input.type = "number"
            { "op": "<",  "value": 5,  "goto_step_id": "s_warn01" },
            { "op": "<=", "value": 25, "goto_step_id": "s_calc01" }
          ]
        }
      ]
    }
  ]
}
```

**`observation` / `explanation`**: `{enabled: boolean, label: string}`. Khi soạn bài, người
soạn bật/tắt và đổi nhãn tùy thao tác — vd một thao tác chuẩn bị dụng cụ có thể tắt cả hai, một
thao tác quan trọng giữ nguyên nhãn mặc định đúng mẫu báo cáo.

**`images[]`**: mỗi phần tử `{file_id, url, name}`. `file_id` dùng để gọi `action: "delete"` khi
xóa ảnh trên Drive; ảnh hiển thị bằng link thumbnail Drive từ `file_id` (các URL cũ vẫn được dùng
nếu bản ghi không có `file_id`).

**Toán tử (`op`)**: `<`, `<=`, `>`, `>=`, `==`, `!=`.
**`goto_step_id`**: `id` của bước phía sau, hoặc `"__END__"` (kết thúc bài).
**Quy tắc đánh giá**: duyệt `branch_logic` từ trên xuống, điều kiện đầu tiên khớp được áp dụng;
không điều kiện nào khớp → đi tiếp bước kế tiếp.

### Kiểm tra hợp lệ trước khi Lưu (`validatePlan`)
1. Có tên bài, mỗi thí nghiệm có tên và ≥ 1 thao tác.
2. Mỗi thao tác có nội dung "các bước tiến hành"; tiêu đề riêng là tùy chọn.
3. Thao tác có `require_input` phải có `label`.
4. Rẽ nhánh: thao tác phải thu thập kiểu **số**; `value` là số; `goto_step_id` tồn tại và nằm
   **sau** thao tác hiện tại.

## 3. Collection `runs/{runId}` — bản ghi thực hiện tương thích

```jsonc
{ "exp_id": "…", "exp_title": "Bài 1 — Phân nhóm IIA, IIIA", "name": "Bài 1 — Phân nhóm IIA, IIIA", "created_at_ms": 1731484800000 }
```
Ứng dụng tự mở bản ghi gần nhất của thí nghiệm hoặc tạo bản ghi khi người dùng chọn kế hoạch.
Giao diện không yêu cầu chọn lượt; các thiết bị mở cùng thí nghiệm dùng chung bản ghi gần nhất.

## 4. Collection `execution_logs/{runId}__{stepId}`

```jsonc
{
  "exp_id": "…", "run_id": "…", "step_id": "s_k3j9x2a", "step_label": "2.3",
  "executed_by_name": "Nguyễn Văn A",     // thành viên được ủy quyền hoặc chọn khi bấm Lưu
  "input_data": 18.45,                    // số (type number) hoặc chuỗi (type text) hoặc null
  "input_unit": "mL",
  "observation_text": "Xuất hiện kết tủa trắng, tan dần khi thêm HCl...",   // "" nếu cột bị tắt
  "explanation_text": "$\\ce{BaCl2 + Na2SO4 -> BaSO4v + 2NaCl}$ ...",        // "" nếu cột bị tắt
  "photo_url": "https://drive.google.com/thumbnail?id=...&sz=w1600", // hoặc null; legacy URL/data URL vẫn đọc được
  "photo_file_id": "1XyZ...",                                               // hoặc null — để xóa trên Drive
  "timestamp": "<serverTimestamp>", "timestamp_ms": 1731485000000
}
```
ID tài liệu cố định = `runId__stepId` ⇒ **mỗi thao tác chỉ có 1 bản ghi**, sửa lại = ghi đè
(không phát sinh bản trùng). Tên người thực hiện được lưu dạng **chuỗi chụp lại tại thời điểm
lưu**, nên đổi tên thành viên sau này không làm thay đổi lịch sử.

## 5. Document `config/lab` (không đổi)

```jsonc
{ "team_members": ["Nguyễn Văn A", "Trần Thị B"] }
```
Thêm/xóa dùng `arrayUnion/arrayRemove` (an toàn khi nhiều thiết bị sửa cùng lúc); đổi tên dùng
transaction.

## 6. Tương thích ngược với dữ liệu v1

`normalizeExperiment()` tự nhận diện và bù dữ liệu cũ:
- `images: ["https://..."]` (mảng string) → tự bọc thành `[{file_id: "", url: "https://...", name: ""}]`.
- Thiếu `observation`/`explanation` → mặc định `{enabled: true, label: "<nhãn chuẩn>"}`.
- `title` của step cũ thiếu → mặc định rỗng, giao diện dùng `text` làm tiêu đề.
- `roles` cũ được bỏ qua; `assigned_role` giữ nguyên và có thể thay bằng tên trong Cài đặt.
- Mọi bài soạn từ v1 mở lên trong v2 vẫn hiển thị và lưu được bình thường, không cần script migrate.

## 7. Lưu trữ ảnh — Google Drive qua Apps Script (thay Cloud Storage)

Ảnh **không** còn lưu trên Firebase Cloud Storage (tránh yêu cầu nâng gói Blaze). Thay vào đó:

- Client (`js/drive.js`) gửi ảnh nguyên bản dạng base64 trong form ẩn tới một **Google Apps
  Script Web App** (`code.gs`) do người deploy tự host trên tài khoản Google Drive của họ. Tên file
  tùy chọn được gửi cùng ảnh; để trống thì máy chủ tự tạo tên theo bước và thời gian. Iframe
  trả xác nhận qua `postMessage` để tránh lỗi CORS khi Apps Script chuyển hướng.
- Khi cập nhật `code.gs`, triển khai một phiên bản Web App mới để tên file tùy chỉnh được áp dụng.
- Script lưu file vào thư mục con đặt tên theo Bài / Thí nghiệm / Lượt, set quyền
  "Anyone with the link — Viewer", và trả về
  `{file_id, url, name}`. Ảnh dùng đường dẫn thumbnail Drive; `code.gs` chỉ xử lý upload/xóa và
  tương thích đường dẫn ảnh cũ.
- Bình thường Firestore lưu `photo_file_id` và URL. Nếu upload ảnh thực hiện bước nhưng trình
  duyệt không nhận được xác nhận từ Apps Script, client giữ ảnh gốc dưới dạng data URL trong
  `photo_url` để không mất kết quả; ảnh này không được xác nhận đã lưu trên Drive.
- Xóa ảnh trong app gọi `action: "delete"` → Apps Script chuyển file vào Thùng rác Drive của
  người deploy.

```
plan_images (Drive)   KeHoach/<Tên bài>/<Tên thí nghiệm>_<timestamp>.jpg
lab_photos  (Drive)   ThucHien/<Tên bài>/<Tên lượt>/<Nhãn bước>_<Tên thí nghiệm>_<timestamp>.jpg
```