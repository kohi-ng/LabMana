// ============ Màn hình đăng nhập / nâng cấp phiên cũ / chờ quyền ============
import { session, onSession, signIn, signUp, resetPassword, authMessage, signOutAndWipe, SUPER_ADMIN_UID } from "./auth.js";
import { esc } from "./utils.js";

const gate = document.getElementById("auth-gate");
let mode = "signin";          // signin | signup | reset
let message = null;           // { text, ok }
let busy = false;
let lastEmail = "";

function card(inner) { return `<div class="auth-card"><h1>LABMANA</h1>${inner}</div>`; }

function formHtml() {
  const anon = session.status === "anonymous";
  const isOwner = anon && session.user?.uid === SUPER_ADMIN_UID;
  const tabs = anon
    ? `<div class="auth-tabs"><button type="button" class="${mode === "signup" ? "active" : ""}" data-mode="signup">Tạo tài khoản (giữ dữ liệu)</button><button type="button" class="${mode === "signin" ? "active" : ""}" data-mode="signin">Đã có tài khoản</button></div>`
    : `<div class="auth-tabs"><button type="button" class="${mode === "signin" ? "active" : ""}" data-mode="signin">Đăng nhập</button><button type="button" class="${mode === "signup" ? "active" : ""}" data-mode="signup">Đăng ký</button></div>`;
  const note = anon ? `<div class="auth-note">${isOwner
    ? "<b>Thiết bị này đang giữ phiên của chủ dự án (Super Admin).</b> Hãy bấm <b>Tạo tài khoản</b> để gắn email + mật khẩu vào đúng phiên này — UID và toàn bộ dữ liệu được giữ nguyên."
    : "Thiết bị này còn phiên tạm của bản cũ. Bấm <b>Tạo tài khoản</b> để gắn email + mật khẩu vào phiên này (giữ nguyên dữ liệu đã gắn với nó)."}
    Mã phiên: <span class="mono">${esc(session.user.uid.slice(0, 8))}…</span></div>` : "";
  const reset = mode === "reset";
  return card(`<p class="muted small">Đăng nhập để vào không gian làm việc của bạn.</p>${note}
    ${reset ? `<div class="auth-tabs"><button type="button" class="active" data-mode="signin">← Quay lại đăng nhập</button></div>` : tabs}
    <form id="auth-form" novalidate>
      <label class="lbl">Email<input class="inp" name="email" type="email" autocomplete="email" value="${esc(lastEmail)}" required></label>
      ${reset ? "" : `<label class="lbl">Mật khẩu<input class="inp" name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" minlength="6" required></label>`}
      <button class="btn primary block big" type="submit" ${busy ? "disabled" : ""}>${busy ? "Đang xử lý…" : reset ? "Gửi email đặt lại mật khẩu" : mode === "signup" ? (anon ? "Tạo tài khoản & giữ dữ liệu" : "Đăng ký") : "Đăng nhập"}</button>
    </form>
    ${message ? `<div class="auth-msg ${message.ok ? "ok" : ""}">${esc(message.text)}</div>` : ""}
    ${!reset ? `<p style="margin-top:14px"><button type="button" class="link-btn" data-mode="reset">Quên mật khẩu?</button></p>` : ""}
    ${anon ? `<p style="margin-top:6px"><button type="button" class="link-btn muted" data-act="discard">Bỏ phiên tạm này</button></p>` : ""}`);
}

function render() {
  const s = session.status;
  const locked = s !== "active";
  document.body.classList.toggle("locked", locked);
  gate.hidden = !locked;
  if (!locked) { gate.innerHTML = ""; return; }

  if (s === "loading") { gate.innerHTML = card(`<p class="muted">Đang kiểm tra đăng nhập…</p>`); return; }
  if (s === "blocked") {
    gate.innerHTML = card(`<div class="auth-note"><b>Tài khoản chưa được phép truy cập</b> (trạng thái: ${esc(session.profile?.status || "?")}). Hãy liên hệ quản trị viên LabMana.</div>
      <p class="muted small">Đăng nhập là <b>${esc(session.user?.email || "")}</b></p>
      <button class="btn block" data-act="signout">Đăng xuất</button>`);
    return;
  }
  if (s === "error") {
    const e = session.error || "";
    const hint = e === "NOT_CONFIGURED" ? "Chưa có firebaseConfig trong js/firebase.js."
      : /permission-denied/.test(e) ? "Firestore Rules chưa được cập nhật. Dán nội dung firestore.rules vào Firebase Console → Firestore → Rules → Publish (xem README)."
      : e;
    gate.innerHTML = card(`<div class="auth-note"><b>Không thể khởi tạo tài khoản.</b><br>${esc(hint)}</div>
      <button class="btn block" data-act="reload">Thử lại</button>
      ${session.user ? `<button class="btn block ghost" data-act="signout" style="margin-top:8px">Đăng xuất</button>` : ""}`);
    return;
  }
  gate.innerHTML = formHtml();
}

gate.addEventListener("click", async e => {
  const modeBtn = e.target.closest("[data-mode]");
  if (modeBtn) { mode = modeBtn.dataset.mode; message = null; render(); return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "reload") location.reload();
  if (act === "signout") signOutAndWipe();
  if (act === "discard" && confirm("Bỏ phiên tạm? Dữ liệu gắn với phiên này sẽ không truy cập được từ thiết bị này nữa (vẫn còn trên máy chủ).")) signOutAndWipe();
});

gate.addEventListener("submit", async e => {
  e.preventDefault();
  if (busy) return;
  const f = new FormData(e.target);
  const email = String(f.get("email") || "").trim(), password = String(f.get("password") || "");
  lastEmail = email;
  if (!email) { message = { text: "Hãy nhập email." }; return render(); }
  busy = true; message = null; render();
  try {
    if (mode === "reset") { await resetPassword(email); message = { text: "Đã gửi email đặt lại mật khẩu (kiểm tra cả mục Spam).", ok: true }; }
    else if (mode === "signup") await signUp(email, password);
    else await signIn(email, password);
  } catch (err) { message = { text: authMessage(err) }; }
  busy = false; render();
});

onSession(render);
render();
