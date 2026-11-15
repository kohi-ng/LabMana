// ============ Chia sẻ chéo workspace bằng Viewer (resource_shares) ============
// id grant xác định: u_<uid>__<expId> | g_<groupId>__<expId>  → Firestore Rules kiểm tra bằng get().
// Viewer chỉ ĐỌC đúng bài được chia sẻ. Thành viên thường chỉ gửi yêu cầu (pending); chủ cá nhân / Group Admin duyệt.
import { db } from "./firebase.js";
import { session } from "./auth.js";
import { ws, myGroups, currentRole, ROLE_LABEL } from "./workspace.js";
import {
  doc, getDoc, setDoc, updateDoc, writeBatch, arrayUnion, arrayRemove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal, toast, esc } from "./utils.js";
import { logAudit } from "./audit.js";

const MAX_USERS = 50, MAX_GROUPS = 2;   // giới hạn do Rules (tối đa 10 lệnh get() mỗi request)

export const shareId = (type, recipientId, resId) => `${type === "user" ? "u" : "g"}_${recipientId}__${resId}`;

/** Người dùng này duyệt thẳng được không (chủ personal hoặc Group Admin nhóm nguồn)? */
function isApprover(exp) {
  if (exp.scope === "personal") return exp.owner_uid === session.user.uid;
  return currentRole() === "group_admin";
}

async function lookupUid(email) {
  const snap = await getDoc(doc(db, "user_emails", String(email).trim().toLowerCase()));
  return snap.exists() ? snap.data().uid : null;
}

/** Tạo grant (active nếu người gọi là approver, pending nếu là người tạo bài). */
export async function createShare(exp, recipientType, recipientId, { expiresMs = null } = {}) {
  const uid = session.user.uid;
  const approver = isApprover(exp);
  const users = exp.shared_user_ids || [], groups = exp.shared_group_ids || [];
  if (recipientType === "user" && recipientId === uid) throw new Error("Không cần chia sẻ cho chính mình.");
  if (recipientType === "group" && exp.scope === "group" && recipientId === exp.group_id) throw new Error("Đó là nhóm đang sở hữu bài này.");
  if (approver) {
    if (recipientType === "user" && !users.includes(recipientId) && users.length >= MAX_USERS) throw new Error(`Tối đa ${MAX_USERS} người nhận cho một bài.`);
    if (recipientType === "group" && !groups.includes(recipientId) && groups.length >= MAX_GROUPS) throw new Error(`Tối đa ${MAX_GROUPS} nhóm nhận cho một bài.`);
  }
  const data = {
    resource_collection: "experiments", resource_id: exp.id, resource_path: `experiments/${exp.id}`,
    source_scope: exp.scope, source_group_id: exp.group_id ?? null, source_owner_uid: exp.owner_uid,
    recipient_type: recipientType, recipient_id: recipientId, permission: "read",
    status: approver ? "active" : "pending", created_by: uid,
    approved_by: approver ? uid : null,
    expires_at: expiresMs ? new Date(expiresMs) : null,
    created_at_ms: Date.now(), updated_at_ms: Date.now(), title: exp.title || ""
  };
  const sid = shareId(recipientType, recipientId, exp.id);
  const batch = writeBatch(db);
  batch.set(doc(db, "resource_shares", sid), data);
  if (approver) {
    batch.update(doc(db, "experiments", exp.id), recipientType === "user"
      ? { shared_user_ids: arrayUnion(recipientId) } : { shared_group_ids: arrayUnion(recipientId) });
  }
  await batch.commit();
  logAudit(approver ? "share.create" : "share.request", "experiment", exp.id, exp.group_id ?? null, { recipient_type: recipientType, recipient_id: recipientId });
  return data.status;
}

/** Duyệt yêu cầu pending → active (Group Admin / chủ). */
export async function approveShare(share) {
  const uid = session.user.uid;
  const batch = writeBatch(db);
  batch.update(doc(db, "resource_shares", share.id), { status: "active", approved_by: uid, updated_at_ms: Date.now() });
  batch.update(doc(db, "experiments", share.resource_id), share.recipient_type === "user"
    ? { shared_user_ids: arrayUnion(share.recipient_id) } : { shared_group_ids: arrayUnion(share.recipient_id) });
  await batch.commit();
  logAudit("share.approve", "experiment", share.resource_id, share.source_group_id ?? null, { share_id: share.id });
}

