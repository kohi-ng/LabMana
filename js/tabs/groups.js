// ============ Tab Nhóm: tài khoản, nhóm của tôi, yêu cầu lập nhóm, chia sẻ, Super Admin Console ============
// Mọi thao tác đặc quyền đi qua Firestore Rules (không có backend riêng): Rules kiểm tra role/membership/status.
import { db } from "../firebase.js";
import { session, onSession, isSuperAdmin, signOutAndWipe, resetPassword, authMessage } from "../auth.js";
import { ws, myGroups, setWorkspace, ROLE_LABEL } from "../workspace.js";
import { state, on } from "../store.js";
import { approveShare, revokeShare } from "../sharing.js";
import { logAudit } from "../audit.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, query, where, limit, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, toast, confirmBox, promptBox, fmtTime } from "../utils.js";

let root, view = "main", loading = false;
const data = { requests: [], myRequests: [], members: {}, shares: {}, allGroups: [], audit: [], loadedAt: 0 };

export function init(el) {
  root = el;
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  on("workspace", () => { if (!root.hidden) refresh(); });
  onSession(() => { if (!root.hidden) refresh(); else render(); });
  render();
}
export function onShow() { refresh(); }

const adminGroups = () => myGroups().filter(g => g.role === "group_admin");
const tsText = ms => ms ? new Date(ms).toLocaleString("vi-VN") : "";
const safe = async (p, fallback) => { try { return await p; } catch (e) { console.warn(e.code || e.message); return fallback; } };

async function refresh() {
  if (session.status !== "active") return;
  loading = true; render();
  const uid = session.user.uid;
  data.myRequests = (await safe(getDocs(query(collection(db, "group_requests"), where("requested_by", "==", uid))), { docs: [] }))
    .docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
  for (const g of myGroups()) {
    data.members[g.id] = (await safe(getDocs(query(collection(db, "memberships"), where("group_id", "==", g.id))), { docs: [] }))
      .docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.role === "group_admin" ? -1 : 1) - (b.role === "group_admin" ? -1 : 1));
    if (g.role === "group_admin") {
      data.shares[g.id] = (await safe(getDocs(query(collection(db, "resource_shares"),
        where("source_scope", "==", "group"), where("source_group_id", "==", g.id))), { docs: [] }))
        .docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
    }
  }
  // Chia sẻ do chính mình (Personal) tạo
  data.shares.personal = (await safe(getDocs(query(collection(db, "resource_shares"),
    where("source_scope", "==", "personal"), where("source_owner_uid", "==", uid))), { docs: [] }))
    .docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
  if (isSuperAdmin()) {
    data.requests = (await safe(getDocs(query(collection(db, "group_requests"), where("status", "==", "pending"))), { docs: [] }))
      .docs.map(d => ({ id: d.id, ...d.data() }));
    data.allGroups = (await safe(getDocs(collection(db, "groups")), { docs: [] })).docs.map(d => ({ id: d.id, ...d.data() }));
    data.audit = (await safe(getDocs(query(collection(db, "audit_logs"), orderBy("timestamp_ms", "desc"), limit(60))), { docs: [] }))
      .docs.map(d => ({ id: d.id, ...d.data() }));
  }
  loading = false; data.loadedAt = Date.now(); render();
}

/* ------------------------------ vẽ ------------------------------ */
function render() {
  if (!root) return;
  if (session.status !== "active") { root.innerHTML = ""; return; }
  const u = session.user, sup = isSuperAdmin();
  const subs = [["main", "Nhóm của tôi"], ["shares", "Chia sẻ"], ["account", "Tài khoản"], ...(sup ? [["admin", "Quản trị hệ thống"]] : [])];
  root.innerHTML = `
    <div class="page-head"><h2>Nhóm</h2></div>
    <div class="subtabs">${subs.map(([k, l]) => `<button type="button" data-view="${k}" class="${view === k ? "active" : ""}">${l}</button>`).join("")}
      <button type="button" data-act="reload" ${loading ? "disabled" : ""}>${loading ? "Đang tải…" : "Làm mới"}</button></div>
    ${view === "main" ? mainHtml() : view === "shares" ? sharesHtml() : view === "account" ? accountHtml(u, sup) : adminHtml()}`;
}

