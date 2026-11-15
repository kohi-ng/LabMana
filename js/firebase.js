// ============ Firebase: khởi tạo (Auth email/mật khẩu + Firestore) ============
// Đăng nhập do js/auth.js quản lý; ở đây chỉ khởi tạo SDK.
// Ảnh KHÔNG đi qua Firebase Storage — xem js/drive.js (Google Drive qua Apps Script).
import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export { firebaseConfig };
export const isConfigured = !Object.values(firebaseConfig).some(v => String(v).startsWith("YOUR_"));

let app = null, auth = null, db = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    // Bộ nhớ đệm ngoại tuyến: mất mạng vẫn xem/ghi được, có mạng lại tự đồng bộ.
    // Khi đăng xuất, js/auth.js xóa cache này để tài khoản khác dùng chung máy không thấy dữ liệu cũ.
    db = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (e) {
    console.warn("Không bật được cache ngoại tuyến, dùng Firestore thường:", e);
    db = getFirestore(app);
  }
}

export { app, auth, db };
