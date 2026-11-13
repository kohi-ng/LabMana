# LabMana v2 — Web App quản lý thực hành Thí nghiệm Hóa Vô Cơ (Zero-Backend)

SPA thuần HTML/CSS/JS (ES Modules), **dữ liệu chữ/số/trạng thái** trên **Firestore**,
**ảnh** tải lên **Google Drive của bạn** qua một **Google Apps Script Web App** nhỏ (miễn phí,
không cần nâng cấp gói trả phí của Firebase). Deploy thẳng lên GitHub Pages.

Không có tài khoản/mật khẩu: app tự `signInAnonymously()`; người phụ trách đã được ủy quyền cho
bước sẽ được ghi nhận tự động. Nếu chưa ủy quyền, khi lưu có thể chọn tên từ danh sách thành viên.

## Có gì mới ở v2

- **Khung soạn bài theo đúng chuẩn giáo trình**: Bài → **Thí nghiệm** (section) → **Thao tác**
  (step, kiểu 1.1/1.2…), có tiêu đề riêng tùy chọn (hỗ trợ công thức hóa học) và mỗi thao tác khi thực hiện ghi nhận đúng 2 cột của
  *Mẫu báo cáo thực hành*: **"Hiện tượng quan sát thực tế"** và **"Giải thích và PTPƯ minh
  họa"** — có thể bật/tắt từng cột theo nhu cầu của từng thao tác. Một khung soạn bài dùng
  được cho mọi bài trong giáo trình (Bài 1 → Bài 9), không cần sửa code.
- **Ủy quyền theo từng thao tác**: người soạn chọn thành viên trong Cài đặt ở ngay bước cần giao;
  phần phân vai chung ở đầu bài không còn cần thiết.
- **Ảnh ưu tiên Google Drive**, không qua Firebase Storage. Nếu Apps Script lưu ảnh nhưng không
  gửi được xác nhận về trình duyệt, ảnh chụp vẫn được giữ kèm nhật ký để không chặn bước (trường
  hợp dự phòng có thể làm ảnh lưu trong Firestore lớn hơn). `code.gs` nhận/xóa ảnh; sau khi đổi mã
  cần triển khai phiên bản mới của Apps Script Web App.
- **Giao diện Apple-style sáng**: nền trắng/xám sáng, bo góc mềm, không dùng biểu tượng ở thanh tab.
- **Tab Quy trình**: danh sách bài đã lên kế hoạch; chọn bài rồi dùng các nút tròn dưới tên bài để
  chuyển thí nghiệm, hoặc menu **Tiến trình** để mở thí nghiệm và thao tác. Mọi bước đều mở độc lập.
- **Bartender dạng nút nổi có thể kéo thả** ở góc màn hình, bấm vào mở cửa sổ tra cứu/tính toán
  nhanh mà không rời khỏi tab đang làm — mở rộng danh mục hóa chất theo đúng các chất dùng
  xuyên suốt giáo trình (KMnO₄, K₂Cr₂O₇, Na₂S₂O₃·5H₂O, phèn nhôm-kali, muối Mohr…).

## Cấu trúc

```
index.html            khung + Bottom Nav 3 tab + FAB Bartender
css/style.css         giao diện Apple-style sáng, mobile-first
js/app.js             điều hướng tab, trạng thái kết nối, FAB sheet
js/firebase.js        ⚙️ DÁN firebaseConfig Ở ĐÂY; đăng nhập ẩn danh; cache ngoại tuyến
js/drive.js           ⚙️ DÁN URL Web App (Apps Script) Ở ĐÂY; tải/xóa ảnh Drive
js/store.js           dữ liệu real-time (onSnapshot) dùng chung các tab
js/utils.js           modal, toast, chuyển ảnh sang base64, chọn tên, KaTeX…
js/plan-logic.js       logic thuần: validate, flatten, rẽ nhánh, computeFlow
js/tabs/planner.js    Tab 1 — Kế hoạch (Thí nghiệm → Thao tác, ảnh qua Drive)
js/tabs/sop.js        Tab 2 — Quy trình (accordion + data logger)
js/tabs/calc.js       Bartender (chạy trong FAB sheet)
js/tabs/settings.js   Tab 3 — Cài đặt (thành viên)
code.gs               Backend Google Apps Script — nhận/xóa ảnh trên Drive
firestore.rules       quy tắc bảo mật Firestore
examples/*.json        bài mẫu trích từ giáo trình (dùng nút "Nhập JSON")
SCHEMA.md             thiết kế dữ liệu
```

