# LabMana v3 — Web App quản lý thực hành Thí nghiệm Hóa Vô Cơ (Zero-Backend)

SPA thuần HTML/CSS/JS (ES Modules), dữ liệu chữ/số/trạng thái trên **Firestore**, ảnh tải lên **Google Drive**
qua **Google Apps Script Web App**. Deploy thẳng lên GitHub Pages (`https://kohi-ng.github.io/LabMana/` — giữ nguyên URL).

**Từ v3**: đăng nhập **Email + mật khẩu**, mỗi người có **Personal Workspace** và có thể tham gia nhiều **Group Workspace**
với vai trò theo từng nhóm (Super Admin / Group Admin / Member) + chia sẻ chéo nhóm chỉ-đọc (**Viewer**). Quyền được
**Firestore Rules thực thi** — không chỉ ẩn nút trên giao diện. Chi tiết: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tiến độ & bối cảnh (cập nhật 2026-11-15)

| Hạng mục | Trạng thái |
|---|---|
| Điều tra `permission-denied` | ✔ Nguyên nhân: Rules đang chạy chặn `config/lab` mà `store.js` v2 đọc ngay khi khởi động (xem ARCHITECTURE §1) |
| Auth email/mật khẩu, nâng cấp phiên ẩn danh giữ UID | ✔ code xong (`js/auth.js`, `js/auth-ui.js`) — **cần bật Email/Password trong Firebase Console** |
| Workspace cá nhân/nhóm + bộ chọn trên header | ✔ (`js/workspace.js`, `js/store.js`) |
| Yêu cầu lập nhóm → Super Admin duyệt → Group Admin thêm/xóa Member | ✔ (`js/tabs/groups.js`) |
| RBAC theo nhóm + ACL chia sẻ Viewer + Firestore Rules v3 | ✔ (`firestore.rules`, `js/sharing.js`) |
| Gemini qua Apps Script (khóa không còn ở client/Firestore) | ✔ code xong — **cần đặt Script properties + deploy phiên bản mới** |
| Apps Script xác minh Firebase ID token | ✔ code xong (`GAS/code.gs`) — cần deploy |
| Migration dữ liệu cũ (dry-run, idempotent) | ✔ `migration/migrate.mjs` — **chưa chạy trên production** |
| Test Rules (Emulator) | ✔ viết xong `tests/rules.test.mjs` + CI — **chưa chạy được trong môi trường phát triển (không tải được emulator); chạy `npm run test:rules` / xem tab Actions** |
| Cloud Functions / audit bắt buộc | ✘ chủ ý chưa làm (giữ zero-backend, xem giới hạn trong ARCHITECTURE §7) |

### Việc chủ dự án phải làm để v3 chạy (thứ tự quan trọng)

1. **Rotate khóa Gemini** (khóa cũ từng nằm trong `config/gemini` và file backup). Tạo khóa mới ở Google AI Studio.
2. Apps Script: *Project Settings → Script properties* thêm `FIREBASE_WEB_API_KEY` (= `apiKey` trong `js/firebase.js`) và `GEMINI_API_KEY` (khóa mới); dán lại 3 file `GAS/*.gs`; chạy `authorizeDrive()` lần nữa (quyền "kết nối dịch vụ bên ngoài"); **Deploy → Manage deployments → New version** (giữ nguyên URL).
3. Firebase Console → Authentication → Sign-in method → bật **Email/Password** (giữ Anonymous đến khi chuyển xong).
4. **Chạy migration trước khi Publish Rules mới** (Rules mới ẩn dữ liệu chưa có `scope`):
   `cd migration && npm install && node migrate.mjs --owner-uid Eq1ueE9VHoYIbNk3UU5gnQOwJBg1` (dry-run) rồi thêm `--apply`.
5. Publish `firestore.rules` (Firebase Console → Firestore → Rules). Push code lên GitHub Pages.
6. Mở app trên **thiết bị đang giữ phiên của bạn** → bấm **Tạo tài khoản (giữ dữ liệu)** → email + mật khẩu: UID Super Admin được giữ nguyên.
7. Sau khi mọi thiết bị đã chuyển: tắt Anonymous sign-in; xóa `config/gemini` (`--delete-gemini-config`).
8. (Khuyến nghị) Google Cloud Console → Credentials → giới hạn Web API key theo referrer `kohi-ng.github.io/*`.

## Có gì mới ở v2 (vẫn áp dụng)

- **Khung soạn bài theo đúng chuẩn giáo trình**: Bài → **Thí nghiệm** (section) → **Thao tác**
  (step, kiểu 1.1/1.2…), có tiêu đề riêng tùy chọn (hỗ trợ công thức hóa học) và mỗi thao tác khi thực hiện ghi nhận đúng 2 cột của
  *Mẫu báo cáo thực hành*: **"Hiện tượng quan sát thực tế"** và **"Giải thích và PTPƯ minh
  họa"** — có thể bật/tắt từng cột theo nhu cầu của từng thao tác. Một khung soạn bài dùng
  được cho mọi bài trong giáo trình (Bài 1 → Bài 9), không cần sửa code.
