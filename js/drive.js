// ============ Drive: tải / xóa ảnh qua Google Apps Script Web App ============
import { blobToBase64, blobToDataUrl } from "./utils.js";

export const GAS_URL = "https://script.google.com/macros/s/AKfycbyMxFpoicWLq3dg5YNyfePuaSUKO55xoQNx-8EY5MroyMQir-PHiRYUpl5YOXdb8mjcIw/exec";
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

export async function driveUpload(blob, kind, meta = {}) {
  const prepared = await prepareImageBlob(blob);
  const converted = prepared !== blob && prepared.type === "image/jpeg";
  const { fileName, originalName, ...driveMeta } = meta;
  try {
    const result = await driveRequest({
      action: "upload",
      kind,
      base64: await blobToBase64(prepared),
      mime: prepared.type || "image/jpeg",
      meta: driveMeta,
      file_name: converted ? withJpegExtension(fileName) : (fileName || ""),
      original_name: converted ? (withJpegExtension(originalName) || "anh.jpg") : (originalName || "")
    });
    if (!result.file_id) throw new Error("Google Drive phản hồi nhưng thiếu mã ảnh.");
    return {
      file_id: result.file_id,
      url: result.url || driveImageUrl(result.file_id),
      name: result.name || ""
    };
  } catch (err) {
    if (kind !== "log") throw err;
    console.warn("Drive chưa xác nhận upload ảnh; giữ ảnh trong nhật ký để không chặn bước:", err);
    return {
      file_id: "",
      url: await blobToDataUrl(blob),
      name: "Ảnh lưu kèm nhật ký",
      storage_fallback: true
    };
  }
}

export async function driveCreateReport(report) {
  // Nhiều ảnh (tới 80) + chèn vào Google Docs có thể mất hơn 90s; cho thời gian rộng hơn,
  // Apps Script tự giới hạn ở 6 phút/lượt chạy nên 4 phút ở client là mức an toàn.
  return driveRequest({ action: "create_report", report }, { timeoutMs: 240000 });
}

export function isMissingDriveFileError(err) {
  const msg = String(err?.message || err || "");
  return /not found|could not be found|no item with|file not found|không tìm thấy|does not exist|trashed/i.test(msg);
}

/** Xóa trên Drive. File đã mất (xóa tay) vẫn coi là thành công để gỡ id Firebase. */
export async function driveDelete(fileId) {
  if (!fileId) return { ok: true, skipped: true };
  try {
    return await driveRequest({ action: "delete", file_id: fileId });
  } catch (err) {
    if (isMissingDriveFileError(err)) return { ok: true, missing: true };
    throw err;
  }
}

/** Kiểm tra file còn trên Drive. Bản Apps Script cũ không có action check thì trả null. */
export async function driveCheck(fileId) {
  if (!fileId) return { ok: true, exists: false };
  try {
    const result = await driveRequest({ action: "check", file_id: fileId }, { timeoutMs: 30000 });
    return result;
  } catch (err) {
    if (/Hành động không hợp lệ/i.test(String(err?.message || err))) return null;
    if (isMissingDriveFileError(err)) return { ok: true, exists: false };
    throw err;
  }
}

export function driveImageUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`;
}

export function driveFileUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}