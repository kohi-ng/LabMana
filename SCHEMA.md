# LabMana — Thiết kế dữ liệu (Schema v3)

## 00. Schema v3 — Workspace / RBAC / ACL (đọc phần này trước)

Phần nội dung step/experiment (mục 1–2, 6–7 bên dưới) **không đổi**. v3 thêm metadata phạm vi + các collection phân quyền.
Quy tắc thực thi nằm ở `firestore.rules`; giải thích ở `docs/ARCHITECTURE.md`.

### Trường phạm vi — bắt buộc trên `experiments`, `runs`, `execution_logs`

```jsonc
{ "scope": "personal" | "group",
  "group_id": null | "<groupId>",     // bắt buộc khi scope = group
  "owner_uid": "<uid>",               // người tạo ban đầu; không đổi được
  "created_by": "<uid>" }             // giữ nguyên khi người khác ghi tiếp (lịch sử)
```
- Client **không** được đổi `scope/group_id/owner_uid/created_by` sau khi tạo (Rules từ chối).
- `runs` phải cùng `scope/group_id` với `experiments` cha; `execution_logs` cùng với `runs` cha (Rules kiểm tra bằng `get()`).
- Truy vấn phải kèm `where("scope"…)` + `where("group_id"|"owner_uid"…)` — Rules không phải bộ lọc (`workspace.js: scopeWhere()`).
- `experiments` thêm tùy chọn `shared_user_ids: string[]` (≤50) và `shared_group_ids: string[]` (≤2) — chỉ người duyệt chia sẻ sửa được.
- Id `runs` = `experiment_<expId>` (một lượt dùng chung trong workspace); `execution_logs` = `<runId>__<stepId>` như cũ.

### Collection mới

| Path | Nội dung | Ghi chú |
|---|---|---|
| `users/{uid}` | `uid, email, display_name, status(active/pending/suspended/disabled), created_at_ms, updated_at_ms, last_login_ms` | user tự tạo (status `active`); chỉ Super Admin đổi `status` |
| `user_emails/{emailLowercase}` | `uid, email, updated_at_ms` | tra uid để thêm thành viên; chỉ `get` từng email |
| `group_requests/{id}` | `requested_name, description, requested_by, requested_email, proposed_admin_uid, status(pending/approved/rejected), reason, reviewed_by, reviewed_at_ms, group_id` | Super Admin duyệt |
| `groups/{groupId}` | `name, description, code (LAB-XXXXX), status(active/suspended), created_by, admin_uid, approved_by, approved_at_ms` | id tự sinh; không xóa vật lý |
| `memberships/{groupId}__{uid}` | `uid, group_id, role(group_admin/member), status(active/revoked/left), email, display_name, added_by, joined_at_ms` | **nguồn sự thật** về quyền nhóm |
| `workspace_settings/{personal_<uid> | group_<groupId>}` | `team_members[], team_ids{}, updated_at_ms` | thay `config/lab` (theo workspace) |
| `resource_shares/{u_<uid>__<expId> | g_<groupId>__<expId>}` | `resource_collection, resource_id, resource_path, source_scope, source_group_id, source_owner_uid, recipient_type(user/group), recipient_id, permission:'read', status(pending/active/rejected/revoked), created_by, approved_by, expires_at, title` | grant Viewer |
| `audit_logs/{id}` | `actor_uid, actor_email, action, target_type, target_id, group_id, detail, timestamp_ms` | chỉ thêm; Super Admin / Group Admin đọc |
| `config/*` | (cũ) | chỉ Super Admin đọc để migrate; **không còn lưu khóa API** |

### Chỉ mục
Mọi truy vấn dùng so sánh bằng (`==`) nên không cần composite index; `audit_logs` chỉ `orderBy(timestamp_ms)` (index đơn tự động).

### Migration từ v2
Dữ liệu v2 chưa có `scope` ⇒ bị Rules ẩn cho tới khi chạy `migration/migrate.mjs --owner-uid <UID> [--group <id>] --apply`
(thêm trường, không xóa; idempotent; backup trước). `config/lab.team_members/team_ids` → `workspace_settings/personal_<uid>`
(hoặc `group_<id>`). `config/lab.team_profiles` không dùng trong code nên không được chuyển.

---

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
  `photo_url` như cũ) và mảng `photos[]` để gắn nhiều ảnh cho một thao tác. Hai trường ảnh cũ
  vẫn giữ ảnh đầu tiên để tương thích dữ liệu và chức năng cũ.
- Mỗi ảnh trong `photos[]` có dạng `{file_id, url, name}`; dữ liệu cũ chỉ có `photo_url` /
  `photo_file_id` vẫn được đọc như một ảnh.
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
            { "file_id": "1AbCDeFGhiJK...", "url": "https://drive.google.com/thumbnail?id=1AbCDeFGhiJK...&sz=w1600", "name": "ThiNghiem1_20251113_143022.jpg" }
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

