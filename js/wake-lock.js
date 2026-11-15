// Giữ sáng màn hình (Screen Wake Lock API). Lựa chọn được nhớ trong localStorage; tự xin lại khi quay về tab.
const KEY = "labmana.wake";
let sentinel = null, want = false, wired = false;
export const wakeSupported = () => "wakeLock" in navigator;
export const wakeIsOn = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

async function acquire() {
  if (!want || !wakeSupported() || document.visibilityState !== "visible" || sentinel) return !!sentinel;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => { sentinel = null; });
  } catch { sentinel = null; }
  return !!sentinel;
}
function wire() {
  if (wired) return; wired = true;
  document.addEventListener("visibilitychange", acquire);
  // Một số trình duyệt chỉ cho xin khóa sau thao tác của người dùng → thử lại ở lần chạm đầu tiên
  addEventListener("pointerdown", () => { if (want && !sentinel) acquire(); }, { passive: true });
}
/** Gọi khi mở app: bật lại nếu lần trước người dùng đã bật. */
export function restoreWake() { want = wakeIsOn(); wire(); if (want) acquire(); }
/** Bật/tắt. Trả về true nếu trạng thái mong muốn đã đạt được. */
export async function setWake(on) {
  want = !!on; try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ignore */ }
  wire();
  if (on) return acquire();
  try { await sentinel?.release(); } catch { /* ignore */ }
  sentinel = null; return true;
}
