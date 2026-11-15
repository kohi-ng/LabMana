# Dựng LabMana v3 trên Firebase + Apps Script MỚI (làm một lần, ~25 phút)

Bản này hoàn toàn độc lập với bản Simple-Version cũ: **Firebase project riêng, Apps Script riêng, repo/URL riêng, dữ liệu riêng** (bắt đầu trống).
Mọi giá trị riêng của dự án nằm ở 3 nơi: `js/config.js`, `firestore.rules` (1 dòng UID) và *Script properties* của Apps Script.

## 0. Chuẩn bị
- Repo GitHub mới (public nếu dùng Pages gói miễn phí) chứa mã này; Settings → Pages → *Deploy from a branch* → `main` / root. URL: `https://<user>.github.io/<repo>/`.
- Một thư mục Google Drive trống cho ảnh; copy **ID thư mục** (đoạn cuối URL `.../folders/<ID>`).
- Khóa Gemini **mới** (Google AI Studio). Không dùng lại khóa cũ.

## 1. Firebase (project mới)
1. https://console.firebase.google.com → **Add project** (tên tùy ý; không cần Google Analytics; **không cần gói Blaze**).
2. **Build → Authentication → Sign-in method → Email/Password → Enable**. Không bật Anonymous.
3. **Authentication → Settings → Authorized domains**: thêm `<user>.github.io` (nếu chưa có).
4. **Build → Firestore Database → Create database** (production mode, chọn region gần nhất, vd `asia-southeast1`).
5. **Project settings → Your apps → `</>` Web** → đăng ký app → copy `firebaseConfig` → dán vào `js/config.js` (cả `apiKey`, `projectId`…).
6. (Khuyến nghị) Google Cloud Console → APIs & Services → Credentials → khóa Browser của project → *HTTP referrers*: `https://<user>.github.io/*`.

## 2. Apps Script (project mới)
1. https://script.google.com → **New project**. Dán 3 file `GAS/code.gs`, `GAS/report.gs`, `GAS/math-render.gs`.
2. **Project Settings → Script properties** thêm:

| Property | Giá trị |
|---|---|
| `ROOT_FOLDER_ID` | ID thư mục Drive ở bước 0 |
| `FIREBASE_PROJECT_ID` | `projectId` của Firebase mới |
| `FIREBASE_WEB_API_KEY` | `apiKey` của Firebase mới |
| `GEMINI_API_KEY` | khóa Gemini mới |
| `SUPER_ADMIN_UID` | điền ở bước 4 (sau khi có UID) |

3. Chạy hàm `authorizeDrive()` một lần, chấp thuận quyền Drive + "kết nối dịch vụ bên ngoài".
4. **Deploy → New deployment → Web app** → *Execute as: Me*, *Who has access: Anyone* → copy URL `/exec` → dán vào `GAS_URL` trong `js/config.js`.
   (Mọi lần sửa `.gs` sau này: *Manage deployments → ✎ → New version*.)

## 3. Tạo tài khoản đầu tiên (để lấy UID Super Admin)
Rules chưa có UID Super Admin nên làm 2 bước:
1. Thay tạm `REPLACE_WITH_SUPER_ADMIN_UID` trong `firestore.rules` bằng chuỗi bất kỳ (vd `pending-setup`), **Publish** Rules (Firebase Console → Firestore → Rules → dán → Publish).
2. Push `js/config.js` đã điền (trừ UID), mở trang → **Đăng ký** bằng email của bạn.

## 4. Gán Super Admin
1. Firebase Console → Authentication → Users → copy **User UID** của tài khoản vừa tạo.
2. Dán UID vào: `SUPER_ADMIN_UID` trong `js/config.js` · dòng `isSuperAdmin()` trong `firestore.rules` (Publish lại) · Script property `SUPER_ADMIN_UID`.
3. Push `js/config.js`, tải lại trang → tab **Nhóm** có mục **Quản trị hệ thống**.

## 5. Kiểm tra nhanh
- Đăng nhập OK; ô chọn không gian ở header hiện "Cá nhân"; tạo một bài trong **Kế hoạch**.
- Tab **Nhóm** → gửi yêu cầu lập nhóm → duyệt trong *Quản trị hệ thống* → thêm thành viên bằng email (người đó phải đăng ký trước).
- Chụp ảnh ở một bước → ảnh lên thư mục Drive (xác nhận Apps Script nhận được token). Tab **AI** trả lời (xác nhận `GEMINI_API_KEY`).
- Chạy test Rules: `npm install && npm run test:rules` (hoặc xem tab Actions).

## 6. Chuyển dữ liệu từ bản cũ (tùy chọn)
Project mới bắt đầu trống. Muốn đưa bài thí nghiệm cũ sang: ở bản cũ dùng **Xuất JSON** trên từng bài, rồi ở bản mới dùng **Nhập JSON** (tab Kế hoạch). Nhật ký thực hiện cũ không chuyển tự động.
