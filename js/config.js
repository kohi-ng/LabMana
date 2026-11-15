// ============ CẤU HÌNH DỰ ÁN — chỗ DUY NHẤT cần điền khi dựng một bản LabMana mới ============
// Xem docs/SETUP-NEW-PROJECT.md. Các giá trị dưới đây là placeholder; app hiện banner "Chưa cấu hình" cho tới khi điền.

// 1) Firebase Console → Project settings → Your apps → Web app → firebaseConfig.
//    Khóa Web là công khai theo thiết kế; nên giới hạn theo HTTP referrer của trang GitHub Pages trong Google Cloud Console.
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 2) Apps Script → Deploy → Web app → URL kết thúc bằng /exec.
export const GAS_URL = "YOUR_APPS_SCRIPT_WEB_APP_URL";

// 3) UID của tài khoản Super Admin (Firebase Console → Authentication → Users → cột "User UID").
//    Phải TRÙNG với `isSuperAdmin()` trong firestore.rules và Script property SUPER_ADMIN_UID của Apps Script.
export const SUPER_ADMIN_UID = "YOUR_SUPER_ADMIN_UID";
