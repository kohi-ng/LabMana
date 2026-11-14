/**
 * LabMana — Google Apps Script Web App
 * Vai trò: nhận ảnh (base64) từ app, lưu vào MỘT thư mục Google Drive cố định
 * với tên file rõ ràng theo Bài / Thí nghiệm / Lượt, trả mã ảnh để app hiển thị
 * bằng URL thumbnail Drive và hỗ trợ xóa ảnh đã lưu.
 *
 * Giao tiếp: client gọi thẳng bằng fetch() (POST JSON / GET), server trả JSON
 * thuần qua ContentService. KHÔNG dùng iframe + postMessage nữa (cơ chế cũ hay
 * rớt phản hồi dù Drive đã nhận file xong, khiến app báo lỗi dù upload thành công).
 *
 * CÀI ĐẶT (làm 1 lần):
 * 1. Tạo 1 thư mục trên Google Drive, ví dụ "LabMana - Ảnh thí nghiệm".
 *    Mở thư mục đó, copy ID trong URL: drive.google.com/drive/folders/<ID NÀY>
 * 2. Vào https://script.google.com → New project → dán CẢ BA file trong thư mục GAS/:
 *    code.gs, report.gs và math-render.gs (cùng một project, không cần import).
 * 3. Dán ID thư mục vào ROOT_FOLDER_ID bên dưới.
 * 4. Chạy hàm authorizeDrive() một lần trong editor và chấp thuận quyền Google Drive
 *    (và quyền "kết nối dịch vụ bên ngoài" — report.gs dùng UrlFetchApp để lấy thumbnail
 *    khi ảnh quá nặng/HEIC). Mỗi khi thêm quyền mới phải chạy lại rồi Deploy phiên bản mới.
 * 5. Deploy → New deployment → chọn loại "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Bấm Deploy, copy "Web app URL".
 * 6. Dán URL đó vào js/drive.js (biến GAS_URL).
 *
 * Mỗi lần sửa code.gs, report.gs hoặc math-render.gs: phải Deploy → Manage deployments
 * → ✎ → New version → Deploy lại, nếu không URL cũ vẫn chạy code cũ.
 */

const ROOT_FOLDER_ID = "163F-EZ36tJ7qc9J9NTvIipvQWxOWEtJi";

function authorizeDrive() {
  return DriveApp.getFolderById(ROOT_FOLDER_ID).getName();
}