## 3. Collection `runs/{runId}` — bản ghi thực hiện (kèm trường phạm vi v3 ở mục 00)

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
  "photos": [{"file_id":"1XyZ...","url":"https://drive.google.com/thumbnail?id=...","name":"mau-sac.jpg"}],
  "timestamp": "<serverTimestamp>", "timestamp_ms": 1731485000000
}
```
ID tài liệu cố định = `runId__stepId` ⇒ **mỗi thao tác chỉ có 1 bản ghi**, sửa lại = ghi đè
(không phát sinh bản trùng). Tên người thực hiện được lưu dạng **chuỗi chụp lại tại thời điểm
lưu**, nên đổi tên thành viên sau này không làm thay đổi lịch sử.

## 5. (v2, đã thay) `config/lab` → `workspace_settings/{…}` (xem mục 00)

```jsonc
{ "team_members": ["Nguyễn Văn A", "Trần Thị B"],
  "team_ids": { "Nguyễn Văn A": "123456" } }   // MSSV theo tên; thành viên chưa có MSSV thì không có khóa
```
Thêm/xóa dùng `arrayUnion/arrayRemove` (an toàn khi nhiều thiết bị sửa cùng lúc); sửa tên/MSSV dùng
transaction. `team_members` vẫn là mảng tên (tương thích dữ liệu cũ); `team_ids` là trường thêm, có thể vắng.

## 6. Tương thích ngược với dữ liệu v1

`normalizeExperiment()` tự nhận diện và bù dữ liệu cũ:
- `images: ["https://..."]` (mảng string) → tự bọc thành `[{file_id: "", url: "https://...", name: ""}]`.
- Thiếu `observation`/`explanation` → mặc định `{enabled: true, label: "<nhãn chuẩn>"}`.
- `title` của step cũ thiếu → mặc định rỗng, giao diện dùng `text` làm tiêu đề.
- `roles` cũ được bỏ qua; `assigned_role` giữ nguyên và có thể thay bằng tên trong Cài đặt.
- Mọi bài soạn từ v1 mở lên trong v2 vẫn hiển thị và lưu được bình thường, không cần script migrate.

## 7. Lưu trữ ảnh — Google Drive qua Apps Script (thay Cloud Storage)

Ảnh **không** còn lưu trên Firebase Cloud Storage (tránh yêu cầu nâng gói Blaze). Thay vào đó:

- Client (`js/drive.js`) gửi ảnh dạng base64 bằng `fetch()` (POST JSON, `Content-Type: text/plain`) tới **Google Apps Script Web App**. Ba file `GAS/code.gs`, `GAS/report.gs`, `GAS/math-render.gs` phải cùng một project. `doPost` trả JSON qua `ContentService` — không còn iframe/`postMessage`.
- Ảnh JPEG/PNG/GIF ≤ 2 MB được giữ nguyên. Ảnh khác hoặc nặng hơn được trình duyệt vẽ lại thành JPEG ≤ 2 MB trước khi upload, vì Google Docs chỉ nhúng ba định dạng đó. HEIC mà trình duyệt không giải mã được vẫn lưu nguyên bản và trong Docs chỉ còn link.
- Tên file tùy chọn được gửi cùng ảnh; để trống thì máy chủ tự tạo tên theo bước và thời gian. Sau khi sửa bất kỳ file `.gs` nào, phải triển khai **New version** thì URL Web App mới chạy code mới.
- Script lưu file vào thư mục con, set quyền "Anyone with the link — Viewer", và trả về `{file_id, url, name}`. `url` là thumbnail Drive (`https://drive.google.com/thumbnail?id=...&sz=w1600`).
- Bình thường Firestore lưu `photo_file_id` và URL. Nếu upload ảnh thực hiện bước nhưng trình duyệt không nhận được xác nhận từ Apps Script, client giữ ảnh gốc dưới dạng data URL trong `photo_url` để không mất kết quả; ảnh này không có `file_id` nên báo cáo không nhúng được.
- Xóa ảnh trong app gọi `action: "delete"` → Apps Script chuyển file vào Thùng rác Drive của người deploy.
- Xuất báo cáo gọi `action: "create_report"`. Cột “Thí nghiệm” ghi đúng `section` mà web xem trước đang hiện (`1. Tên thí nghiệm`), không rút thành `TN1`. Ảnh của một thao tác được nhúng trong cột hiện tượng của đúng thao tác đó, ngay dưới hiện tượng cùng thứ tự (dòng hoặc đoạn). Bảng Markdown (`|...|`) được vẽ trong cả ba cột nội dung, cùng quy tắc với `richHtml()` — kể cả bảng một dòng. Công thức `$...$` / `\ce{...}` được đổi sang Unicode vì Docs không chạy KaTeX.

```
KeHoach/<Tên bài>/<Tên bài>_<Tên thí nghiệm>_<tên tùy chọn>_<yyyyMMdd_HHmmss>.<ext>
ThucHien/<Tên bài>/<Tên lượt>/<Tên bài>_<Tên thí nghiệm>_<Nhãn bước>_<tên tùy chọn>_<yyyyMMdd_HHmmss>.<ext>
```