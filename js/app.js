// ============ App shell: điều hướng tab + trạng thái kết nối + nút Pha chế ============
import { startStore, on, state } from "./store.js";
import { $, $$, esc, renderMath } from "./utils.js";
import * as planner from "./tabs/planner.js";
import * as sop from "./tabs/sop.js";
import * as settings from "./tabs/settings.js";
import * as calc from "./tabs/calc.js";
import { normalizeExperiment } from "./plan-logic.js";

const TABS = { planner, sop, settings };
const inited = {};
const progressToggle = $("#progress-menu-toggle");
const progressMenu = $("#progress-menu");
const progressBackdrop = $("#progress-backdrop");

function show(name) {
  if (!TABS[name]) name = "sop";
  document.body.classList.toggle("sop-mode", name === "sop");
  closeProgressMenu();
  $$(".tab").forEach(s => { s.hidden = s.id !== "tab-" + name; });
  $$(".bottom-nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  if (!inited[name]) { TABS[name].init($("#tab-" + name)); inited[name] = true; }
  TABS[name].onShow?.();
  try { localStorage.setItem("labmana.tab", name); } catch { /* ignore */ }
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  window.scrollTo(0, 0);
}

function updateConn() {
  const b = $("#banner");
  b.classList.add("hidden");
  if (state.error === "NOT_CONFIGURED") {
    b.innerHTML = "Chưa có <b>firebaseConfig</b>. Mở <code>js/firebase.js</code> và dán cấu hình Firebase (xem README.md).";
    b.classList.remove("hidden");
  } else if (state.error) {
    b.textContent = "Không kết nối được dữ liệu. Kiểm tra mạng rồi tải lại trang.";
    b.classList.remove("hidden");
  }
}

$$(".bottom-nav button").forEach(b => b.addEventListener("click", () => show(b.dataset.tab)));
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
window.addEventListener("online", updateConn);
window.addEventListener("offline", updateConn);
on("status", updateConn);
let progressRenderQueued = false;
function scheduleProgressMenuRender() {
  if (!progressMenu || progressMenu.hidden || progressRenderQueued) return;
  progressRenderQueued = true;
  requestAnimationFrame(() => {
    progressRenderQueued = false;
    renderProgressMenu();
  });
}
["status", "experiments", "runs", "run", "logs"].forEach(event => on(event, scheduleProgressMenuRender));
window.addEventListener("labmana:progress-change", scheduleProgressMenuRender);

let first = location.hash.slice(1);
if (!TABS[first]) { try { first = localStorage.getItem("labmana.tab"); } catch { first = null; } }
show(TABS[first] ? first : "sop");
updateConn();
startStore();

/* ---------------- Tiến trình — chỉ hiện bài đang xem ---------------- */
function openProgressMenu() {
  if (!sop.isExperimentOpen()) return;
  progressMenu.hidden = false;
  progressBackdrop.classList.add("open");
  progressToggle.setAttribute("aria-expanded", "true");
  renderProgressMenu();
}
function closeProgressMenu() {
  if (!progressToggle || !progressMenu || !progressBackdrop) return;
  progressMenu.hidden = true;
  progressBackdrop.classList.remove("open");
  progressToggle.setAttribute("aria-expanded", "false");
}
function renderProgressMenu() {
  if (!progressMenu || progressMenu.hidden) return;
  const raw = state.experiments.find(item => item.id === state.activeRun?.exp_id);
  if (!raw || !sop.isExperimentOpen()) return closeProgressMenu();
  const scrollTop = progressMenu.scrollTop;
  const exp = normalizeExperiment(raw);
  const { sectionId, stepId } = sop.getSelection();
  const total = exp.sections.reduce((sum, section) => sum + section.steps.length, 0);
  const done = exp.sections.reduce((sum, section) => sum + section.steps.filter(step => sop.isStepProgressDone(step.id)).length, 0);
  const pct = total ? Math.round(done / total * 100) : 0;
  progressMenu.innerHTML = `<div class="pm-head">
      <div><strong>${esc(exp.title || "Bài thí nghiệm")}</strong><span class="muted small">${done}/${total} bước · ${pct}%</span></div>
      <div class="pm-actions">
        <button type="button" class="link-btn" data-progress-csv>Xuất CSV</button>
        <button type="button" class="link-btn muted" data-progress-close>Đóng</button>
      </div>
    </div>
    <div class="bar"><span style="width:${pct}%"></span></div>
    ${exp.sections.map((section, si) => {
      const sectionDone = section.steps.filter(step => sop.isStepProgressDone(step.id)).length;
      return `<div class="pm-section">
        <button type="button" class="pm-section-title ${section.id === sectionId ? "active" : ""}" data-progress-section="${esc(section.id)}">
          <span>TN ${si + 1} · ${esc(section.section_name || "Chưa đặt tên")}</span><span>${sectionDone}/${section.steps.length}</span>
        </button>
        <div class="pm-steps">${section.steps.map((step, ti) => {
          const cls = [sop.isStepProgressDone(step.id) ? "done" : "", step.id === stepId ? "active" : ""].join(" ");
          return `<button type="button" class="pm-step ${cls}" data-progress-step="${esc(step.id)}" data-progress-section="${esc(section.id)}">${si + 1}.${ti + 1}</button>`;
        }).join("")}</div>
      </div>`;
    }).join("")}`;
  renderMath(progressMenu);
  progressMenu.scrollTop = scrollTop;
}

progressToggle.addEventListener("click", () => {
  progressMenu.hidden ? openProgressMenu() : closeProgressMenu();
});
progressBackdrop.addEventListener("click", closeProgressMenu);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeProgressMenu(); });
progressMenu.addEventListener("click", event => {
  const button = event.target.closest("[data-progress-close],[data-progress-csv],[data-progress-section],[data-progress-step]");
  if (!button) return;
  if (button.hasAttribute("data-progress-close")) return closeProgressMenu();
  if (button.hasAttribute("data-progress-csv")) return sop.exportCurrentCsv();
  closeProgressMenu();
  sop.goToProgress(button.dataset.progressSection || null, button.dataset.progressStep || null);
});

/* ---------------- Nút Pha chế — nổi ở mọi tab, mở bảng tra cứu nhanh ---------------- */
const fab = $("#calc-fab"), backdrop = $("#calc-sheet-backdrop"), sheet = $("#calc-sheet"), body = $("#calc-sheet-body");
let calcInited = false, calcOpen = false;

function openCalc() {
  if (!calcInited) { calc.init(body); calcInited = true; } else { calc.onShow?.(); }
  calcOpen = true;
  backdrop.classList.add("open"); sheet.classList.add("open");
}
function closeCalc() {
  calcOpen = false;
  backdrop.classList.remove("open"); sheet.classList.remove("open");
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