- **Ủy quyền theo từng thao tác**: người soạn chọn thành viên trong Cài đặt ở ngay bước cần giao;
  phần phân vai chung ở đầu bài không còn cần thiết.
- **Ảnh ưu tiên Google Drive**, không qua Firebase Storage. Nếu Apps Script lưu ảnh nhưng không
  gửi được xác nhận về trình duyệt, ảnh chụp vẫn được giữ kèm nhật ký để không chặn bước (trường
  hợp dự phòng có thể làm ảnh lưu trong Firestore lớn hơn). Tên ảnh gồm tên bài, thí nghiệm/bước,
  tên tùy chọn (nếu nhập) và thời gian; link Drive hiển thị dưới ảnh kèm nút sao chép.
  `GAS/code.gs` nhận/xóa ảnh; sau khi đổi mã cần triển khai phiên bản mới của Apps Script Web App.
- **Thành viên nhóm** (Cài đặt): nhập `Họ tên - MSSV` (nhiều người cách nhau bằng dấu phẩy); MSSV lưu ở
  `config/lab.team_ids` và bổ sung/sửa được bằng nút ✎.
- **Xuất báo cáo** trong Cài đặt: ô `Họ và tên - MSSV` tự điền từ danh sách thành viên (bấm vào để sửa), ô
  `Bài số` tự lấy tên bài làm mặc định và được in nguyên văn thay cho dòng “BÀI SỐ: …”; nhập thêm nhóm,
  ngày và học kỳ/năm học; chọn bài để xem trước mẫu HTML hoặc tạo Google Docs từ nhật ký. Ảnh Drive được chèn vào cột hiện tượng.
  Phần “Nội dung ghép vào báo cáo” cho phép bật/tắt số liệu, hiện tượng, giải thích và ảnh. Cột “Các bước
  tiến hành” gồm số bước (in đậm), tiêu đề và hướng dẫn thao tác. Ảnh của mỗi bước
  được gắn ngay dưới hiện tượng tương ứng khi số ảnh khớp số dòng hoặc số đoạn trong ô đó; sau khi tạo có nút mở Google Docs.
  Apps Script project cần đủ `GAS/code.gs`, `GAS/report.gs` và `GAS/math-render.gs`; triển khai phiên bản mới sau khi sửa.
- **Giao diện Apple-style sáng**: nền trắng/xám sáng, bo góc mềm, không dùng biểu tượng ở thanh tab.
- **Tab Quy trình**: danh sách bài đã lên kế hoạch; chọn bài rồi dùng các nút tròn dưới tên bài để
  chuyển thí nghiệm và các nút bước để chuyển thao tác. Màn hình chỉ hiện thao tác đang chọn, không
  phải cuộn qua danh sách nhiều bước. Menu **Tiến trình** cũng mở thẳng tới thí nghiệm/thao tác.
- **Pha chế** (tính pha dung dịch + quy đổi đơn vị) là một tab riêng ở thanh dưới; **AI** là tab chat Gemini (gọi qua Apps Script, khóa ở Script properties)
  nhanh mà không rời khỏi tab đang làm — mở rộng danh mục hóa chất theo đúng các chất dùng
  xuyên suốt giáo trình (KMnO₄, K₂Cr₂O₇, Na₂S₂O₃·5H₂O, phèn nhôm-kali, muối Mohr…).

## Cấu trúc

