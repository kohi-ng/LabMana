// ============ Drive: tải / xóa ảnh qua Google Apps Script Web App ============
import { blobToBase64 } from "./utils.js";

export const GAS_URL = "https://script.google.com/macros/s/AKfycbyMxFpoicWLq3dg5YNyfePuaSUKO55xoQNx-8EY5MroyMQir-PHiRYUpl5YOXdb8mjcIw/exec";
export const isDriveConfigured = !!GAS_URL && !GAS_URL.startsWith("DÁN_");

const DOCS_EMBED_MAX_BYTES = 2 * 1024 * 1024;

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Không xuất được ảnh JPEG")), type, quality);
  });
}

async function prepareImageBlob(blob) {
  const type = String(blob?.type || "").toLowerCase();
  const embeddable = type === "image/jpeg" || type === "image/png" || type === "image/gif";
  if (embeddable && blob.size <= DOCS_EMBED_MAX_BYTES) return blob;
  if (typeof createImageBitmap !== "function") return blob;
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { return blob; }
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
 * Apps Script ContentService redirects its response to script.googleusercontent.com.
 * Browser fetch() cannot reliably read that cross-origin response (CORS), even when
 * the request uses text/plain. Submit a normal HTML form to a hidden iframe instead;
 * the HtmlService response posts the structured result back with postMessage.
 */
async function driveRequest(payload, { timeoutMs = 45000 } = {}) {
  if (!isDriveConfigured) throw new Error("NOT_CONFIGURED_DRIVE");

  const requestId = `labmana-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const targetName = `labmana-drive-${requestId}`;
  const iframe = document.createElement("iframe");
  iframe.name = targetName;
  iframe.title = "LabMana Drive request";
  iframe.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;bottom:-10px;border:0;opacity:0;pointer-events:none";
  iframe.setAttribute("aria-hidden", "true");

  const form = document.createElement("form");
  form.method = "POST";
  form.action = GAS_URL;
  form.target = targetName;
  form.enctype = "application/x-www-form-urlencoded";
  form.acceptCharset = "UTF-8";

  const payloadInput = document.createElement("textarea");
  payloadInput.name = "payload";
  payloadInput.value = JSON.stringify(payload);
  payloadInput.style.display = "none";
  const requestInput = document.createElement("input");
  requestInput.type = "hidden";
  requestInput.name = "request_id";
  requestInput.value = requestId;
  form.append(payloadInput, requestInput);
  document.body.append(iframe, form);

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      form.remove();
      iframe.remove();
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onMessage = event => {
      // HtmlService may wrap its response in a Google sandbox iframe. In that case
      // event.source is a nested frame, not the form-target iframe itself. Match the
      // unguessable request id and require a Google-served response origin instead.
      if (!/(^|\\.)googleusercontent\\.com$/.test(new URL(event.origin).hostname)) return;
      const data = event.data;
      if (!data || data.labmana !== "drive-response" || data.request_id !== requestId) return;
      if (data.result?.ok) finish(resolve, data.result);
      else finish(reject, new Error(data.result?.error || "Google Drive từ chối yêu cầu."));
    };
    const timer = setTimeout(() => {
      finish(reject, new Error("Apps Script đã nhận yêu cầu nhưng LabMana không nhận được phản hồi sau 45 giây. Kiểm tra deployment GAS có dùng code.gs mới; nếu thư mục đã được tạo mà chưa có file, kiểm tra nhật ký Executions trong Apps Script để xem lỗi tại bước tạo file hoặc cấp quyền chia sẻ."));
    }, timeoutMs);

    window.addEventListener("message", onMessage);
    try {
      form.submit();
    } catch (err) {
      finish(reject, new Error("Không gửi được yêu cầu tới Google Drive: " + String(err?.message || err)));
    }
  });
}

export async function driveUpload(blob, kind, meta = {}) {
  const prepared = await prepareImageBlob(blob);
  const converted = prepared !== blob && prepared.type === "image/jpeg";
  const { fileName, originalName, ...driveMeta } = meta;
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
}

export async function driveCreateReport(report) {
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
