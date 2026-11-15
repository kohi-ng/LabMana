// ============ Workspace: Personal + Group, vai trò theo từng nhóm ============
// Nguồn sự thật về quyền nhóm: memberships/{groupId}__{uid} + groups/{groupId}.status (xem firestore.rules).
// Mọi truy vấn dữ liệu phải đi kèm scopeWhere() — Rules không phải bộ lọc.
import { db } from "./firebase.js";
import { session } from "./auth.js";
import {
  collection, doc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const ws = {
  loaded: false,
  memberships: [],      // [{ id, group_id, role, status, ... }] của chính mình (đã lọc active)
  groups: {},           // groupId → { id, name, code, status } (chỉ nhóm đọc được)
  current: { type: "personal", groupId: null }
};

const subs = new Set();
export function onWorkspace(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = () => subs.forEach(fn => { try { fn(ws); } catch (e) { console.error(e); } });

const uidNow = () => session.user?.uid;
const LS = () => `labmana.workspace.${uidNow()}`;

let unsubMem = null;
const unsubGroups = new Map();
const resolved = new Set();   // groupId đã có kết quả (đọc được hoặc bị chặn) — tránh đổi workspace sớm khi còn đang tải

const groupsSettled = () => ws.memberships.every(m => resolved.has(m.group_id));

/** Bắt đầu nghe membership của người dùng hiện tại. Resolve khi membership + document nhóm đã tải xong lần đầu. */
export function startWorkspaces() {
  stopWorkspaces();
  return new Promise(resolve => {
    let first = true;
    const settle = () => {
      reconcile(); emit();
      if (first && ws.loaded && groupsSettled()) { first = false; resolve(); }
    };
    unsubMem = onSnapshot(query(collection(db, "memberships"), where("uid", "==", uidNow())), snap => {
      ws.memberships = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.status === "active");
      const wanted = new Set(ws.memberships.map(m => m.group_id));
      for (const [gid, off] of unsubGroups) {
        if (!wanted.has(gid)) { off(); unsubGroups.delete(gid); delete ws.groups[gid]; resolved.delete(gid); }
      }
      for (const gid of wanted) {
        if (unsubGroups.has(gid)) continue;
        unsubGroups.set(gid, onSnapshot(doc(db, "groups", gid), s => {
          if (s.exists()) ws.groups[gid] = { id: gid, ...s.data() }; else delete ws.groups[gid];
          resolved.add(gid); settle();
        }, () => { delete ws.groups[gid]; resolved.add(gid); settle(); }));   // nhóm bị đình chỉ → Rules chặn đọc
      }
      ws.loaded = true; ws.error = null;
      settle();
    }, err => { console.error(err); ws.loaded = true; ws.error = err.code || err.message; first = false; resolve(); emit(); });
  });
}

export function stopWorkspaces() {
  unsubMem?.(); unsubMem = null;
  unsubGroups.forEach(off => off()); unsubGroups.clear();
  ws.memberships = []; ws.groups = {}; ws.loaded = false; resolved.clear();
}

/** Nhóm dùng được = có membership active VÀ document nhóm đọc được và status active. */
export function myGroups() {
  return ws.memberships
    .filter(m => ws.groups[m.group_id]?.status === "active")
    .map(m => ({ ...ws.groups[m.group_id], role: m.role }));
}

function reconcile() {
  // Đọc lựa chọn đã lưu; nếu không còn quyền vào nhóm đó → quay về Personal.
  let want = ws.current;
  if (!ws._restored) {
    ws._restored = true;
    try {
      const saved = localStorage.getItem(LS());
      if (saved?.startsWith("group:")) want = { type: "group", groupId: saved.slice(6) };
    } catch { /* ignore */ }
  }
  if (want.type === "group" && !myGroups().some(g => g.id === want.groupId)) {
    const stillLoading = !ws.loaded || (ws.memberships.some(m => m.group_id === want.groupId) && !resolved.has(want.groupId));
    if (!stillLoading) want = { type: "personal", groupId: null };
  }
  ws.current = want;
}

export function setWorkspace(key) {
  ws.current = key?.startsWith("group:") ? { type: "group", groupId: key.slice(6) } : { type: "personal", groupId: null };
  try { localStorage.setItem(LS(), workspaceKey()); } catch { /* ignore */ }
  reconcile();
  emit();
}

export const workspaceKey = () => ws.current.type === "group" ? `group:${ws.current.groupId}` : "personal";
/** Khóa document workspace_settings. */
export const settingsKey = () => ws.current.type === "group" ? `group_${ws.current.groupId}` : `personal_${uidNow()}`;

export function currentGroup() { return ws.current.type === "group" ? ws.groups[ws.current.groupId] || null : null; }
/** 'owner' (Personal) | 'group_admin' | 'member' */
export function currentRole() {
  if (ws.current.type === "personal") return "owner";
  return ws.memberships.find(m => m.group_id === ws.current.groupId)?.role || "member";
}
export const isAdminHere = () => currentRole() === "owner" || currentRole() === "group_admin";
export function workspaceLabel() {
  return ws.current.type === "personal" ? "Cá nhân" : (currentGroup()?.name || "Nhóm");
}
export const ROLE_LABEL = { owner: "Chủ sở hữu", group_admin: "Quản trị nhóm", member: "Thành viên", viewer: "Chỉ xem" };

/** Trường gắn vào mọi tài nguyên mới tạo (Rules kiểm tra lại, client không thể gán sai chủ/nhóm). */
export function scopeFields() {
  const uid = uidNow();
  return ws.current.type === "group"
    ? { scope: "group", group_id: ws.current.groupId, owner_uid: uid, created_by: uid }
    : { scope: "personal", group_id: null, owner_uid: uid, created_by: uid };
}

/** Ràng buộc truy vấn khớp đúng điều kiện list trong Rules. */
export function scopeWhere() {
  return ws.current.type === "group"
    ? [where("scope", "==", "group"), where("group_id", "==", ws.current.groupId)]
    : [where("scope", "==", "personal"), where("owner_uid", "==", uidNow())];
}

/** Giữ nguyên chủ sở hữu khi ghi đè document đã có (Rules cấm đổi owner/scope/group/created_by). */
export function keepOwnership(raw) {
  const keep = { scope: raw.scope, group_id: raw.group_id ?? null, owner_uid: raw.owner_uid, created_by: raw.created_by };
  // Ghi đè bằng setDoc sẽ xóa các trường không gửi lại → phải mang theo danh sách chia sẻ, nếu không sẽ vô tình thu hồi quyền xem.
  if (raw.shared_user_ids) keep.shared_user_ids = raw.shared_user_ids;
  if (raw.shared_group_ids) keep.shared_group_ids = raw.shared_group_ids;
  return keep;
}

/** Người dùng có sửa/xóa được tài nguyên (experiments) này không — khớp canManageRes() trong Rules. */
export function canManage(raw) {
  if (!raw || raw.shared_view) return false;
  const uid = uidNow();
  if (raw.scope === "personal") return raw.owner_uid === uid;
  if (raw.scope === "group") return currentRole() === "group_admin" || raw.created_by === uid;
  return false;
}
