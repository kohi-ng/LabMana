// ============ Store: dữ liệu real-time dùng chung giữa các tab ============
import { db, ready, isConfigured } from "./firebase.js";
import {
  doc, collection, onSnapshot, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { toast } from "./utils.js";
import { setCustomChems } from "./chem-logic.js";

const LS_RUN = "labmana.activeRun", LS_CHEMS = "labmana.customChems";
const readChemCache = () => { try { const v = JSON.parse(localStorage.getItem(LS_CHEMS) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

export const state = {
  ready: false, error: null,
  team: [],
  teamIds: {},          // tên thành viên → MSSV (config/lab.team_ids)
  customChems: readChemCache(),   // hóa chất pha chế người dùng thêm (config/lab.custom_chems), cache offline
  experiments: [], experimentsLoaded: false,
  runs: [], runsLoaded: false,
  activeRunId: (() => { try { return localStorage.getItem(LS_RUN) || null; } catch { return null; } })(),
  activeRun: null, activeRunLoaded: false,
  logs: {}            // step_id → log (của lượt đang chọn)
};

const subs = {};
export function on(evt, fn) {
  (subs[evt] ||= new Set()).add(fn);
  return () => subs[evt].delete(fn);
}
function emit(evt) {
  subs[evt]?.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}

setCustomChems(state.customChems);   // có ngay danh sách từ cache trước khi Firebase trả về

let toastedErr = false;
function fail(err) {
  console.error(err);
  state.error = err.code || err.message || String(err);
  emit("status");
  if (!toastedErr) { toastedErr = true; toast("Lỗi dữ liệu: " + state.error, "error", 5000); }
}

let unsubLogs = null, unsubRun = null, watching = undefined;
function watchRun() {
  if (!state.ready || watching === state.activeRunId) return;
  unsubLogs?.(); unsubRun?.(); unsubLogs = unsubRun = null;
  watching = state.activeRunId;
  state.logs = {}; state.activeRun = null; state.activeRunLoaded = false;
  emit("logs"); emit("run");
  if (!watching) return;
  unsubRun = onSnapshot(doc(db, "runs", watching), s => {
    state.activeRun = s.exists() ? { id: s.id, ...s.data() } : null;
    state.activeRunLoaded = true;
    emit("run");
  }, fail);
  unsubLogs = onSnapshot(query(collection(db, "execution_logs"), where("run_id", "==", watching)), snap => {
    const m = {};
    snap.forEach(d => { const x = d.data(); m[x.step_id] = { id: d.id, ...x }; });
    state.logs = m;
    emit("logs");
  }, fail);
}

/** Chọn lượt thực hành đang làm trên THIẾT BỊ này (lưu localStorage). */
export function setActiveRun(id) {
  state.activeRunId = id || null;
  try { id ? localStorage.setItem(LS_RUN, id) : localStorage.removeItem(LS_RUN); } catch { /* ignore */ }
  watchRun();
}

export async function startStore() {
  if (!isConfigured) { state.error = "NOT_CONFIGURED"; emit("status"); return; }
  try { await ready; } catch (e) { state.error = e.code || e.message; emit("status"); return; }
  state.ready = true; state.error = null; emit("status");

  onSnapshot(doc(db, "config", "lab"), snap => {
    state.team = (snap.data()?.team_members || []).map(String);
    state.teamIds = Object.fromEntries(Object.entries(snap.data()?.team_ids || {}).map(([name, id]) => [String(name), String(id ?? "")]));
    if (Array.isArray(snap.data()?.custom_chems)) {
      state.customChems = snap.data().custom_chems;
      try { localStorage.setItem(LS_CHEMS, JSON.stringify(state.customChems)); } catch { /* ignore */ }
      setCustomChems(state.customChems);
    } else if (snap.exists() && state.customChems.length) { state.customChems = []; try { localStorage.removeItem(LS_CHEMS); } catch { /* ignore */ } setCustomChems([]); }
    emit("config");
  }, fail);

  onSnapshot(collection(db, "experiments"), snap => {
    state.experiments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updated_at_ms || 0) - (a.updated_at_ms || 0));
    state.experimentsLoaded = true;
    emit("experiments");
  }, fail);

  onSnapshot(query(collection(db, "runs"), orderBy("created_at_ms", "desc"), limit(30)), snap => {
    state.runs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.runsLoaded = true;
    emit("runs");
  }, fail);

  watchRun();
}