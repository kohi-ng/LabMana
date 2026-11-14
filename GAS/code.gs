/**
 * LabMana — Google Apps Script Web App
 * Nhận ảnh base64, lưu vào Google Drive, xóa ảnh và tạo báo cáo Google Docs.
 *
 * Giao tiếp: form POST từ app vào iframe ẩn. Apps Script trả HtmlService và gửi
 * JSON về cửa sổ app bằng postMessage. Cách này tránh lỗi CORS do ContentService
 * redirect response sang script.googleusercontent.com khi gọi fetch() trực tiếp.
 *
 * CÀI ĐẶT:
 * 1. Tạo thư mục Drive và dán ID vào ROOT_FOLDER_ID.
 * 2. Dán code.gs, report.gs và math-render.gs vào cùng một Apps Script project.
 * 3. Chạy authorizeDrive() một lần để cấp quyền.
 * 4. Deploy Web app: Execute as Me; Who has access: Anyone.
 * 5. Dán Web app URL vào GAS_URL trong js/drive.js.
 * 6. Mỗi lần sửa mã GAS: Manage deployments → Edit → New version → Deploy.
 */

const ROOT_FOLDER_ID = "163F-EZ36tJ7qc9J9NTvIipvQWxOWEtJi";

function authorizeDrive() {
  return DriveApp.getFolderById(ROOT_FOLDER_ID).getName();
}

/* ---------------- Nhận ảnh / xóa ảnh / tạo báo cáo ---------------- */
function doPost(e) {
  const requestId = e && e.parameter && e.parameter.request_id || "";
  console.log("[LabMana] doPost received; request_id=" + requestId);
  try {
    const req = parseRequest_(e);
    console.log("[LabMana] payload parsed; action=" + req.action);
    let result;
    if (req.action === "upload") result = handleUpload_(req);
    else if (req.action === "delete") result = handleDelete_(req);
    else if (req.action === "create_report") result = handleCreateReport_(req.report);
    else result = { ok: false, error: "Hành động không hợp lệ" };
    console.log("[LabMana] action complete; ok=" + !!result.ok);
    return htmlResponse_(result, requestId);
  } catch (err) {
    console.error("[LabMana] doPost failed: " + (err && err.stack || err));
    return htmlResponse_({ ok: false, error: String(err) }, requestId);
  }
}

/**
 * Trả HTML chạy trong iframe đích của form POST. ALLOWALL cho phép iframe app
 * nhúng trang phản hồi; request_id giúp app ghép đúng phản hồi với đúng request.
 */
function htmlResponse_(result, requestId) {
  const message = JSON.stringify({
    labmana: "drive-response",
    request_id: String(requestId || ""),
    result: result
  }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>window.top.postMessage(' + message + ', "*");</script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------------- Xem ảnh (GET) ---------------- */
function doGet(e) {
  const id = e.parameter && e.parameter.id;
  const check = e.parameter && e.parameter.check;
  if (!id) return check ? json_( { ok: false, error: "Thiếu tham số id" }) : HtmlService.createHtmlOutput("Thiếu tham số id");
  try {
    const file = DriveApp.getFileById(id);
    if (!isInRootFolder_(file)) {
      return check ? json_({ ok: false, error: "Ảnh không thuộc thư mục LabMana." })
        : HtmlService.createHtmlOutput("Ảnh không thuộc thư mục LabMana.");
    }
    if (check) return json_({ ok: true, file_id: id, name: file.getName(), url: driveImageUrl_(id), access: file.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK ? "anyone_with_link_viewer" : "restricted" });
    const imageUrl = driveImageUrl_(id);
    return HtmlService.createHtmlOutput(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<a href="' + imageUrl + '"><img src="' + imageUrl + '" alt="LabMana" style="display:block;max-width:100%;height:auto;margin:auto"></a>'
    );
  } catch (err) {
    return check ? json_({ ok: false, error: String(err) }) : HtmlService.createHtmlOutput("Không tìm thấy ảnh hoặc chưa có quyền truy cập.");
  }
}

function handleUpload_(req) {
  const meta = req.meta || {};
  console.log("[LabMana] upload: creating/finding folder");
  const folder = getOrCreateSubFolder_(buildFolderPath_(req.kind, meta));
  console.log("[LabMana] upload: folder ready; decoding " + String(req.base64 || "").length + " base64 chars");
  const bytes = Utilities.base64Decode(req.base64);
  const mime = req.mime || "image/jpeg";
  const blob = Utilities.newBlob(bytes, mime, buildFileName_(req.kind, meta, req.file_name, req.original_name, mime));
  console.log("[LabMana] upload: blob ready; bytes=" + bytes.length + "; creating file");
  const file = folder.createFile(blob);
  const id = file.getId();
  console.log("[LabMana] upload: file created; id=" + id + "; setting link permission");
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    if (file.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) {
      throw new Error("Drive không xác nhận quyền Anyone with the link.");
    }
  } catch (err) {
    try { file.setTrashed(true); } catch (cleanupErr) { console.error("Không dọn được file upload lỗi " + id + ": " + cleanupErr); }
    throw new Error("Không thể cấp quyền xem ảnh bằng link. Kiểm tra chính sách chia sẻ Google Workspace: " + String(err));
  }
  console.log("[LabMana] upload: link permission verified; id=" + id);
  return {
    ok: true,
    file_id: id,
    name: file.getName(),
    url: driveImageUrl_(id),
    access: "anyone_with_link_viewer"
  };
}

function handleDelete_(req) {
  if (!req.file_id) return { ok: false, error: "Thiếu file_id" };
  let file;
  try {
    file = DriveApp.getFileById(req.file_id);
  } catch (err) {
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

function sanitize_(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
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
