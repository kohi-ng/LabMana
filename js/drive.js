// ============ Drive: tải / xóa ảnh qua Google Apps Script Web App ============
import { blobToBase64, blobToDataUrl } from "./utils.js";

export const GAS_URL = "https://script.google.com/macros/s/AKfycbyMxFpoicWLq3dg5YNyfePuaSUKO55xoQNx-8EY5MroyMQir-PHiRYUpl5YOXdb8mjcIw/exec";
export const isDriveConfigured = !!GAS_URL && !GAS_URL.startsWith("DÁN_");

const UPLOAD_TIMEOUT_MS = 90000; // tạo report có ảnh có thể mất hơn 60s với nhiều ảnh

/**
 * Gọi thẳng Apps Script Web App bằng fetch() và đọc JSON trả về.
 * Thay cho cơ chế iframe + postMessage cũ: cơ chế đó từng khiến app báo lỗi/timeout
 * dù phía Drive đã nhận và lưu file thành công — vì phản hồi qua postMessage không
 * phải lúc nào cũng tới được cửa sổ chính (phụ thuộc trình duyệt / iframe lồng nhau
 * của Apps Script). fetch() đọc thẳng response của doPost/doGet nên không bị vậy.
 */
async function driveRequest(payload, { timeoutMs = UPLOAD_TIMEOUT_MS } = {}) {
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
  const { fileName, originalName, ...driveMeta } = meta;
  try {
    const result = await driveRequest({
      action: "upload",
      kind,
      base64: await blobToBase64(blob),
      mime: blob.type || "image/jpeg",
      meta: driveMeta,
      file_name: fileName || "",
      original_name: originalName || ""
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