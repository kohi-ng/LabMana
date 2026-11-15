// ============ Store: dữ liệu real-time THEO WORKSPACE, dùng chung giữa các tab ============
// Mọi listener đều kèm scopeWhere() (khớp Rules). Đổi workspace → hủy toàn bộ listener cũ,
// xóa state cũ rồi nghe lại, nên dữ liệu nhóm này không rò sang nhóm khác.
import { db, isConfigured } from "./firebase.js";
import { session } from "./auth.js";
import {
  doc, collection, onSnapshot, query, where, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ws, startWorkspaces, stopWorkspaces, onWorkspace, scopeWhere, settingsKey, workspaceKey,
  currentRole, currentGroup, workspaceLabel, myGroups
} from "./workspace.js";
import { toast } from "./utils.js";

const LS_RUN = key => `labmana.activeRun.${key}`;
const lsGet = k => { try { return localStorage.getItem(k) || null; } catch { return null; } };

export const state = {
  ready: false, error: null,
  workspace: { key: "personal", type: "personal", groupId: null, role: "owner", name: "Cá nhân" },
  team: [], teamIds: {},          // danh sách thành viên thực hành của workspace (workspace_settings)
  experiments: [], experimentsLoaded: false,
  runs: [], runsLoaded: false,
  sharedExperiments: [],          // tài nguyên người khác chia sẻ cho mình (chỉ xem)
  activeRunId: null, activeRun: null, activeRunLoaded: false,
  logs: {}                        // step_id → log (của lượt đang chọn)
};

const subs = {};
export function on(evt, fn) {
  (subs[evt] ||= new Set()).add(fn);
  return () => subs[evt].delete(fn);
}
function emit(evt) {
  subs[evt]?.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}

let toastedErr = false;
function fail(err) {
  console.error(err);
  state.error = err.code || err.message || String(err);
  emit("status");
  if (!toastedErr) { toastedErr = true; toast("Lỗi dữ liệu: " + state.error, "error", 5000); }
}

let wsUnsubs = [], unsubLogs = null, watchingLogs, applied = null, seedRun = null;

function clearWorkspaceListeners() {
  wsUnsubs.forEach(off => off()); wsUnsubs = [];
  unsubLogs?.(); unsubLogs = null; watchingLogs = undefined;
}

function syncActiveRun() {
  const found = state.runs.find(r => r.id === state.activeRunId) || (seedRun?.id === state.activeRunId ? seedRun : null);
  state.activeRun = found || null;
  state.activeRunLoaded = state.runsLoaded;
  emit("run");
  watchLogs();
}

function watchLogs() {
  const id = state.activeRun ? state.activeRunId : null;
  if (watchingLogs === id) return;
  unsubLogs?.(); unsubLogs = null;
  watchingLogs = id;
  state.logs = {}; emit("logs");
  if (!id) return;
  unsubLogs = onSnapshot(query(collection(db, "execution_logs"), where("run_id", "==", id), ...scopeWhere()), snap => {
    const m = {};
    snap.forEach(d => { const x = d.data(); m[x.step_id] = { id: d.id, ...x }; });
    state.logs = m;
    emit("logs");
  }, fail);
}

/** Chọn lượt thực hành đang làm trên THIẾT BỊ này (lưu localStorage theo workspace). `seed` = bản ghi vừa tạo, chưa về snapshot. */
export function setActiveRun(id, seed = null) {
  state.activeRunId = id || null;
  seedRun = seed;
  try { id ? localStorage.setItem(LS_RUN(state.workspace.key), id) : localStorage.removeItem(LS_RUN(state.workspace.key)); } catch { /* ignore */ }
  syncActiveRun();
}

function updateWorkspaceMeta() {
  state.workspace = {
    key: workspaceKey(), type: ws.current.type, groupId: ws.current.groupId,
    role: currentRole(), name: workspaceLabel(), groupCode: currentGroup()?.code || ""
  };
}

