# LabMana v3 — Kiến trúc Workspace / RBAC / ACL

> Đặc tả gốc: `LabMana_AI_Context.md` (do chủ dự án cung cấp). Tài liệu này mô tả **những gì đã được triển khai trong repo** và những điểm còn mở. Nhãn: **ĐÃ LÀM**, **CẦN XÁC NHẬN**, **GIỚI HẠN**.

## 1. Nguyên nhân lỗi `permission-denied` (điều tra Phase 0)

Rules trong repo (v2) cho phép `config/{id}`; nhưng Rules **đang chạy trên Firebase** là bản khác (chỉ `get` được `config/gemini`, còn mọi đường dẫn khác `deny`). `store.js` v2 gọi `onSnapshot(doc("config","lab"))` ngay khi khởi động → bị từ chối → toast "Lỗi dữ liệu: permission-denied" (store.js:32). Không liên quan đến đăng nhập ẩn danh (anonymous vẫn thỏa `request.auth != null`). `favicon.ico 404` và `runtime.lastError` là nhiễu trình duyệt/extension.
Ở v3 `config/lab` không còn được client đọc (thay bằng `workspace_settings`), và Rules trong repo là **nguồn sự thật duy nhất** — cần Publish đúng file này.

## 2. Mô hình

| Khái niệm | Cách thực hiện |
|---|---|
| Danh tính | Email + mật khẩu (`js/auth.js`). Phiên ẩn danh cũ được **liên kết** (`linkWithCredential`) để giữ nguyên UID, đặc biệt `Eq1ueE9VHoYIbNk3UU5gnQOwJBg1`. Rules từ chối `sign_in_provider == 'anonymous'`. |
| Trạng thái tài khoản | `users/{uid}.status` (`active`/`pending`/`suspended`/`disabled`). Mặc định đăng ký = `active` (**CẦN XÁC NHẬN** — muốn duyệt từng user: đổi một dòng trong Rules + `auth.js`). Super Admin luôn qua. |
| Personal Workspace | Tài nguyên `scope='personal'`, `owner_uid=uid`. Chỉ chủ đọc/ghi; Group Admin và Super Admin **không** đọc. |
| Group Workspace | Tài nguyên `scope='group'`, `group_id`. Quyền từ `memberships/{groupId}__{uid}` (status `active`) **và** `groups/{groupId}.status=='active'`. |
| Role theo nhóm | `memberships.role ∈ {group_admin, member}` — không có role toàn cục. Một UID có thể là admin nhóm A, member nhóm B. |
| Group ID | ID tự sinh của Firestore (không đoán được) + mã hiển thị `LAB-XXXXX`. Biết ID không tạo quyền; không có đường "tự tham gia". |
| Viewer | `resource_shares` (id xác định `u_<uid>__<expId>` / `g_<groupId>__<expId>`) + mảng `shared_user_ids/shared_group_ids` trên tài nguyên. Chỉ đọc, hết hạn/thu hồi có hiệu lực ngay ở lần đọc sau. |

## 3. Ma trận quyền (đã được Rules thực thi)

| Thao tác | Super Admin | Group Admin | Member (người tạo) | Member khác | Viewer |
|---|---|---|---|---|---|
| Duyệt/từ chối yêu cầu lập nhóm, đình chỉ/khôi phục nhóm, đổi Quản trị nhóm | ✔ | ✘ | ✘ | ✘ | ✘ |
| Thêm/xóa Member nhóm mình | ✔ | ✔ | ✘ | ✘ | ✘ |
| Tự phong Group Admin | ✔ (chỉ Super Admin) | ✘ | ✘ | ✘ | ✘ |
| Xem tài nguyên nhóm | ✘ (không mặc định) | ✔ | ✔ | ✔ | chỉ bài được chia sẻ |
| Tạo tài nguyên nhóm | — | ✔ | ✔ | ✔ | ✘ |
| Sửa/xóa kế hoạch (experiments) nhóm | — | ✔ | ✔ (của mình) | ✘ | ✘ |
| Ghi lượt thực hành / nhật ký (runs, execution_logs) | — | ✔ | ✔ | ✔ (sổ ghi chép chung) | ✘ |
| Chia sẻ ra ngoài | giám sát | duyệt/cấp/thu hồi | gửi yêu cầu (pending) | ✘ | ✘ (không chia sẻ tiếp) |
| Đọc Personal của người khác | ✘ | ✘ | ✘ | ✘ | ✘ |

`runs`/`execution_logs` là sổ ghi chép chung của nhóm (nhiều người cùng ghi một lượt) — **CẦN XÁC NHẬN**; muốn siết "chỉ người tạo mới sửa" đổi điều kiện `update` thành `canManageRes(resource.data)` (ghi chú trong Rules).

## 4. Luồng thao tác (đều chạy trong client, Rules là hàng rào)

