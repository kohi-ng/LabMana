// ============ App shell: điều hướng tab + trạng thái kết nối + FAB Pha chế ============
import { startStore, on, state } from "./store.js";
import { $, $$ } from "./utils.js";
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
const expandedExperiments = new Set();
const expandedSections = new Set();

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
["status", "experiments", "runs", "run", "logs"].forEach(event => on(event, renderProgressMenu));
window.addEventListener("labmana:progress-change", renderProgressMenu);

let first = location.hash.slice(1);
if (!TABS[first]) { try { first = localStorage.getItem("labmana.tab"); } catch { first = null; } }
show(TABS[first] ? first : "sop");
updateConn();
startStore();

/* ---------------- Tiến trình — menu nhanh cho bài / thí nghiệm / bước ---------------- */
function openProgressMenu() {
  renderProgressMenu();
  progressMenu.hidden = false;
  progressBackdrop.classList.add("open");
  progressToggle.setAttribute("aria-expanded", "true");
}
function closeProgressMenu() {
  if (!progressToggle || !progressMenu || !progressBackdrop) return;
  progressMenu.hidden = true;
  progressBackdrop.classList.remove("open");
  progressToggle.setAttribute("aria-expanded", "false");
}
function renderProgressMenu() {
  if (!progressMenu) return;
  const activeExperimentId = state.activeRun?.exp_id || null;
  const experiments = state.experiments || [];
  progressMenu.innerHTML = `<div class="progress-menu-head">
      <div><strong>Tiến trình</strong><span class="muted small">${experiments.length} bài thí nghiệm</span></div>
      <button type="button" class="icon-btn" data-progress-close aria-label="Đóng">✕</button>
    </div>
    <div class="progress-menu-list">${experiments.length ? experiments.map(raw => {
      const exp = normalizeExperiment(raw);
      const steps = exp.sections.flatMap((section, si) => section.steps.map((step, ti) => ({
        section, step, si, ti, label: `${si + 1}.${ti + 1}`
      })));
      const done = activeExperimentId === raw.id ? steps.filter(x => sop.isStepProgressDone(x.step.id)).length : 0;
      const isExpanded = expandedExperiments.has(raw.id);
      const pct = steps.length ? Math.round(done / steps.length * 100) : 0;
      return `<section class="progress-experiment">
        <div class="progress-experiment-row">
          <button type="button" class="progress-exp-open" data-progress-open="${esc(raw.id)}">
            <strong>${esc(exp.title || "(không tên)")}</strong>
            <span class="muted small">${done}/${steps.length} bước${activeExperimentId === raw.id ? ` · ${pct}%` : ""}</span>
          </button>
          <button type="button" class="progress-expand" data-progress-expand="${esc(raw.id)}" aria-label="${isExpanded ? "Thu gọn" : "Mở"} ${esc(exp.title)}">${isExpanded ? "▾" : "›"}</button>
        </div>
        ${isExpanded ? exp.sections.map((section, si) => {
          const sectionKey = `${raw.id}:${section.id}`;
          const sectionExpanded = expandedSections.has(sectionKey);
          const sectionDone = activeExperimentId === raw.id ? section.steps.filter(step => sop.isStepProgressDone(step.id)).length : 0;
          return `<div class="progress-section">
            <button type="button" class="progress-section-toggle" data-progress-section="${esc(section.id)}" data-progress-exp-id="${esc(raw.id)}" data-progress-key="${esc(sectionKey)}">
              <span>${si + 1}. ${esc(section.section_name || "Thí nghiệm chưa đặt tên")}</span>
              <span class="muted small">${sectionDone}/${section.steps.length} ${sectionExpanded ? "▾" : "›"}</span>
            </button>
            ${sectionExpanded ? `<div class="progress-steps">${section.steps.map((step, ti) => {
              const complete = activeExperimentId === raw.id && sop.isStepProgressDone(step.id);
              return `<button type="button" class="progress-step ${complete ? "done" : ""}" data-progress-step="${esc(step.id)}" data-progress-section="${esc(section.id)}" data-progress-exp-id="${esc(raw.id)}">
                <span>${si + 1}.${ti + 1} ${esc(step.title || step.text.replace(/\s+/g, " ").slice(0, 52) || "Bước chưa đặt nội dung")}</span>
                <span class="progress-check">${complete ? "✓" : ""}</span>
              </button>`;
            }).join("")}</div>` : ""}
          </div>`;
        }).join("") : ""}
      </section>`;
    }).join("") : '<div class="empty">Chưa có kế hoạch thí nghiệm.</div>'}</div>`;
}

progressToggle.addEventListener("click", () => {
  progressMenu.hidden ? openProgressMenu() : closeProgressMenu();
});
progressBackdrop.addEventListener("click", closeProgressMenu);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeProgressMenu(); });
progressMenu.addEventListener("click", async event => {
  const button = event.target.closest("[data-progress-close],[data-progress-open],[data-progress-expand],[data-progress-section],[data-progress-step]");
  if (!button) return;
  if (button.hasAttribute("data-progress-close")) return closeProgressMenu();
  if (button.dataset.progressExpand) {
    expandedExperiments.has(button.dataset.progressExpand)
      ? expandedExperiments.delete(button.dataset.progressExpand)
      : expandedExperiments.add(button.dataset.progressExpand);
    return renderProgressMenu();
  }
  if (button.dataset.progressSection && !button.dataset.progressStep) {
    const key = button.dataset.progressKey;
    expandedSections.has(key) ? expandedSections.delete(key) : expandedSections.add(key);
    await sop.openProgressTarget(button.dataset.progressExpId, button.dataset.progressSection);
    return renderProgressMenu();
  }
  const expId = button.dataset.progressExpId || button.dataset.progressOpen;
  if (!expId) return;
  if (button.dataset.progressOpen) expandedExperiments.add(expId);
  closeProgressMenu();
  await sop.openProgressTarget(expId, button.dataset.progressSection || null, button.dataset.progressStep || null);
});

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