```
index.html            khung + topbar (logo = Tiến trình, Kế hoạch, Cài đặt) + Bottom Nav 3 tab (Quy trình, Pha chế, AI)
css/style.css         giao diện Apple-style sáng, mobile-first
js/app.js             điều hướng tab, trạng thái kết nối, FAB sheet
js/firebase.js        ⚙️ firebaseConfig; khởi tạo Auth + Firestore (cache ngoại tuyến)
js/auth.js            đăng nhập email/mật khẩu, nâng cấp phiên ẩn danh (giữ UID), hồ sơ users/{uid}, đăng xuất + xóa cache
js/auth-ui.js         màn hình đăng nhập/đăng ký/quên mật khẩu/chờ quyền
js/workspace.js       Personal + Group workspace, role theo nhóm, scopeFields()/scopeWhere()
js/sharing.js         chia sẻ Viewer (resource_shares)
js/audit.js           ghi audit_logs (best-effort)
js/tabs/groups.js     tab Nhóm: nhóm của tôi, yêu cầu lập nhóm, chia sẻ, tài khoản, Super Admin Console
migration/            migrate.mjs (Admin SDK, dry-run mặc định) + plan.mjs (logic thuần, có test)
tests/rules.test.mjs  test allow/deny Firestore Rules (Emulator)
docs/ARCHITECTURE.md  kiến trúc, ma trận quyền, giới hạn, quyết định cần xác nhận
js/drive.js           ⚙️ DÁN URL Web App (Apps Script) Ở ĐÂY; tải/xóa ảnh Drive
js/store.js           dữ liệu real-time THEO WORKSPACE (đổi nhóm → hủy listener cũ)
js/utils.js           modal, toast, chuyển ảnh sang base64, chọn tên, KaTeX…
js/plan-logic.js       logic thuần: validate, flatten, rẽ nhánh, computeFlow
js/tabs/planner.js    Tab 1 — Kế hoạch (Thí nghiệm → Thao tác, ảnh qua Drive)
js/tabs/sop.js        Tab 2 — Quy trình (một thao tác mỗi màn hình + data logger)
js/tabs/calc.js       Tab Pha chế
js/tabs/ai.js         Tab AI (chat Gemini qua Apps Script — không giữ khóa ở client)
js/tabs/settings.js   Tab Cài đặt (thành viên thực hành của workspace, xuất báo cáo)
GAS/code.gs           Apps Script — nhận/xóa ảnh, gọi xuất báo cáo
GAS/report.gs         Apps Script — tạo Google Docs từ nhật ký
GAS/math-render.gs    Apps Script — công thức → Unicode và bảng Markdown trong Docs
firestore.rules       Rules v3: scoped RBAC + ACL (nguồn sự thật phân quyền)
examples/*.json        bài mẫu trích từ giáo trình (dùng nút "Nhập JSON")
SCHEMA.md             thiết kế dữ liệu
```

## Cài đặt (làm 1 lần, ~15 phút)

### A. Firestore (dữ liệu chữ/số)
1. **Tạo dự án Firebase**: https://console.firebase.google.com → Add project.
2. **Thêm Web app**: Project settings → Your apps → `</>` → copy `firebaseConfig` → dán vào `js/firebase.js`.
3. **Authentication** → Sign-in method → bật **Email/Password** (Anonymous chỉ giữ tạm khi chuyển từ v2).
4. **Firestore Database** → Create database (chế độ production) → tab **Rules** → dán nội dung `firestore.rules` → Publish. Super Admin = UID trong `firestore.rules` (`isSuperAdmin()`) và `js/auth.js` (`SUPER_ADMIN_UID`) — phải trùng nhau.

### B. Google Drive (ảnh)
1. Tạo 1 thư mục Drive, copy ID thư mục.
2. Tạo Apps Script Web App và dán đủ ba file `GAS/code.gs`, `GAS/report.gs`, `GAS/math-render.gs`. Chạy với quyền của bạn, cho phép mọi người truy cập.
3. Dán ID thư mục vào `GAS/code.gs`, URL Web App vào `js/drive.js`; đặt Script properties `FIREBASE_WEB_API_KEY`, `GEMINI_API_KEY`. Sau mỗi lần sửa file trong `GAS/`, vào Manage deployments → New version — Save trong editor không cập nhật URL đang chạy.

Không làm bước B thì app vẫn chạy bình thường — chỉ phần ảnh minh họa/ảnh chụp sẽ báo
"Chưa cấu hình Google Drive" và tạm không dùng được, mọi thứ khác (soạn bài, thực hiện quy
trình, trạm pha chế) vẫn hoạt động đầy đủ.

## Chạy thử trên máy

ES Modules không chạy được bằng `file://`. Mở terminal trong thư mục dự án:

```bash
python -m http.server 8080
```
rồi vào http://localhost:8080 .

## Deploy GitHub Pages

1. Tạo repo, đẩy toàn bộ thư mục lên nhánh `main`.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.
3. Mở `https://<user>.github.io/<repo>/`. Mọi đường dẫn trong code là đường dẫn tương đối nên
   chạy được ở thư mục con. Đây chính là "link webapp" người dùng cuối sẽ mở — ảnh được tải
   lên Drive và hiển thị lại ngay trong trang này qua link proxy ổn định của Apps Script.

## Quy trình dùng tại phòng lab

0. Đăng nhập; chọn **không gian làm việc** (Cá nhân / nhóm) ở góc trên. Muốn lập nhóm: tab **Nhóm** → *Đề nghị lập nhóm mới*.
1. Tab **Cài đặt**: nhập tên các thành viên thực hành của không gian hiện tại (trong nhóm chỉ Quản trị nhóm sửa được).
2. Tab **Kế hoạch**: soạn bài theo cấu trúc Thí nghiệm → Thao tác (hoặc *Nhập JSON* bài mẫu
   trong `examples/`) → **Lưu**.
