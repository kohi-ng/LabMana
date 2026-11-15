// ============ Auth: Email + mật khẩu, nâng cấp phiên ẩn danh cũ, hồ sơ tài khoản ============
// - Không còn signInAnonymously(). Phiên ẩn danh cũ trên thiết bị được NÂNG CẤP (linkWithCredential)
//   để giữ nguyên UID (đặc biệt UID Super Admin) và toàn bộ dữ liệu đã gắn với UID đó.
// - Trạng thái phiên: loading | signed-out | anonymous | blocked | error | active
import { auth, db, isConfigured } from "./firebase.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, EmailAuthProvider,
  linkWithCredential, sendPasswordResetEmail, sendEmailVerification, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, terminate, clearIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** UID chủ dự án. PHẢI trùng hàm isSuperAdmin() trong firestore.rules. */
export const SUPER_ADMIN_UID = "Eq1ueE9VHoYIbNk3UU5gnQOwJBg1";

export const session = { status: "loading", user: null, profile: null, error: null };
const subs = new Set();
export function onSession(fn) { subs.add(fn); return () => subs.delete(fn); }
function setSession(patch) {
  Object.assign(session, patch);
  subs.forEach(fn => { try { fn(session); } catch (e) { console.error(e); } });
}

export const isSuperAdmin = () => session.user?.uid === SUPER_ADMIN_UID;
export const currentUid = () => session.user?.uid || null;

const VI_ERRORS = {
  "auth/invalid-email": "Email không hợp lệ.",
  "auth/missing-password": "Hãy nhập mật khẩu.",
  "auth/weak-password": "Mật khẩu cần tối thiểu 6 ký tự.",
  "auth/email-already-in-use": "Email này đã có tài khoản — hãy chuyển sang Đăng nhập.",
  "auth/credential-already-in-use": "Email này đã gắn với tài khoản khác — hãy dùng Đăng nhập.",
  "auth/invalid-credential": "Sai email hoặc mật khẩu.",
  "auth/wrong-password": "Sai email hoặc mật khẩu.",
  "auth/user-not-found": "Sai email hoặc mật khẩu.",
  "auth/too-many-requests": "Thử quá nhiều lần. Hãy đợi vài phút rồi thử lại.",
  "auth/network-request-failed": "Mất kết nối mạng.",
  "auth/operation-not-allowed": "Chưa bật đăng nhập Email/Password: Firebase Console → Authentication → Sign-in method → Email/Password.",
  "auth/requires-recent-login": "Cần đăng nhập lại để thực hiện thao tác này."
};
export const authMessage = err => VI_ERRORS[err?.code] || (err?.code ? `${err.code}` : String(err?.message || err));

async function handleUser(user) {
  if (!user) return setSession({ status: "signed-out", user: null, profile: null, error: null });
  if (user.isAnonymous) return setSession({ status: "anonymous", user, profile: null, error: null });
  try {
    const email = String(user.email || "").toLowerCase();
    const ref = doc(db, "users", user.uid);
    let snap = await getDoc(ref);
    const now = Date.now();
    if (!snap.exists()) {
      // Tài khoản mới: mặc định active (quyết định "CẦN XÁC NHẬN" trong docs/ARCHITECTURE.md).
      await setDoc(ref, {
        uid: user.uid, email, display_name: user.displayName || email.split("@")[0],
        status: "active", created_at_ms: now, updated_at_ms: now, last_login_ms: now
      });
      snap = await getDoc(ref);
    } else {
      updateDoc(ref, { last_login_ms: now, updated_at_ms: now }).catch(() => {});
    }
    // Chỉ mục tra cứu uid theo email (Group Admin thêm thành viên bằng email).
    if (email) setDoc(doc(db, "user_emails", email), { uid: user.uid, email, updated_at_ms: now }, { merge: true }).catch(() => {});
    const profile = { id: snap.id, ...snap.data() };
    if (profile.status !== "active" && user.uid !== SUPER_ADMIN_UID) {
      return setSession({ status: "blocked", user, profile, error: null });
    }
    setSession({ status: "active", user, profile, error: null });
  } catch (err) {
    console.error(err);
    setSession({ status: "error", user, profile: null, error: err.code || err.message || String(err) });
  }
}

export function startAuth() {
  if (!isConfigured) return setSession({ status: "error", error: "NOT_CONFIGURED" });
  onAuthStateChanged(auth, user => { handleUser(user); });
}

export async function signIn(email, password) {
  await signInWithEmailAndPassword(auth, String(email).trim(), password);
}

/** Đăng ký. Nếu thiết bị đang có phiên ẩn danh cũ → liên kết vào ĐÚNG UID đó (giữ dữ liệu). */
export async function signUp(email, password) {
  const clean = String(email).trim();
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    const result = await linkWithCredential(current, EmailAuthProvider.credential(clean, password));
    await result.user.getIdToken(true);   // làm mới token: sign_in_provider chuyển từ 'anonymous' sang 'password'
    await handleUser(result.user);        // onAuthStateChanged không chạy lại khi link
    return result.user;
  }
  const cred = await createUserWithEmailAndPassword(auth, clean, password);
  return cred.user;
}

export const resetPassword = email => sendPasswordResetEmail(auth, String(email).trim());
export const verifyEmail = () => sendEmailVerification(auth.currentUser);

/** Lấy ID token mới cho Apps Script (xác minh danh tính phía server). */
export async function getIdToken() {
  if (!auth?.currentUser) throw new Error("Chưa đăng nhập.");
  return auth.currentUser.getIdToken();
}

/** Đăng xuất + xóa cache Firestore ngoại tuyến để dữ liệu không lộ cho tài khoản dùng chung thiết bị. */
export async function signOutAndWipe() {
  try { await signOut(auth); } catch (e) { console.warn(e); }
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) { console.warn("Không xóa được cache:", e); }
  try {
    Object.keys(localStorage).filter(k => k.startsWith("labmana")).forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
  location.reload();
}