function applyWorkspace() {
  updateWorkspaceMeta();
  const key = state.workspace.key;
  if (applied === key) { emit("workspace"); return; }
  applied = key;
  clearWorkspaceListeners();
  Object.assign(state, {
    team: [], teamIds: {}, experiments: [], experimentsLoaded: false, runs: [], runsLoaded: false,
    activeRunId: lsGet(LS_RUN(key)), activeRun: null, activeRunLoaded: false, logs: {}
  });
  seedRun = null;
  ["workspace", "config", "experiments", "runs", "run", "logs"].forEach(emit);

  // Document chưa tồn tại → get() hợp lệ với Rules (kiểm tra theo id), nên không bị permission-denied.
  wsUnsubs.push(onSnapshot(doc(db, "workspace_settings", settingsKey()), snap => {
    const d = snap.data() || {};
    state.team = (d.team_members || []).map(String);
    state.teamIds = Object.fromEntries(Object.entries(d.team_ids || {}).map(([name, id]) => [String(name), String(id ?? "")]));
    emit("config");
  }, fail));

  wsUnsubs.push(onSnapshot(query(collection(db, "experiments"), ...scopeWhere()), snap => {
    state.experiments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updated_at_ms || 0) - (a.updated_at_ms || 0));
    state.experimentsLoaded = true;
    emit("experiments");
  }, fail));

  // Không orderBy/limit ở server (tránh composite index); mỗi bài chỉ có ~1 lượt nên danh sách nhỏ.
  wsUnsubs.push(onSnapshot(query(collection(db, "runs"), ...scopeWhere()), snap => {
    state.runs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
    state.runsLoaded = true;
    emit("runs");
    syncActiveRun();
  }, fail));
}

/* ---------------- Tài nguyên được chia sẻ cho mình (Viewer) ---------------- */
let shareUnsubs = [];
const shareDocs = new Map();   // key nguồn → [share docs]
async function refreshShared() {
  const now = Date.now();
  const unique = new Map();
  for (const list of shareDocs.values()) for (const s of list) {
    const exp = s.expires_at?.toMillis ? s.expires_at.toMillis() : null;
    if (s.status === "active" && s.resource_collection === "experiments" && (!exp || exp > now)) unique.set(s.resource_id, s);
  }
  const out = [];
  await Promise.all([...unique.values()].map(async s => {
    try {
      const snap = await getDoc(doc(db, "experiments", s.resource_id));
      if (snap.exists()) out.push({ id: snap.id, ...snap.data(), shared_view: true, share_id: s.id });
    } catch (err) { /* grant vừa bị thu hồi/hết hạn: Rules từ chối → bỏ qua */ }
  }));
  state.sharedExperiments = out.sort((a, b) => (b.updated_at_ms || 0) - (a.updated_at_ms || 0));
  emit("shared");
}
function watchShares() {
  shareUnsubs.forEach(off => off()); shareUnsubs = []; shareDocs.clear();
  const watch = (key, ...clauses) => shareUnsubs.push(onSnapshot(query(collection(db, "resource_shares"), ...clauses), snap => {
    shareDocs.set(key, snap.docs.map(d => ({ id: d.id, ...d.data() })));
    refreshShared();
  }, err => console.warn("Không đọc được chia sẻ:", key, err.code)));
  watch("user", where("recipient_type", "==", "user"), where("recipient_id", "==", session.user.uid));
  myGroups().forEach(g => watch("g:" + g.id, where("recipient_type", "==", "group"), where("recipient_id", "==", g.id)));
}

let started = false, lastGroupIds = "";
export async function startStore() {
  if (started) return;
  if (!isConfigured) { state.error = "NOT_CONFIGURED"; emit("status"); return; }
  started = true;
  state.error = null;
  await startWorkspaces();
  state.ready = true; emit("status");
  lastGroupIds = myGroups().map(g => g.id).sort().join(",");
  applyWorkspace();
  watchShares();
  onWorkspace(() => {
    applyWorkspace();
    const ids = myGroups().map(g => g.id).sort().join(",");
    if (ids !== lastGroupIds) { lastGroupIds = ids; watchShares(); }
  });
}

export function stopStore() {
  clearWorkspaceListeners();
  shareUnsubs.forEach(off => off()); shareUnsubs = [];
  stopWorkspaces();
  started = false; applied = null;
}