3. Tab **Quy trình**: chọn bài; dùng các nút tròn dưới tên bài để chuyển thí nghiệm, hoặc menu
   **Tiến trình** ở góc trên để mở thí nghiệm và thao tác. Các nút bước hiển thị số đầy đủ
   (ví dụ 1.1, 1.2) và mở đúng thao tác được chọn. Nút mũi tên quay lại danh sách bài. Các thiết bị
   cùng mở kế hoạch sẽ thấy và cập nhật chung nhật ký.
4. Các thao tác chưa hoàn thành không bị khóa; có thể mở bất kỳ bước nào. Nhập dữ liệu hoặc tải
   ảnh sẽ đánh dấu bước màu xanh trong menu Tiến trình; bấm **Lưu** để đồng bộ lên Firestore.
   Người được ủy quyền sẽ được ghi nhận khi lưu; bước chưa được giao sẽ cho chọn tên thành viên.
   Để xóa ảnh đã lưu: mở bước → **Sửa** → **Xóa ảnh** → **Lưu**.
5. Cần tra cứu công thức pha chế: kéo nút nổi đến vị trí thuận tiện rồi bấm để mở.
6. Xong: **⬇ CSV** để xuất kết quả, bao gồm tiêu đề và nội dung từng bước.

## Soạn công thức

- Công thức: `$x^2$`, khối: `$$ ... $$`.
- Hóa học (mhchem): `$\ce{H2SO4}$`, `$\ce{2H2 + O2 -> 2H2O}$`.
- Thanh công cụ trong từng thao tác có sẵn ký tự đặc biệt (°C, ±, →, ⇌, Δ, µ, ², ₂…) và mẫu `\ce{}`.
- **▦ Tạo bảng** chèn bảng có số dòng/cột tùy chọn ngay trong nội dung thao tác; sửa ô trực tiếp
  trong khung nhập, bảng hiển thị ở phần xem trước và Quy trình.
- Tiêu đề riêng của thao tác được nhập ngay cạnh số thứ tự (ví dụ 1.1); để trống thì Quy trình
  hiển thị nội dung hướng dẫn làm tiêu đề.
- Mục **Ảnh minh họa** cho phép chọn nhiều ảnh cùng lúc; ảnh được tải nguyên bản lên Drive và có
  liên kết mở từng ảnh ngay bên dưới hình thu nhỏ.
- Ở Quy trình, sau khi chụp/chọn ảnh, có thể nhập tên file tùy chọn rồi bấm **Tải ảnh lên Drive**;
  để trống thì hệ thống tự tạo tên. Có thể thêm nhiều ảnh vào cùng một bước. Apps Script cần được
  triển khai phiên bản mới để nhận tên tùy chỉnh. Ảnh tải thành công được đánh dấu xanh ngay; mỗi
  lần bỏ ảnh đều cần xác nhận.

## Điều kiện rẽ nhánh

- Chỉ dùng được với dữ liệu kiểu **số**.
- Điều kiện xét **từ trên xuống**, điều kiện khớp đầu tiên được hiển thị như gợi ý hướng xử lý.
- Quy trình không khóa hay tự bỏ qua bước nào; người dùng luôn có thể mở bất kỳ bước nào.
- Muốn sửa thao tác đã lưu: mở thao tác đó và bấm **✎ Sửa** (ghi đè kết quả).

## Bảo mật — nói thẳng

- Mọi dữ liệu Firestore yêu cầu **đăng nhập email/mật khẩu + tài khoản `active`**; phiên ẩn danh bị Rules từ chối.
- Dữ liệu nhóm chỉ thành viên đang hoạt động thấy; Personal chỉ chủ thấy (kể cả Group Admin/Super Admin **không** đọc được). Biết mã nhóm không cấp quyền.
- Ảnh nằm trong Drive cá nhân của người deploy Apps Script — "Anyone with the link — Viewer": ai có đúng link ảnh thì xem được (Drive là lớp riêng, không theo Rules).
- Khóa Gemini nằm ở Script properties, không ở client/Firestore. Firebase Web `apiKey` là công khai theo thiết kế — nên giới hạn referrer.
- Không có backend riêng: các thao tác đặc quyền do Super Admin thực hiện ngay trong app nhưng được Rules thực thi. Xem giới hạn đầy đủ ở [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §7.

## Kiểm thử Rules

```bash
npm install
npm run test:rules        # Firestore Emulator (cần Java 11+)
node migration/plan.test.mjs
```

## Ngoại tuyến

Firestore bật cache cục bộ: mất mạng vẫn xem được dữ liệu đã tải và ghi số liệu/hiện
tượng/giải thích dạng chữ (tự đồng bộ khi có mạng lại). **Ảnh cần có mạng** để tải lên Drive —
nếu mất mạng khi đang chụp ảnh, app sẽ báo và giữ nguyên bản nháp để thử lại sau.