// ============ App shell: điều hướng tab + trạng thái kết nối + menu Tiến trình (logo) ============
import { startStore, on, state } from "./store.js";
import { $, $$, esc, richHtml, snippet, renderMath } from "./utils.js";
import * as planner from "./tabs/planner.js";
import * as sop from "./tabs/sop.js";
import * as settings from "./tabs/settings.js";
import * as calc from "./tabs/calc.js";
import * as ai from "./tabs/ai.js";
import { normalizeExperiment, secTagSp } from "./plan-logic.js";
import { restoreWake } from "./wake-lock.js";

const TABS = { planner, sop, calc, ai, settings };
const inited = {};
const progressToggle = $("#progress-menu-toggle");
const progressMenu = $("#progress-menu");
const progressBackdrop = $("#progress-backdrop");

function show(name) {
  if (!TABS[name]) name = "sop";
  document.body.classList.toggle("ai-mode", name === "ai");
  closeProgressMenu();
  $$(".tab").forEach(s => { s.hidden = s.id !== "tab-" + name; });
  $$("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
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
  }
}

$$("[data-tab]").forEach(b => b.addEventListener("click", () => show(b.dataset.tab)));
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
restoreWake();
// Intro (chỉ ở phiên mới): báo app đã sẵn sàng; intro xong thì vào tab Quy trình
window.__introAppReady?.();
window.__intro?.then(() => show("sop"));

/* ---------------- Tiến trình — logo LABMANA, xổ dọc xuống ---------------- */
function openProgressMenu() {
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
const plainTitle = step => step.title ? richHtml(step.title) : esc(snippet(step.text, 60));
function renderProgressMenu() {
  if (!progressMenu || progressMenu.hidden) return;
  const raw = state.experiments.find(item => item.id === state.activeRun?.exp_id);
  if (!raw || !sop.isExperimentOpen()) {
    progressMenu.innerHTML = `<div class="pm-empty">Chưa mở bài nào. Vào tab <b>Quy trình</b> và chọn một bài để xem tiến trình.</div>`;
    return;
  }
  const scrollTop = progressMenu.scrollTop;
  const exp = normalizeExperiment(raw);
  const { sectionId, stepId } = sop.getSelection();
  const total = exp.sections.reduce((sum, section) => sum + section.steps.length, 0);
  const done = exp.sections.reduce((sum, section) => sum + section.steps.filter(step => sop.isStepProgressDone(step.id)).length, 0);
  const pct = total ? Math.round(done / total * 100) : 0;
  progressMenu.innerHTML = `<div class="pm-head">
      <div><strong>${esc(exp.title || "Bài thí nghiệm")}</strong><span class="muted small">${done}/${total} bước · ${pct}%</span></div>
      <div class="pm-actions"><button type="button" class="link-btn" data-progress-csv>Xuất CSV</button></div>
    </div>
    <div class="bar"><span style="width:${pct}%"></span></div>
    ${exp.sections.map((section, si) => {
      const sectionDone = section.steps.filter(step => sop.isStepProgressDone(step.id)).length;
      return `<div class="pm-section">
        <button type="button" class="pm-section-title ${section.id === sectionId ? "active" : ""}" data-progress-section="${esc(section.id)}">
          <span>${secTagSp(si)} · ${richHtml(section.section_name) || "Chưa đặt tên"}</span><span>${sectionDone}/${section.steps.length}</span>
        </button>
        <div class="pm-steps">${section.steps.map((step, ti) => {
          const cls = [sop.isStepProgressDone(step.id) ? "done" : "", step.id === stepId ? "active" : ""].join(" ");
          return `<button type="button" class="pm-step ${cls}" data-progress-step="${esc(step.id)}" data-progress-section="${esc(section.id)}"><b>${si}.${ti + 1}</b><span>${plainTitle(step)}</span></button>`;
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
  const button = event.target.closest("[data-progress-csv],[data-progress-section],[data-progress-step]");
  if (!button) return;
  if (button.hasAttribute("data-progress-csv")) return sop.exportCurrentCsv();
  closeProgressMenu();
  if (location.hash !== "#sop") show("sop");
  sop.goToProgress(button.dataset.progressSection || null, button.dataset.progressStep || null);
});

/* Offline-first: Service Worker lưu sẵn vỏ ứng dụng, KaTeX, Three.js và GSAP (mô phỏng 3D chạy được khi mất mạng) */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { /* không bắt buộc */ }));
}