function mainHtml() {
  const groups = myGroups();
  const cur = state.workspace;
  return `
    <div class="sec-card"><h3>Không gian hiện tại</h3>
      <div class="kv"><span>Đang làm việc</span><span><b>${esc(cur.name)}</b></span></div>
      <div class="kv"><span>Vai trò của bạn</span><span>${esc(ROLE_LABEL[cur.role] || cur.role)}</span></div>
      <p class="tiny muted" style="margin-top:8px">Chọn không gian ở ô trên cùng bên phải. Dữ liệu Cá nhân chỉ mình bạn thấy; Quản trị nhóm không đọc được.</p></div>
    ${groups.length ? groups.map(groupCard).join("") : `<div class="empty">Bạn chưa thuộc nhóm nào. Gửi yêu cầu bên dưới hoặc nhờ Quản trị nhóm thêm bạn bằng email <b>${esc(session.user.email)}</b>.</div>`}
    <div class="sec-card"><h3>Đề nghị lập nhóm mới</h3>
      <p class="tiny muted">Super Admin sẽ xem xét. Khi được duyệt bạn trở thành Quản trị nhóm.</p>
      <form id="req-form"><label class="lbl">Tên nhóm<input class="inp" name="name" maxlength="80" required></label>
      <label class="lbl">Mục đích / mô tả<textarea class="inp" name="desc" rows="2" maxlength="300"></textarea></label>
      <button class="btn primary" type="submit">Gửi yêu cầu</button></form>
      ${data.myRequests.length ? `<div class="list" style="margin-top:12px">${data.myRequests.map(r => `<div class="row" style="display:block"><div class="row-title">${esc(r.requested_name)} <span class="badge ${r.status === "approved" ? "ok" : r.status === "rejected" ? "err" : "warn"}">${esc(r.status)}</span></div>
        ${r.reason ? `<div class="row-meta">Lý do: ${esc(r.reason)}</div>` : ""}</div>`).join("")}</div>` : ""}
    </div>`;
}

function groupCard(g) {
  const members = (data.members[g.id] || []).filter(m => m.status === "active");
  const admin = g.role === "group_admin";
  return `<div class="sec-card" data-g="${esc(g.id)}"><h3>${esc(g.name)} <span class="badge">${esc(ROLE_LABEL[g.role])}</span></h3>
    ${g.description ? `<p class="muted small">${esc(g.description)}</p>` : ""}
    <div class="kv"><span>Mã nhóm (để nhận chia sẻ)</span><span class="mono">${esc(g.id)}</span></div>
    <div class="btn-row"><button class="btn sm" data-act="switch" data-g="${esc(g.id)}">Làm việc trong nhóm này</button>
      ${g.role === "member" ? `<button class="btn sm danger" data-act="leave" data-g="${esc(g.id)}">Rời nhóm</button>` : ""}</div>
    <h4 style="margin:12px 0 4px">Thành viên (${members.length})</h4>
    ${members.map(m => `<div class="kv"><span>${esc(m.display_name || m.email || m.uid)}<br><span class="tiny muted">${esc(m.email || "")}</span></span>
      <span>${esc(ROLE_LABEL[m.role])}${admin && m.role === "member" ? ` <button class="link-btn danger" data-act="remove" data-g="${esc(g.id)}" data-uid="${esc(m.uid)}">Xóa</button>` : ""}</span></div>`).join("")}
    ${admin ? `<form data-add-member="${esc(g.id)}" class="inline" style="margin-top:10px"><input class="inp sm" name="email" type="email" placeholder="Email thành viên (đã đăng ký)" required><button class="btn sm primary" type="submit">Thêm</button></form>
      <p class="tiny muted">Chỉ thêm được tài khoản đã đăng nhập LabMana ít nhất một lần. Biết mã nhóm không đủ để tham gia.</p>` : ""}
  </div>`;
}