## Cài đặt (làm 1 lần, ~15 phút)

### A. Firestore (dữ liệu chữ/số)
1. **Tạo dự án Firebase**: https://console.firebase.google.com → Add project.
2. **Thêm Web app**: Project settings → Your apps → `</>` → copy `firebaseConfig` → dán vào `js/firebase.js`.
3. **Authentication** → Sign-in method → bật **Anonymous**.
4. **Firestore Database** → Create database (chế độ production) → tab **Rules** → dán nội dung `firestore.rules` → Publish.

### B. Google Drive (ảnh)
1. Tạo 1 thư mục Drive, copy ID thư mục.
2. Tạo Apps Script Web App từ `code.gs`, chọn chạy với quyền của bạn và cho phép người dùng truy cập.
3. Dán ID thư mục vào `code.gs`, URL Web App vào `js/drive.js`; sau mỗi lần sửa `code.gs`, triển khai phiên bản mới.

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

1. Tab **Cài đặt**: nhập tên các thành viên (một lần, dùng chung mọi thiết bị).
2. Tab **Kế hoạch**: soạn bài theo cấu trúc Thí nghiệm → Thao tác (hoặc *Nhập JSON* bài mẫu
   trong `examples/`) → **Lưu**.
3. Tab **Quy trình**: chọn bài; dùng các nút tròn dưới tên bài để chuyển thí nghiệm, hoặc menu
   **Tiến trình** ở góc trên để mở thí nghiệm và thao tác. Nút mũi tên quay lại danh sách bài.
   Các thiết bị cùng mở kế hoạch sẽ thấy và cập nhật chung nhật ký.
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
  triển khai phiên bản mới để nhận tên tùy chỉnh.

## Điều kiện rẽ nhánh

- Chỉ dùng được với dữ liệu kiểu **số**.
- Điều kiện xét **từ trên xuống**, điều kiện khớp đầu tiên được hiển thị như gợi ý hướng xử lý.
- Quy trình không khóa hay tự bỏ qua bước nào; người dùng luôn có thể mở bất kỳ bước nào.
- Muốn sửa thao tác đã lưu: mở thao tác đó và bấm **✎ Sửa** (ghi đè kết quả).

## Bảo mật — nói thẳng

Đăng nhập ẩn danh nghĩa là **bất kỳ ai có link web** đều tự có quyền đọc/ghi Firestore theo
Rules ở trên (Firebase API key vốn công khai). Phù hợp cho lớp/nhóm thực hành nội bộ;
**đừng lưu thông tin nhạy cảm**. Muốn chặt hơn: bật Firebase **App Check**, và/hoặc giữ link
ở nội bộ. Ảnh nằm trong Drive cá nhân của người deploy Apps Script — chia sẻ ở chế độ "Anyone
with the link — Viewer", nghĩa là ai có đúng link ảnh mới xem được, nhưng link không bị liệt
kê công khai.

## Ngoại tuyến

Firestore bật cache cục bộ: mất mạng vẫn xem được dữ liệu đã tải và ghi số liệu/hiện
tượng/giải thích dạng chữ (tự đồng bộ khi có mạng lại). **Ảnh cần có mạng** để tải lên Drive —
nếu mất mạng khi đang chụp ảnh, app sẽ báo và giữ nguyên bản nháp để thử lại sau.