/** Từ chối (pending) hoặc thu hồi (active): ngừng đọc được ở lần đọc kế tiếp. */
export async function revokeShare(share, status = "revoked") {
  const uid = session.user.uid;
  const batch = writeBatch(db);
  batch.update(doc(db, "resource_shares", share.id), { status, approved_by: uid, updated_at_ms: Date.now() });
  if (share.status === "active") {
    batch.update(doc(db, "experiments", share.resource_id), share.recipient_type === "user"
      ? { shared_user_ids: arrayRemove(share.recipient_id) } : { shared_group_ids: arrayRemove(share.recipient_id) });
  }
  await batch.commit();
  logAudit("share." + status, "experiment", share.resource_id, share.source_group_id ?? null, { share_id: share.id });
}

/** Hộp thoại chia sẻ một bài. */
export function openShareDialog(exp) {
  const approver = isApprover(exp);
  const node = document.createElement("div");
  const others = myGroups().filter(g => g.id !== exp.group_id);
  node.innerHTML = `
    <p class="muted small">Người nhận chỉ <b>xem</b> đúng bài này; không sửa, không xóa, không chia sẻ tiếp, không vào nhóm của bạn.
      ${approver ? "" : "<br>Bạn là thành viên: yêu cầu sẽ chờ Quản trị nhóm duyệt."}</p>
    <label class="lbl">Chia sẻ cho
      <select class="inp" data-f="type"><option value="user">Một tài khoản (email)</option><option value="group">Một nhóm (mã nhóm)</option></select></label>
    <label class="lbl" data-w="user">Email người nhận<input class="inp" type="email" data-f="email" placeholder="ban@example.com"></label>
    <div data-w="group" hidden>
      ${others.length ? `<label class="lbl">Nhóm của tôi<select class="inp" data-f="mygroup"><option value="">— chọn —</option>${others.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select></label>` : ""}
      <label class="lbl">hoặc dán mã nhóm (do Quản trị nhóm nhận cung cấp)<input class="inp mono" data-f="gid"></label>
      <p class="tiny muted">Chỉ thành viên đang hoạt động của nhóm nhận mới xem được.</p></div>
    <label class="lbl">Hết hạn (tùy chọn)<input class="inp" type="date" data-f="expires"></label>
    <p class="tiny muted">${(exp.shared_user_ids || []).length} người · ${(exp.shared_group_ids || []).length} nhóm đang được chia sẻ (thu hồi trong tab Nhóm → Chia sẻ).</p>`;
  const sel = node.querySelector('[data-f="type"]');
  sel.addEventListener("change", () => node.querySelectorAll("[data-w]").forEach(w => { w.hidden = w.dataset.w !== sel.value; }));
  return openModal({
    title: `Chia sẻ: ${exp.title || "bài"}`, node,
    buttons: [{ label: "Hủy", value: null }, { label: approver ? "Chia sẻ" : "Gửi yêu cầu", kind: "primary", value: () => "ok" }],
    dismissible: true
  }).then(async res => {
    if (res !== "ok") return;
    const f = n => node.querySelector(`[data-f="${n}"]`)?.value.trim() || "";
    try {
      const expires = f("expires") ? new Date(f("expires") + "T23:59:59").getTime() : null;
      let status;
      if (sel.value === "user") {
        if (!f("email")) throw new Error("Hãy nhập email.");
        const uid = await lookupUid(f("email"));
        if (!uid) throw new Error("Không tìm thấy tài khoản với email này (người nhận cần đăng nhập LabMana ít nhất một lần).");
        status = await createShare(exp, "user", uid, { expiresMs: expires });
      } else {
        const gid = f("mygroup") || f("gid");
        if (!gid) throw new Error("Hãy chọn hoặc dán mã nhóm.");
        status = await createShare(exp, "group", gid, { expiresMs: expires });
      }
      toast(status === "active" ? "Đã chia sẻ (chỉ xem)" : "Đã gửi yêu cầu chờ duyệt", "success");
    } catch (err) { toast("Không chia sẻ được: " + (err.code === "permission-denied" ? "bị từ chối quyền" : err.message), "error", 5000); }
  });
}