function shareRow(s, canAct) {
  const where = s.recipient_type === "user" ? "tài khoản" : "nhóm";
  return `<div class="row" style="display:block"><div class="row-title">${esc(s.title || s.resource_id)} <span class="badge ${s.status === "active" ? "ok" : s.status === "pending" ? "warn" : "err"}">${esc(s.status)}</span></div>
    <div class="row-meta">→ ${where} <span class="mono">${esc(s.recipient_id.slice(0, 12))}…</span> · chỉ xem${s.expires_at?.toMillis ? " · hết hạn " + tsText(s.expires_at.toMillis()) : ""}</div>
    ${canAct ? `<div class="row-actions">${s.status === "pending" ? `<button class="link-btn" data-act="approve-share" data-id="${esc(s.id)}">Duyệt</button><button class="link-btn danger" data-act="reject-share" data-id="${esc(s.id)}">Từ chối</button>` : ""}
      ${s.status === "active" ? `<button class="link-btn danger" data-act="revoke-share" data-id="${esc(s.id)}">Thu hồi</button>` : ""}</div>` : ""}</div>`;
}

function sharesHtml() {
  const personal = data.shares.personal || [];
  const groupBlocks = adminGroups().map(g => `<h3 style="margin:16px 0 6px">${esc(g.name)}</h3><div class="list">${(data.shares[g.id] || []).map(s => shareRow(s, true)).join("") || `<div class="empty">Chưa có chia sẻ.</div>`}</div>`).join("");
  return `<p class="muted small">Chia sẻ một bài: tab <b>Kế hoạch</b> → nút <b>Chia sẻ</b> trên bài. Người nhận chỉ xem, không sửa/xóa/chia sẻ tiếp.</p>
    <h3 style="margin:16px 0 6px">Từ không gian Cá nhân</h3><div class="list">${personal.map(s => shareRow(s, true)).join("") || `<div class="empty">Chưa có chia sẻ.</div>`}</div>${groupBlocks}`;
}

function accountHtml(u, sup) {
  return `<div class="sec-card"><h3>Tài khoản</h3>
    <div class="kv"><span>Email</span><span>${esc(u.email || "")}</span></div>
    <div class="kv"><span>Trạng thái</span><span><span class="badge ok">${esc(session.profile?.status || "active")}</span></span></div>
    <div class="kv"><span>Vai trò hệ thống</span><span>${sup ? "Super Admin" : "Người dùng"}</span></div>
    <div class="kv"><span>UID</span><span class="mono">${esc(u.uid)}</span></div>
    <div class="btn-row"><button class="btn" data-act="reset-pw">Gửi email đổi mật khẩu</button><button class="btn danger" data-act="signout">Đăng xuất</button></div>
    <p class="tiny muted">Đăng xuất xóa bộ nhớ đệm ngoại tuyến trên thiết bị này.</p></div>`;
}

function adminHtml() {
  return `<div class="sec-card"><h3>Yêu cầu lập nhóm (${data.requests.length})</h3>
    ${data.requests.map(r => `<div class="row" style="display:block"><div class="row-title">${esc(r.requested_name)}</div>
      <div class="row-meta">${esc(r.description || "")} · đề xuất bởi <span class="mono">${esc(r.requested_email || r.requested_by)}</span></div>
      <div class="row-actions"><button class="link-btn" data-act="approve-group" data-id="${esc(r.id)}">Duyệt</button><button class="link-btn danger" data-act="reject-group" data-id="${esc(r.id)}">Từ chối</button></div></div>`).join("") || `<div class="empty">Không có yêu cầu.</div>`}</div>
    <div class="sec-card"><h3>Tất cả nhóm (${data.allGroups.length})</h3>
    ${data.allGroups.map(g => `<div class="row" style="display:block"><div class="row-title">${esc(g.name)} <span class="badge ${g.status === "active" ? "ok" : "err"}">${esc(g.status)}</span></div>
      <div class="row-meta mono">${esc(g.id)} · ${esc(g.code || "")}</div>
      <div class="row-actions"><button class="link-btn" data-act="toggle-group" data-id="${esc(g.id)}">${g.status === "active" ? "Đình chỉ" : "Khôi phục"}</button>
      <button class="link-btn" data-act="set-admin" data-id="${esc(g.id)}">Đổi Quản trị nhóm</button></div></div>`).join("") || `<div class="empty">Chưa có nhóm.</div>`}</div>
    <div class="sec-card"><h3>Nhật ký thao tác (60 gần nhất)</h3>
    ${data.audit.map(a => `<div class="kv"><span>${esc(a.action)} · ${esc(a.target_type)}<br><span class="tiny muted">${esc(a.actor_email || a.actor_uid)}</span></span><span class="tiny">${esc(tsText(a.timestamp_ms))}</span></div>`).join("") || `<div class="empty">Trống.</div>`}</div>
    <p class="tiny muted">Super Admin không đọc được dữ liệu Cá nhân của người khác. Dữ liệu cũ chưa gắn chủ được gán bằng <code>migration/migrate.mjs</code> (xem README).</p>`;
}

