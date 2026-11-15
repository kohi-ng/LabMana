// ============ Firebase: khởi tạo (Auth email/mật khẩu + Firestore) ============
// Đăng nhập do js/auth.js quản lý; ở đây chỉ khởi tạo SDK.
// Ảnh KHÔNG đi qua Firebase Storage — xem js/drive.js (Google Drive qua Apps Script).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Khóa Web của Firebase vốn công khai (không phải bí mật). Nên giới hạn theo HTTP referrer
// (kohi-ng.github.io) trong Google Cloud Console → APIs & Services → Credentials.
export const firebaseConfig = {
    apiKey: "AIzaSyCTWIJ-0U_-Eq-lrcoIoyQeZfyi0JJdPp8",
    authDomain: "labmana-ecd8e.firebaseapp.com",
    projectId: "labmana-ecd8e",
    storageBucket: "labmana-ecd8e.firebasestorage.app",
    messagingSenderId: "154892871633",
    appId: "1:154892871633:web:3b71c116d36b31734162f0",
    measurementId: "G-FTQPCSTE7V"
  };

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
