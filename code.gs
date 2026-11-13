/**
 * LabMana — Google Apps Script Web App
 * Vai trò: nhận ảnh (base64) từ app, lưu vào MỘT thư mục Google Drive cố định
 * với tên file rõ ràng theo Bài / Thí nghiệm / Lượt, trả mã ảnh để app hiển thị
 * bằng URL thumbnail Drive và hỗ trợ xóa ảnh đã lưu.
 *
 * CÀI ĐẶT (làm 1 lần):
 * 1. Tạo 1 thư mục trên Google Drive, ví dụ "LabMana - Ảnh thí nghiệm".
 *    Mở thư mục đó, copy ID trong URL: drive.google.com/drive/folders/<ID NÀY>
 * 2. Vào https://script.google.com → New project → dán code.gs và thêm file report.gs
 *    (file helper xuất báo cáo) vào cùng dự án.
 * 3. Dán ID thư mục vào ROOT_FOLDER_ID bên dưới.
 * 4. Chạy hàm authorizeDrive() một lần trong editor và chấp thuận quyền Google Drive.
 * 5. Deploy → New deployment → chọn loại "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Bấm Deploy, copy "Web app URL".
 * 6. Dán URL đó vào js/drive.js (biến GAS_URL).
 *
 * Mỗi lần sửa code.gs hoặc report.gs: phải Deploy → Manage deployments → ✎ → New version → Deploy lại,
 * nếu không URL cũ vẫn chạy code cũ.
 */

const ROOT_FOLDER_ID = "163F-EZ36tJ7qc9J9NTvIipvQWxOWEtJi";

function authorizeDrive() {
  return DriveApp.getFolderById(ROOT_FOLDER_ID).getName();
}

/* ---------------- Nhận ảnh / xóa ảnh (POST) ---------------- */
function doPost(e) {
  try {
    const req = parseRequest_(e);
    let result;
    if (req.action === "upload") result = handleUpload_(req);
    else if (req.action === "delete") result = handleDelete_(req);
    else if (req.action === "create_report") result = handleCreateReport_(req.report);
    else result = { ok: false, error: "Hành động không hợp lệ" };
    return response_(result, req.request_id);
  } catch (err) {
    let requestId = "";
    try { requestId = parseRequest_(e).request_id || ""; } catch (_) {}
    return response_({ ok: false, error: String(err) }, requestId);
  }
}

/* ---------------- Xem ảnh (GET) — chuyển đến ảnh Drive xem được ---------------- */
function doGet(e) {
  const id = e.parameter && e.parameter.id;
  if (!id) return HtmlService.createHtmlOutput("Thiếu tham số id");
  try {
    const file = DriveApp.getFileById(id);
    if (!isInRootFolder_(file)) return HtmlService.createHtmlOutput("Ảnh không thuộc thư mục LabMana.");
    const imageUrl = driveImageUrl_(id);
    return HtmlService.createHtmlOutput(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<a href="' + imageUrl + '"><img src="' + imageUrl + '" alt="LabMana" style="display:block;max-width:100%;height:auto;margin:auto"></a>'
    );
  } catch (err) {
    return HtmlService.createHtmlOutput("Không tìm thấy ảnh hoặc chưa có quyền truy cập.");
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
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const id = file.getId();
  return {
    ok: true,
    file_id: id,
    name: file.getName(),
    url: driveImageUrl_(id)
  };
}

function handleDelete_(req) {
  if (!req.file_id) return { ok: false, error: "Thiếu file_id" };
  try {
    const file = DriveApp.getFileById(req.file_id);
    if (!isInRootFolder_(file)) return { ok: false, error: "Ảnh không thuộc thư mục LabMana." };
    file.setTrashed(true);
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

function response_(result, requestId) {
  if (!requestId) return json_(result);
  const message = JSON.stringify({ requestId: requestId, result: result }).replace(/</g, "\\u003c");
  return HtmlService.createHtmlOutput(
    '<!doctype html><script>(function(){' +
    'var data=' + message + ';' +
    'window.parent.postMessage({source:"labmana-drive",requestId:data.requestId,result:data.result},"*");' +
    '})();</script>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}