/* ------------------------------ hành động ------------------------------ */
async function addMember(groupId, email) {
  const e = email.trim().toLowerCase();
  const idx = await getDoc(doc(db, "user_emails", e));
  if (!idx.exists()) throw new Error("Không tìm thấy tài khoản này. Người đó cần đăng ký/đăng nhập LabMana trước.");
  const uid = idx.data().uid;
  await setDoc(doc(db, "memberships", `${groupId}__${uid}`), {
    uid, group_id: groupId, role: "member", status: "active", email: e,
    display_name: e.split("@")[0], added_by: session.user.uid, joined_at_ms: Date.now()
  });
  logAudit("member.add", "membership", `${groupId}__${uid}`, groupId, { email: e });
}

async function onSubmit(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    if (e.target.id === "req-form") {
      const name = String(f.get("name") || "").trim();
      await setDoc(doc(collection(db, "group_requests")), {
        requested_name: name, description: String(f.get("desc") || "").trim(),
        requested_by: session.user.uid, requested_email: session.user.email || "", proposed_admin_uid: session.user.uid,
        status: "pending", created_at_ms: Date.now()
      });
      toast("Đã gửi yêu cầu, chờ Super Admin duyệt", "success"); e.target.reset();
    } else if (e.target.dataset.addMember) {
      await addMember(e.target.dataset.addMember, String(f.get("email")));
      toast("Đã thêm thành viên", "success");
    } else return;
    refresh();
  } catch (err) { toast("Lỗi: " + (err.code === "permission-denied" ? "bị từ chối quyền" : err.message), "error", 5000); }
}

