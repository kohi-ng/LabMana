// ============ Drive: tải / xóa ảnh qua Google Apps Script Web App ============
import { blobToBase64, blobToDataUrl } from "./utils.js";

export const GAS_URL = "https://script.google.com/macros/s/AKfycbwzMsHgnhZRY4dW8w8H41RmuVN3Bnv4dU6csKGYeHcCYZUFhnaWpjCUybXqmi4HW3R-rA/exec";
const GOOGLE_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(googleusercontent|google)\.com$/;
export const isDriveConfigured = !!GAS_URL && !GAS_URL.startsWith("DÁN_");

/**
 * Gửi form trong iframe để tránh lỗi CORS/redirect của Apps Script.
 * code.gs trả kết quả bằng postMessage; kiểm tra source iframe và request ID.
 */
function driveRequest(payload) {
  if (!isDriveConfigured) return Promise.reject(new Error("NOT_CONFIGURED_DRIVE"));

  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const frame = document.createElement("iframe");
  frame.name = `labmana-drive-${requestId}`;
  frame.title = "Kết nối Google Drive";
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");

  const form = document.createElement("form");
  form.method = "POST";
  form.action = GAS_URL;
  form.target = frame.name;
  form.hidden = true;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify({ ...payload, request_id: requestId });
  form.append(input);

  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      form.remove();
      frame.remove();
    };
    const onMessage = event => {
      // Apps Script trả kết quả từ iframe lồng nhau (*.googleusercontent.com) nên không so sánh được
      // với frame.contentWindow; thay vào đó kiểm tra origin của Google + mã yêu cầu ngẫu nhiên.
      if (!GOOGLE_ORIGIN.test(event.origin) || event.data?.source !== "labmana-drive" ||
          event.data?.requestId !== requestId) return;
      cleanup();
      const result = event.data.result;
      if (!result?.ok) return reject(new Error(result?.error || "Google Drive từ chối yêu cầu."));
      resolve(result);
    };

    window.addEventListener("message", onMessage);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("Hết thời gian chờ Google Drive. Hãy triển khai phiên bản code.gs mới rồi thử lại."));
    }, 60000);
    document.body.append(frame, form);
    try { form.submit(); }
    catch (err) {
      cleanup();
      reject(new Error(`Không gửi được yêu cầu tới Google Drive: ${err.message}`));
    }
  });
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