1. User gửi `group_requests` (pending) → tab **Nhóm**.
2. Super Admin (tab Nhóm → Quản trị hệ thống) duyệt: **một batch** tạo `groups/{id}` + membership `group_admin` + đóng request; ghi `audit_logs`.
3. Group Admin thêm Member bằng email (tra `user_emails/{email}` → uid; người đó phải đã đăng nhập ít nhất một lần). Xóa = `status:'revoked'` (mất quyền ngay).
4. Member rời nhóm = `status:'left'`; tài nguyên đã tạo ở lại nhóm, giữ nguyên `created_by`.
5. Chia sẻ: nút **Chia sẻ** trên bài (`js/sharing.js`). Chủ personal/Group Admin → grant `active` ngay; Member → `pending` chờ duyệt.

## 5. Dữ liệu client (`js/`)

- `workspace.js`: membership/nhóm realtime, workspace hiện tại, `scopeFields()` (gắn vào tài nguyên mới), `scopeWhere()` (ràng buộc truy vấn khớp Rules), `keepOwnership()`.
- `store.js`: mọi listener kèm `scopeWhere()`; **đổi workspace → hủy mọi listener, xóa state, nghe lại** (không rò dữ liệu giữa nhóm). Danh sách "được chia sẻ" đọc từng `experiments/{id}` qua `get`.
- Đăng xuất: `terminate` + `clearIndexedDbPersistence` + xóa `localStorage` tiền tố `labmana` (không để dữ liệu nhóm lại trên máy dùng chung).

## 6. Bảo mật dịch vụ khác

- **Gemini**: khóa API **không còn** trong client/Firestore. `ai.js` → `geminiGenerate()` → Apps Script (`handleGemini_`), khóa ở *Script properties* `GEMINI_API_KEY`. Backup cũ có `config.gemini.apiKey` ⇒ **phải rotate khóa đó** (đã lộ trong file backup/lịch sử).
- **Apps Script** (upload/xóa ảnh, báo cáo, Gemini): mọi `doPost` yêu cầu Firebase ID token; `verifyCaller_` gọi `accounts:lookup` (loại phiên ẩn danh) và đọc `users/{uid}` qua Firestore REST bằng chính token đó (Rules áp dụng) để kiểm tra `active`. Cần Script properties `FIREBASE_WEB_API_KEY`, `GEMINI_API_KEY`.
- **Google Drive**: quyền Drive là lớp riêng. Ảnh vẫn là "ai có link thì xem" — **GIỚI HẠN** đã nêu từ v2; không thay đổi Firestore-share ⇒ không tự cấp quyền Drive.
- `apiKey` Web của Firebase là công khai theo thiết kế; nên giới hạn theo HTTP referrer `kohi-ng.github.io/*` trong Google Cloud Console.

## 7. Giới hạn đã biết (trung thực)

- **Không có backend/Cloud Functions** (giữ "zero-backend", không cần gói Blaze). Các thao tác đặc quyền (duyệt nhóm, gán admin, đình chỉ) chạy từ client Super Admin nhưng **được Rules thực thi** (chỉ UID Super Admin ghi được `groups`, đổi role...). `audit_logs` ghi từ client ⇒ không giả mạo được `actor_uid`, nhưng không ép được "bắt buộc phải ghi". Nếu sau này cần audit bắt buộc/tìm user theo email an toàn hơn → chuyển sang Cloud Functions.
- Chia sẻ tối đa **50 người + 2 nhóm / bài** (Rules ≤ 10 lệnh `get()` mỗi request, không có vòng lặp).
- `user_emails/{email}` cho phép user đã đăng nhập dò xem một email có tài khoản hay không (chỉ `get` từng email, không `list`). Đánh đổi để Group Admin thêm thành viên không cần backend.
- Break-glass cho Super Admin đọc Personal **chưa** làm (spec: "không mặc định"; **CẦN XÁC NHẬN** nếu cần).
- Chia sẻ áp dụng cho **experiments**. Viewer xem kế hoạch, không thấy runs/logs của nhóm nguồn.
- Test Rules (`tests/rules.test.mjs`) chạy trên Firestore Emulator (CI `.github/workflows/rules-test.yml`).

## 8. Quyết định cần xác nhận (spec §16)

| Chủ đề | Hiện triển khai |
|---|---|
| Tạo tài khoản | Email/mật khẩu, tự `active` (không duyệt từng user) |
| Tạo nhóm | Request → Super Admin duyệt |
| Số Group Admin | 1 chính/nhóm (Super Admin đổi được); Rules cho phép Super Admin gán thêm |
| Member chia sẻ ra ngoài | Gửi yêu cầu, Group Admin duyệt |
| Viewer tải/xuất | Không có chức năng xuất cho Viewer |
| Dữ liệu legacy không owner | Gán bằng `migration/migrate.mjs --owner-uid` do chủ dự án chỉ định (không tự đoán) |
| Super Admin đọc Personal | Không |
