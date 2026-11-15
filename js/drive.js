// ============ Drive: tải / xóa ảnh qua Google Apps Script Web App ============
import { blobToBase64, blobToDataUrl } from "./utils.js";

export const GAS_URL = "https://script.google.com/macros/s/AKfycby232LaXbc2TC-BXLJlZB9XjFGdzsl5LLnPELJ90lDHww2OzWLD8j2ngZWlEt9n1B0gFA/exec";
export const isDriveConfigured = !!GAS_URL && !GAS_URL.startsWith("DÁN_");

const DOCS_EMBED_MAX_BYTES = 2 * 1024 * 1024;

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Không xuất được ảnh JPEG")), type, quality);
  });
}

/**
 * Google Docs chỉ nhúng JPEG/PNG/GIF ≤ 2 MB. Web thì hiện mọi ảnh qua thumbnail Drive,
 * nên ảnh HEIC/WebP/BMP hoặc file quá nặng nhìn được trên app nhưng biến mất trong báo cáo.
 * Chuyển những ảnh đó sang JPEG vừa cỡ trước khi upload. Ảnh đã nhúng được thì giữ nguyên.
 */
async function prepareImageBlob(blob) {
  const type = String(blob?.type || "").toLowerCase();
  const embeddable = type === "image/jpeg" || type === "image/png" || type === "image/gif";
  if (embeddable && blob.size <= DOCS_EMBED_MAX_BYTES) return blob;
  if (typeof createImageBitmap !== "function") return blob;
  let bitmap;
  try { bitmap = await createImageBitmap(blob); }
  catch { return blob; }
  try {
    let width = bitmap.width || 1;
    let height = bitmap.height || 1;
    const fit = Math.min(1, 1600 / Math.max(width, height));
    width = Math.max(1, Math.round(width * fit));
    height = Math.max(1, Math.round(height * fit));
    let quality = 0.86;
    let out = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      out = await canvasToBlob(canvas, "image/jpeg", quality);
      if (out.size <= DOCS_EMBED_MAX_BYTES) return out;
      if (quality > 0.5) quality = Math.round((quality - 0.12) * 100) / 100;
      else {
        width = Math.max(1, Math.round(width * 0.72));
        height = Math.max(1, Math.round(height * 0.72));
        if (width < 480 && height < 480) break;
      }
    }
    return out && out.size <= DOCS_EMBED_MAX_BYTES ? out : blob;
  } finally {
    bitmap.close?.();
  }
}

function withJpegExtension(name) {
  const value = String(name || "").trim();
  if (!value) return "";
  return value.replace(/\.[a-z0-9]{1,8}$/i, "") + ".jpg";
}

/**
 * Gọi thẳng Apps Script Web App bằng fetch() và đọc JSON trả về.
 * Thay cho cơ chế iframe + postMessage cũ: cơ chế đó từng khiến app báo lỗi/timeout
 * dù phía Drive đã nhận và lưu file thành công — vì phản hồi qua postMessage không
 * phải lúc nào cũng tới được cửa sổ chính (phụ thuộc trình duyệt / iframe lồng nhau
 * của Apps Script). fetch() đọc thẳng response của doPost/doGet nên không bị vậy.
 */
async function driveRequest(payload, { timeoutMs = 90000 } = {}) {
  if (!isDriveConfigured) throw new Error("NOT_CONFIGURED_DRIVE");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      // text/plain tránh preflight CORS (OPTIONS) mà Apps Script Web App không xử lý được;
      // code.gs vẫn đọc đúng nội dung qua e.postData.contents vì đây vẫn là JSON hợp lệ.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Google Apps Script phản hồi lỗi HTTP ${response.status}.`);
    let result;
    try { result = await response.json(); }
    catch (err) { throw new Error("Không đọc được phản hồi từ Google Apps Script (không phải JSON hợp lệ)."); }
    if (!result?.ok) throw new Error(result?.error || "Google Drive từ chối yêu cầu.");
    return result;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Hết thời gian chờ Google Drive. Kiểm tra mạng rồi thử lại; nếu vẫn lỗi, triển khai lại phiên bản mới của code.gs.");
    }
    if (err instanceof TypeError) {
      // fetch() thất bại ở tầng mạng/CORS trước khi có response (mất mạng, bị chặn, URL sai…)
      throw new Error("Không kết nối được tới Google Drive (mạng hoặc cấu hình CORS). Kiểm tra mạng và URL Apps Script trong js/drive.js.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const UPLOAD_ATTEMPTS = 2;

function newUploadId() {
  try { if (globalThis.crypto?.randomUUID) return crypto.randomUUID(); } catch { /* dùng dự phòng */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function driveUpload(blob, kind, meta = {}) {
  const prepared = await prepareImageBlob(blob);
  const converted = prepared !== blob && prepared.type === "image/jpeg";
  const { fileName, originalName, ...driveMeta } = meta;
  let lastError = null;
  let payload = null;
  try {
    payload = {
      action: "upload",
      upload_id: newUploadId(), // cùng mã cho mọi lần thử lại → server không tạo ảnh trùng
      kind,
      base64: await blobToBase64(prepared),
      mime: prepared.type || "image/jpeg",
      meta: driveMeta,
      file_name: converted ? withJpegExtension(fileName) : (fileName || ""),
      original_name: converted ? (withJpegExtension(originalName) || "anh.jpg") : (originalName || "")
    };
  } catch (err) {
    lastError = err;
  }
  if (payload) {
    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
      try {
        const result = await driveRequest(payload);
        if (!result.file_id) throw new Error("Google Drive phản hồi nhưng thiếu mã ảnh.");
        if (result.share_error) console.warn("Ảnh đã lưu nhưng không đặt được quyền xem bằng link:", result.share_error);
        return {
          file_id: result.file_id,
          url: result.url || driveImageUrl(result.file_id),
          name: result.name || ""
        };
      } catch (err) {
        lastError = err;
        console.warn(`Tải ảnh lên Drive lần ${attempt}/${UPLOAD_ATTEMPTS} lỗi:`, err);
        if (attempt < UPLOAD_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }
  {
    const err = lastError || new Error("Không tải được ảnh lên Drive.");
    if (kind !== "log") throw err;
    console.warn("Drive chưa xác nhận upload ảnh; giữ ảnh trong nhật ký để không chặn bước:", err);
    return {
      file_id: "",
      // Dùng bản đã nén (prepared) thay vì ảnh gốc để nhẹ hơn cho Firestore (giới hạn 1 MiB/tài liệu).
      url: await blobToDataUrl(prepared),
      name: "Ảnh lưu kèm nhật ký",
      storage_fallback: true,
      error: String(err?.message || err)
    };
  }
}

export async function driveCreateReport(report) {
  // Nhiều ảnh (tới 80) + chèn vào Google Docs có thể mất hơn 90s; cho thời gian rộng hơn,
  // Apps Script tự giới hạn ở 6 phút/lượt chạy nên 4 phút ở client là mức an toàn.
  return driveRequest({ action: "create_report", report }, { timeoutMs: 240000 });
}

export async function driveDelete(fileId) {
  if (!fileId) return;
  return driveRequest({ action: "delete", file_id: fileId });
}

export function driveImageUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`;
}

export function driveFileUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}