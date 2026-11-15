// ============ Firebase: khởi tạo + đăng nhập ẩn danh ============
// Chỉ dùng Firestore (dữ liệu chữ/số/trạng thái) + Auth ẩn danh.
// Ảnh KHÔNG đi qua Firebase Storage nữa — xem js/drive.js (Google Drive qua Apps Script).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

/** Resolve khi đã đăng nhập ẩn danh xong; reject nếu lỗi / chưa cấu hình. */
export const ready = isConfigured
  ? signInAnonymously(auth).then(cred => cred.user)
  : Promise.reject(new Error("NOT_CONFIGURED"));
ready.catch(() => {}); // tránh cảnh báo "unhandled rejection"; lỗi được xử lý trong store.js