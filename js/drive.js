// ============ Drive: tải / xóa ảnh qua Google Apps Script Web App ============
// 👉 DÁN URL Web App (deploy từ gas/code.gs) vào GAS_URL bên dưới. Xem gas/README.md.
import { blobToBase64, blobToDataUrl } from "./utils.js";

export const GAS_URL = "https://script.google.com/macros/s/AKfycbwzMsHgnhZRY4dW8w8H41RmuVN3Bnv4dU6csKGYeHcCYZUFhnaWpjCUybXqmi4HW3R-rA/exec";
export const isDriveConfigured = !!GAS_URL && !GAS_URL.startsWith("DÁN_");

/**
 * Tải 1 ảnh (blob đã nén) lên Drive qua GAS.
 * `kind`: "plan" (ảnh minh họa kế hoạch) | "log" (ảnh chụp khi thực hiện) — quyết định cách đặt tên trên Drive.
 * `meta`: { expTitle, sectionName, stepLabel, runName } dùng để đặt tên file rõ ràng theo bài/phần.
 * Trả về { file_id, url, name }.
 */
export async function driveUpload(blob, kind, meta = {}) {
  if (!isDriveConfigured) throw new Error("NOT_CONFIGURED_DRIVE");
  const base64 = await blobToBase64(blob);
  const body = {
    action: "upload",
    kind,
    base64,
    mime: blob.type || "image/jpeg",
    meta
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let res, text;
  try {
    res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    text = await res.text();
  } catch (err) {
    if (kind === "log") {
      console.warn("Không đọc được xác nhận Drive; giữ ảnh đính kèm dự phòng:", err);
      return imageFallback(blob);
    }
    if (err.name === "AbortError") throw new Error("Hết thời gian chờ Google Drive phản hồi.");
    throw new Error(`Không nhận được xác nhận từ Google Drive (${err.message}). Ảnh có thể đã tải lên; hãy kiểm tra Drive trước khi thử lại.`);
  } finally {
    clearTimeout(timeout);
  }
  let data;
  try { data = JSON.parse(text); }
  catch {
    if (kind === "log") {
      console.warn("Drive trả phản hồi không đọc được; giữ ảnh đính kèm dự phòng.");
      return imageFallback(blob);
    }
    const detail = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`Google Drive trả về phản hồi không hợp lệ (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  if (data?.file_id && data?.url) {
    return { file_id: data.file_id, url: data.url, name: data.name || "" };
  }
  if (!res.ok || !data?.ok) {
    if (kind === "log") {
      console.warn("Drive không xác nhận tải ảnh; giữ ảnh đính kèm dự phòng:", data?.error || res.status);
      return imageFallback(blob);
    }
    throw new Error(data?.error || `Tải ảnh lên Drive thất bại (HTTP ${res.status})`);
  }
  if (!data.file_id || !data.url) {
    if (kind === "log") return imageFallback(blob);
    throw new Error("Drive đã phản hồi nhưng thiếu mã hoặc đường dẫn ảnh.");
  }
  return { file_id: data.file_id, url: data.url, name: data.name };
}

async function imageFallback(blob) {
  return {
    file_id: "",
    url: await blobToDataUrl(blob),
    name: "Ảnh đính kèm dự phòng",
    storage_fallback: true
  };
}

/** Xóa 1 ảnh khỏi Drive theo file_id (không chặn UI nếu lỗi — ảnh mồ côi dọn tay sau). */
export async function driveDelete(fileId) {
  if (!isDriveConfigured || !fileId) return;
  try {
    await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "delete", file_id: fileId })
    });
  } catch (e) { console.warn("Xóa ảnh Drive lỗi (bỏ qua):", e); }
}