/* ---------------- Nhận ảnh / xóa ảnh (POST) ---------------- */
// Trả JSON thuần qua ContentService để client gọi bằng fetch() trực tiếp,
// KHÔNG còn dùng cơ chế iframe + postMessage (hay bị rớt phản hồi trên thực tế).
function doPost(e) {
  try {
    const req = parseRequest_(e);
    let result;
    if (req.action === "upload") result = handleUpload_(req);
    else if (req.action === "delete") result = handleDelete_(req);
    else if (req.action === "create_report") result = handleCreateReport_(req.report);
    else result = { ok: false, error: "Hành động không hợp lệ" };
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ---------------- Xem ảnh (GET) — chuyển đến ảnh Drive xem được ---------------- */
// Thêm tham số check=1 để client kiểm tra JSON xem file đã thực sự có trên Drive
// chưa (dùng làm phương án dự phòng nếu một lần fetch() nào đó bị lỗi mạng).
function doGet(e) {
  const id = e.parameter && e.parameter.id;
  const check = e.parameter && e.parameter.check;
  if (!id) return check ? json_({ ok: false, error: "Thiếu tham số id" }) : HtmlService.createHtmlOutput("Thiếu tham số id");
  try {
    const file = DriveApp.getFileById(id);
    if (!isInRootFolder_(file)) {
      return check ? json_({ ok: false, error: "Ảnh không thuộc thư mục LabMana." })
        : HtmlService.createHtmlOutput("Ảnh không thuộc thư mục LabMana.");
    }
    if (check) return json_({ ok: true, file_id: id, name: file.getName(), url: driveImageUrl_(id) });
    const imageUrl = driveImageUrl_(id);
    return HtmlService.createHtmlOutput(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<a href="' + imageUrl + '"><img src="' + imageUrl + '" alt="LabMana" style="display:block;max-width:100%;height:auto;margin:auto"></a>'
    );
  } catch (err) {
    return check ? json_({ ok: false, error: String(err) }) : HtmlService.createHtmlOutput("Không tìm thấy ảnh hoặc chưa có quyền truy cập.");
  }
}

/* ---------------- Xử lý nghiệp vụ ---------------- */
function handleUpload_(req) {
  const meta = req.meta || {};
  const folder = getOrCreateSubFolder_(buildFolderPath_(req.kind, meta));
  const bytes = Utilities.base64Decode(req.base64);
  const mime = req.mime || "image/jpeg";
  const blob = Utilities.newBlob(bytes, mime, buildFileName_(req.kind, meta, req.file_name, req.original_name, mime));
  const file = folder.createFile(blob);
  // Một số tài khoản Workspace chặn chia sẻ "Anyone with the link": nếu setSharing ném lỗi thì file vẫn
  // đã nằm trong Drive, nên trả file_id kèm cảnh báo thay vì báo lỗi (tránh ảnh mồ côi + lưu dự phòng).
  let shareError = "";
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    shareError = String(err);
    console.warn("setSharing lỗi cho " + file.getId() + ": " + shareError);
  }
  const id = file.getId();
  return {
    ok: true,
    file_id: id,
    name: file.getName(),
    url: driveImageUrl_(id),
    share_error: shareError
  };
}

function handleDelete_(req) {
  if (!req.file_id) return { ok: false, error: "Thiếu file_id" };
  let file;
  try {
    file = DriveApp.getFileById(req.file_id);
  } catch (err) {
    // File không còn trên Drive (ví dụ đã bị xóa tay): mục tiêu "xóa" đã đạt nên coi là thành công,
    // để app không báo "chưa xóa được khỏi Drive" mãi cho một ảnh vốn đã không còn.
    return { ok: true, already_gone: true };
  }
  try {
    if (!isInRootFolder_(file)) return { ok: false, error: "Ảnh không thuộc thư mục LabMana." };
    if (!file.isTrashed()) file.setTrashed(true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ---------------- Đặt tên thư mục con & tên file theo Bài / Thí nghiệm / Lượt ---------------- */
function sanitize_(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "") // bỏ dấu tiếng Việt cho tên thư mục gọn
    .replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 60) || "khong-ten";
}

function buildFolderPath_(kind, meta) {
  if (kind === "plan") return ["KeHoach", sanitize_(meta.expTitle)];
  return ["ThucHien", sanitize_(meta.expTitle), sanitize_(meta.runName)];
}

function buildFileName_(kind, meta, requestedName, originalName, mime) {
  const ts = Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd_HHmmss");
  const originalExtension = fileExtension_(originalName, mime);
  const requested = String(requestedName || "").trim();
  const extensionMatch = requested.match(/\.([a-z0-9]{1,8})$/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : originalExtension;
  const customName = extensionMatch ? requested.slice(0, -extensionMatch[0].length) : requested;
  const nameParts = kind === "plan"
    ? [meta.expTitle, meta.sectionName, customName]
    : [meta.expTitle, meta.sectionName, meta.stepLabel, customName];
  const prefix = nameParts.filter(part => String(part || "").trim()).map(sanitize_).join("_");
  return `${prefix || "anh-thi-nghiem"}_${ts}.${extension}`;
}

function fileExtension_(fileName, mime) {
  const match = String(fileName || "").match(/\.([a-z0-9]{1,8})$/i);
  if (match) return match[1].toLowerCase();
  const extensions = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "image/heic": "heic", "image/heif": "heif",
    "image/bmp": "bmp", "image/tiff": "tif"
  };
  return extensions[mime] || "img";
}

function getOrCreateSubFolder_(pathParts) {
  let folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  pathParts.forEach(name => { folder = getOrCreateChild_(folder, name); });
  return folder;
}

function getOrCreateChild_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function parseRequest_(e) {
  const payload = e && e.parameter && e.parameter.payload;
  const contents = e && e.postData && e.postData.contents;
  return JSON.parse(payload || contents || "{}");
}

function driveImageUrl_(id) {
  return "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w1600";
}

function isInRootFolder_(file) {
  const rootId = DriveApp.getFolderById(ROOT_FOLDER_ID).getId();
  const pending = [];
  const parents = file.getParents();
  while (parents.hasNext()) pending.push(parents.next());
  const visited = {};
  while (pending.length) {
    const folder = pending.pop();
    const id = folder.getId();
    if (id === rootId) return true;
    if (visited[id]) continue;
    visited[id] = true;
    const ancestors = folder.getParents();
    while (ancestors.hasNext()) pending.push(ancestors.next());
  }
  return false;
}