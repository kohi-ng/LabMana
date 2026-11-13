// ============ App shell: điều hướng tab + trạng thái kết nối + FAB Pha chế ============
import { startStore, on, state } from "./store.js";
import { $, $$ } from "./utils.js";
import * as planner from "./tabs/planner.js";
import * as sop from "./tabs/sop.js";
import * as settings from "./tabs/settings.js";
import * as calc from "./tabs/calc.js";

const TABS = { planner, sop, settings };
const inited = {};

function show(name) {
  if (!TABS[name]) name = "sop";
  $$(".tab").forEach(s => { s.hidden = s.id !== "tab-" + name; });
  $$(".bottom-nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  if (!inited[name]) { TABS[name].init($("#tab-" + name)); inited[name] = true; }
  TABS[name].onShow?.();
  try { localStorage.setItem("labmana.tab", name); } catch { /* ignore */ }
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  window.scrollTo(0, 0);
}

function updateConn() {
  const el = $("#conn"), b = $("#banner");
  let txt = "Đang kết nối", cls = "";
  b.classList.add("hidden");
  if (state.error === "NOT_CONFIGURED") {
    txt = "Chưa cấu hình"; cls = "off";
    b.innerHTML = "⚙️ Chưa có <b>firebaseConfig</b>. Mở <code>js/firebase.js</code> và dán cấu hình dự án Firebase (xem README.md). Trạm pha chế vẫn dùng được.";
    b.classList.remove("hidden");
  } else if (state.error) { txt = "Lỗi kết nối"; cls = "err"; }
  else if (!navigator.onLine) { txt = "Ngoại tuyến"; cls = "off"; }
  else if (state.ready) { txt = "Trực tuyến"; cls = "on"; }
  el.innerHTML = `<span class="pip"></span>${txt}`;
  el.className = "conn " + cls;
}

$$(".bottom-nav button").forEach(b => b.addEventListener("click", () => show(b.dataset.tab)));
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
window.addEventListener("online", updateConn);
window.addEventListener("offline", updateConn);
on("status", updateConn);

let first = location.hash.slice(1);
if (!TABS[first]) { try { first = localStorage.getItem("labmana.tab"); } catch { first = null; } }
show(TABS[first] ? first : "sop");
updateConn();
startStore();

/* ---------------- FAB Trạm pha chế — nổi mọi tab, mở sheet tra cứu nhanh ---------------- */
const fab = $("#calc-fab"), backdrop = $("#calc-sheet-backdrop"), sheet = $("#calc-sheet"), body = $("#calc-sheet-body");
let calcInited = false, calcOpen = false;

function openCalc() {
  if (!calcInited) { calc.init(body); calcInited = true; } else { calc.onShow?.(); }
  calcOpen = true;
  fab.classList.add("open"); backdrop.classList.add("open"); sheet.classList.add("open");
  fab.setAttribute("aria-label", "Đóng trạm pha chế");
}
function closeCalc() {
  calcOpen = false;
  fab.classList.remove("open"); backdrop.classList.remove("open"); sheet.classList.remove("open");
  fab.setAttribute("aria-label", "Mở trạm pha chế");
}
fab.addEventListener("click", () => {
  if (!ignoreClick) (calcOpen ? closeCalc() : openCalc());
});
backdrop.addEventListener("click", closeCalc);
$("#calc-sheet-close").addEventListener("click", closeCalc);
document.addEventListener("keydown", e => { if (e.key === "Escape" && calcOpen) closeCalc(); });

let drag = null, dragged = false, ignoreClick = false;
const FAB_POSITION = "labmana.calcFabPosition";
function placeFab(left, top) {
  const maxLeft = Math.max(0, window.innerWidth - fab.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - fab.offsetHeight);
  const x = Math.min(maxLeft, Math.max(0, left));
  const y = Math.min(maxTop, Math.max(0, top));
  fab.style.left = `${x}px`;
  fab.style.top = `${y}px`;
  fab.style.bottom = "auto";
  return { x, y };
}
try {
  const position = JSON.parse(localStorage.getItem(FAB_POSITION) || "null");
  if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) placeFab(position.x, position.y);
} catch { /* ignore invalid saved position */ }

fab.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const rect = fab.getBoundingClientRect();
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
  dragged = false;
  fab.setPointerCapture(e.pointerId);
});
fab.addEventListener("pointermove", e => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragged && Math.hypot(dx, dy) < 5) return;
  dragged = true;
  fab.classList.add("dragging");
  placeFab(drag.left + dx, drag.top + dy);
  e.preventDefault();
});
function finishFabDrag(e) {
  if (!drag || drag.id !== e.pointerId) return;
  if (dragged) {
    const position = { x: fab.offsetLeft, y: fab.offsetTop };
    try { localStorage.setItem(FAB_POSITION, JSON.stringify(position)); } catch { /* ignore */ }
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 100);
  }
  drag = null;
  fab.classList.remove("dragging");
}
fab.addEventListener("pointerup", finishFabDrag);
fab.addEventListener("pointercancel", finishFabDrag);
window.addEventListener("resize", () => {
  if (fab.style.top) {
    const position = placeFab(fab.offsetLeft, fab.offsetTop);
    try { localStorage.setItem(FAB_POSITION, JSON.stringify({ x: position.x, y: position.y })); } catch { /* ignore */ }
  }
});