async function onClick(e) {
  const v = e.target.closest("[data-view]");
  if (v) { view = v.dataset.view; render(); return; }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const { act, g, uid, id } = btn.dataset;
  const me = session.user.uid;
  try {
    if (act === "reload") return refresh();
    if (act === "signout") return signOutAndWipe();
    if (act === "reset-pw") { await resetPassword(session.user.email); return toast("Đã gửi email đổi mật khẩu", "success"); }
    if (act === "switch") { setWorkspace("group:" + g); return toast("Đã chuyển không gian", "success"); }
    if (act === "leave") {
      if (!(await confirmBox("Rời nhóm này? Tài nguyên bạn tạo vẫn ở lại nhóm.", "Rời nhóm"))) return;
      await updateDoc(doc(db, "memberships", `${g}__${me}`), { status: "left", updated_at_ms: Date.now() });
      logAudit("member.leave", "membership", `${g}__${me}`, null);
      setWorkspace("personal"); return refresh();
    }
    if (act === "remove") {
      if (!(await confirmBox("Xóa thành viên này khỏi nhóm? Họ mất quyền ngay; dữ liệu họ tạo vẫn ở lại.", "Xóa"))) return;
      await updateDoc(doc(db, "memberships", `${g}__${uid}`), { status: "revoked", updated_at_ms: Date.now() });
      logAudit("member.remove", "membership", `${g}__${uid}`, g); toast("Đã xóa thành viên", "success"); return refresh();
    }
    if (act === "approve-share" || act === "reject-share" || act === "revoke-share") {
      const s = Object.values(data.shares).flat().find(x => x.id === id);
      if (!s) return;
      if (act === "approve-share") await approveShare(s); else await revokeShare(s, act === "reject-share" ? "rejected" : "revoked");
      toast("Đã cập nhật", "success"); return refresh();
    }
    /* ---- Super Admin ---- */
    if (act === "approve-group") {
      const r = data.requests.find(x => x.id === id); if (!r) return;
      const adminDoc = await getDoc(doc(db, "users", r.proposed_admin_uid));
      if (!adminDoc.exists()) throw new Error("Tài khoản đề xuất làm Quản trị chưa có hồ sơ.");
      const gref = doc(collection(db, "groups"));
      const code = "LAB-" + gref.id.slice(0, 5).toUpperCase();
      const adminData = adminDoc.data();
      const b = writeBatch(db);
      b.set(gref, { name: r.requested_name, description: r.description || "", code, status: "active", created_by: r.requested_by,
        admin_uid: r.proposed_admin_uid, approved_by: me, approved_at_ms: Date.now(), created_at_ms: Date.now() });
      b.set(doc(db, "memberships", `${gref.id}__${r.proposed_admin_uid}`), {
        uid: r.proposed_admin_uid, group_id: gref.id, role: "group_admin", status: "active", email: adminData.email || "",
        display_name: adminData.display_name || "", added_by: me, joined_at_ms: Date.now() });
      b.update(doc(db, "group_requests", id), { status: "approved", reviewed_by: me, reviewed_at_ms: Date.now(), group_id: gref.id });
      await b.commit();
      logAudit("group.approve", "group", gref.id, null, { name: r.requested_name });
      toast("Đã duyệt và tạo nhóm", "success"); return refresh();
    }
    if (act === "reject-group") {
      const reason = await promptBox({ title: "Từ chối yêu cầu", label: "Lý do", placeholder: "Ví dụ: trùng nhóm đã có" });
      if (reason === null) return;
      await updateDoc(doc(db, "group_requests", id), { status: "rejected", reason, reviewed_by: me, reviewed_at_ms: Date.now() });
      logAudit("group.reject", "group_request", id, null, { reason }); return refresh();
    }
    if (act === "toggle-group") {
      const grp = data.allGroups.find(x => x.id === id); const next = grp.status === "active" ? "suspended" : "active";
      if (!(await confirmBox(next === "suspended" ? "Đình chỉ nhóm? Mọi thành viên mất quyền truy cập ngay (dữ liệu được giữ)." : "Khôi phục nhóm?", "Đồng ý"))) return;
      await updateDoc(doc(db, "groups", id), { status: next, updated_at_ms: Date.now() });
      logAudit("group." + next, "group", id, null); return refresh();
    }
    if (act === "set-admin") {
      const email = await promptBox({ title: "Đổi Quản trị nhóm", label: "Email của Quản trị mới (đã đăng ký)", placeholder: "admin@example.com" });
      if (!email) return;
      const idx = await getDoc(doc(db, "user_emails", email.toLowerCase()));
      if (!idx.exists()) throw new Error("Không tìm thấy tài khoản này.");
      const newUid = idx.data().uid, grp = data.allGroups.find(x => x.id === id);
      const b = writeBatch(db);
      if (grp.admin_uid && grp.admin_uid !== newUid) b.update(doc(db, "memberships", `${id}__${grp.admin_uid}`), { role: "member", updated_at_ms: Date.now() });
      b.set(doc(db, "memberships", `${id}__${newUid}`), { uid: newUid, group_id: id, role: "group_admin", status: "active",
        email: email.toLowerCase(), display_name: email.split("@")[0], added_by: me, joined_at_ms: Date.now() });
      b.update(doc(db, "groups", id), { admin_uid: newUid, updated_at_ms: Date.now() });
      await b.commit();
      logAudit("group.set_admin", "group", id, null, { new_admin_uid: newUid }); toast("Đã đổi Quản trị nhóm", "success"); return refresh();
    }
  } catch (err) { console.error(err); toast("Lỗi: " + (err.code === "permission-denied" ? "bị từ chối quyền" : (err.code ? authMessage(err) : err.message)), "error", 5000); }
}
