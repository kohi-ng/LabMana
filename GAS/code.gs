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

// NÂNG CẤP v3: file này giờ yêu cầu id_token (xem verifyCaller_ cuối file). Phải đặt Script properties rồi
// chạy authorizeDrive() lại (thêm quyền "kết nối dịch vụ bên ngoài") và Deploy → New version.
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
    // Mọi hành động đều cần Firebase ID token hợp lệ của tài khoản Email/Password đang active.
    const caller = verifyCaller_(req.id_token);
    if (!caller.ok) return json_({ ok: false, error: caller.error });
    delete req.id_token;
    let result;
    if (req.action === "gemini") result = handleGemini_(req);
    else if (req.action === "upload") result = handleUpload_(req);
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
function uploadResult_(file, shareError) {
  const id = file.getId();
  return { ok: true, file_id: id, name: file.getName(), url: driveImageUrl_(id), share_error: shareError || "" };
}

function handleUpload_(req) {
  // Client thử lại cùng upload_id khi không nhận được xác nhận: trả lại file đã tạo thay vì tạo bản trùng.
  const cache = CacheService.getScriptCache();
  const uploadKey = req.upload_id ? "up:" + String(req.upload_id).slice(0, 80) : "";
  if (uploadKey) {
    const cachedId = cache.get(uploadKey);
    if (cachedId) {
      try {
        const existing = DriveApp.getFileById(cachedId);
        if (!existing.isTrashed()) return uploadResult_(existing, "");
      } catch (err) { /* file đã mất: tải lại bình thường */ }
    }
  }
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
  if (uploadKey) {
    try { cache.put(uploadKey, file.getId(), 21600); } catch (err) { /* cache lỗi không được chặn upload */ }
  }
  return uploadResult_(file, shareError);
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
  // getFoldersByName có thể trả cả thư mục đã bị xóa (nằm trong thùng rác): bỏ qua chúng,
  // nếu không ảnh mới sẽ rơi vào thư mục "đã xóa" và coi như mất.
  while (it.hasNext()) {
    const folder = it.next();
    if (!folder.isTrashed()) return folder;
  }
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

/* ---------------- Xác minh danh tính (Firebase ID token) ---------------- */
// Cài đặt (Project Settings → Script properties):
//   FIREBASE_WEB_API_KEY = khóa Web của Firebase (giống apiKey trong js/firebase.js)
//   GEMINI_API_KEY       = khóa Gemini (KHÔNG đặt trong client/Firestore). Nên rotate khóa cũ từng nằm trong config/gemini.
// Cách xác minh: accounts:lookup kiểm tra token còn hiệu lực + loại bỏ phiên ẩn danh; đọc users/{uid} bằng chính
// token đó qua Firestore REST nên Firestore Rules được áp dụng (tài khoản phải active hoặc là Super Admin).
const FIREBASE_PROJECT_ID = "labmana-ecd8e";
const SUPER_ADMIN_UID = "Eq1ueE9VHoYIbNk3UU5gnQOwJBg1";

function prop_(name) { return PropertiesService.getScriptProperties().getProperty(name) || ""; }

function verifyCaller_(idToken) {
  if (!idToken) return { ok: false, error: "Thiếu thông tin đăng nhập. Hãy đăng nhập lại LabMana." };
  const cache = CacheService.getScriptCache();
  const cacheKey = "tok:" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);
  const apiKey = prop_("FIREBASE_WEB_API_KEY");
  if (!apiKey) return { ok: false, error: "Apps Script chưa cấu hình FIREBASE_WEB_API_KEY (Script properties)." };
  const look = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey), {
    method: "post", contentType: "application/json", muteHttpExceptions: true, payload: JSON.stringify({ idToken: idToken })
  });
  if (look.getResponseCode() !== 200) return { ok: false, error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại." };
  const user = (JSON.parse(look.getContentText()).users || [])[0];
  if (!user || user.disabled) return { ok: false, error: "Tài khoản bị vô hiệu hóa." };
  const providers = (user.providerUserInfo || []).map(function (p) { return p.providerId; });
  if (providers.indexOf("password") < 0) return { ok: false, error: "Cần tài khoản Email/Mật khẩu (phiên ẩn danh không được chấp nhận)." };
  let result = { ok: true, uid: user.localId, email: user.email };
  if (user.localId !== SUPER_ADMIN_UID) {
    const doc = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/users/" + user.localId, {
      headers: { Authorization: "Bearer " + idToken }, muteHttpExceptions: true
    });
    const status = doc.getResponseCode() === 200 ? (((JSON.parse(doc.getContentText()).fields || {}).status || {}).stringValue) : null;
    if (status !== "active") result = { ok: false, error: "Tài khoản chưa được phép sử dụng LabMana." };
  }
  cache.put(cacheKey, JSON.stringify(result), 300);   // 5 phút
  return result;
}

/* ---------------- Gemini proxy (khóa nằm ở Script properties) ---------------- */
function handleGemini_(req) {
  const key = prop_("GEMINI_API_KEY");
  if (!key) return { ok: false, error: "Apps Script chưa cấu hình GEMINI_API_KEY." };
  const model = String(req.model || "");
  if (!/^gemini-[a-z0-9.\-]+$/.test(model)) return { ok: false, error: "Tên mô hình không hợp lệ." };
  const res = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "x-goog-api-key": key }, payload: JSON.stringify(req.body || {})
  });
  const code = res.getResponseCode();
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (err) { /* giữ rỗng */ }
  if (code >= 400) return { ok: true, status: code, error: (body.error && body.error.message) || "" };
  return { ok: true, status: 200, data: body };
}
