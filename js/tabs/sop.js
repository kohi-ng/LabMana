// ============ Tab Quy trình (SOP & Data Logger) ============
// Các bước chưa làm đều có thể mở và thực hiện độc lập; dải mục lục hỗ trợ nhảy nhanh.
import { state, on, setActiveRun } from "../store.js";
import { db } from "../firebase.js";
import { doc, collection, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { driveUpload, isDriveConfigured } from "../drive.js";
import { esc, snippet, richHtml, renderMath, toast, openModal, compressImage, pickName, statusCard, fmtTime, downloadFile } from "../utils.js";
import { computeFlow, resolveBranch, normalizeExperiment, parseNum, END } from "../plan-logic.js";

let root, raf = 0, selectedByUser = false, selectedSectionId = null;
let curExp = null, curFlow = null, curFlat = [];
const drafts = {};              // stepId → {value, blob, preview}
const editing = new Set(), saving = new Set(), uploadingPhoto = new Set();
const expanded = new Set();
const openingExperiments = new Set();

export function init(el) {
  root = el;
  ["status", "experiments", "runs", "run", "logs"].forEach(ev => on(ev, schedule));
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  render();
}
export function onShow() { schedule(); }
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

/* ---------- vẽ ---------- */
function render() {
  if (!state.ready) { root.innerHTML = statusCard(state); return; }
  const focus = captureFocus();

  if (!state.activeRunId || !selectedByUser) { root.innerHTML = startHtml(); return; }
  if (!state.activeRunLoaded || !state.experimentsLoaded) { root.innerHTML = `<div class="empty">⏳ Đang tải thí nghiệm…</div>`; return; }
  const run = state.activeRun;
  if (!run) { root.innerHTML = `<div class="empty">Không tìm thấy thí nghiệm đang mở. Hãy chọn lại bên dưới.</div>` + startHtml(); return; }
  const raw = state.experiments.find(e => e.id === run.exp_id);
  if (!raw) { root.innerHTML = `<div class="empty">Kế hoạch này đã bị xóa. Hãy chọn một thí nghiệm khác.</div>` + startHtml(); return; }

  curExp = normalizeExperiment(raw);
  curFlow = computeFlow(curExp, state.logs);
  curFlat = curFlow.flat;
  const progressDone = curFlat.filter(f => isProgressDone(f.step.id)).length;
  const pct = curFlow.active ? Math.round(100 * progressDone / curFlow.active) : 0;

  const selectedSection = curExp.sections.find(sec => sec.id === selectedSectionId);
  let html = `<div class="run-head">
      <div class="run-title">${esc(curExp.title)}</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="muted small">${progressDone}/${curFlow.active} bước · ${pct}%</div>
      <div class="btn-row">
        <button class="btn sm" data-act="experiment-list">← Danh sách thí nghiệm</button>
        <button class="btn sm" data-act="csv">⬇ CSV</button>
      </div></div>`;
  if (!selectedSection) {
    html += sectionListHtml();
  } else {
    const sectionIndex = curExp.sections.indexOf(selectedSection);
    const sectionFlat = curFlat.filter(f => f.sec.id === selectedSection.id);
    const sectionDone = sectionFlat.filter(f => isProgressDone(f.step.id)).length;
    html += `<div class="section-run-head">
      <button class="btn sm" data-act="section-list">← Các thí nghiệm</button>
      <h2>TN ${sectionIndex + 1} · ${richHtml(selectedSection.section_name)}</h2>
      <p class="muted small">${sectionDone}/${sectionFlat.length} bước đã thực hiện</p>
      ${tocStrip(sectionFlat)}
    </div>`;
    if (sectionFlat.every(f => state.logs[f.step.id])) html += `<div class="done-banner">🎉 Đã hoàn thành thí nghiệm này!</div>`;
    html += sectionFlat.map(f => stepAccordion(f, flowStatus(f.step.id))).join("");
  }
  root.innerHTML = html;
  renderMath(root);
  restoreFocus(focus);
}

function sectionListHtml() {
  return `<div class="page-head"><h2>Các thí nghiệm</h2><p class="muted small">Chọn một thí nghiệm để xem lần lượt các bước. Bạn vẫn có thể mở bất kỳ bước nào.</p></div>
    ${curExp.sections.map((sec, index) => {
      const steps = curFlat.filter(f => f.sec.id === sec.id);
      const done = steps.filter(f => isProgressDone(f.step.id)).length;
      return `<button type="button" class="card plan-card section-card" data-act="open-section" data-section="${esc(sec.id)}">
        <span class="item-title">TN ${index + 1} · ${richHtml(sec.section_name || "Thí nghiệm chưa đặt tên")}</span>
        <span class="muted small">${done}/${steps.length} bước đã thực hiện</span>
        <span class="section-progress"><span style="width:${steps.length ? done / steps.length * 100 : 0}%"></span></span>
      </button>`;
    }).join("")}`;
}

function tocStrip(steps) {
  return `<div class="toc-strip">${steps.map(f => {
    const st = flowStatus(f.step.id);
    return `<button type="button" class="toc-pip ${st}" data-act="jump" data-step="${f.step.id}" title="Bước ${f.label}">${st === "done" ? "✓" : f.label.split(".").pop()}</button>`;
  }).join("")}</div>`;
}

function hasDraftProgress(id) {
  const draft = drafts[id];
  if (!draft) return false;
  return !!draft.imgMeta || ["value", "observation", "explanation"].some(key => String(draft[key] ?? "").trim() !== "");
}

function isProgressDone(id) { return !!state.logs[id] || hasDraftProgress(id); }
function flowStatus(id) { return isProgressDone(id) ? "done" : curFlow.status[id]; }

function updateStepProgress(id) {
  const done = isProgressDone(id);
  root.querySelectorAll(".toc-pip").forEach(pip => {
    if (pip.dataset.step !== id) return;
    pip.classList.toggle("done", done);
    if (done) pip.classList.remove("current");
  });
  root.querySelectorAll(".sopstep").forEach(step => {
    if (step.dataset.step !== id) return;
    step.classList.toggle("done", done);
    step.classList.toggle("current", !done && curFlow.status[id] === "current");
    const dot = step.querySelector(".status-dot");
    if (dot) {
      dot.classList.toggle("done", done);
      if (done) dot.classList.remove("current");
      dot.textContent = done ? "✓" : curFlat.find(f => f.step.id === id)?.label.split(".").pop() || "";
    }
  });
  const sectionSteps = curFlat.filter(f => f.sec.id === selectedSectionId);
  const sectionDoneCount = sectionSteps.filter(f => isProgressDone(f.step.id)).length;
  const summary = root.querySelector(".section-run-head .muted");
  if (summary) summary.textContent = `${sectionDoneCount}/${sectionSteps.length} bước đã thực hiện`;
  const progressText = root.querySelector(".run-head .muted.small");
  const progressBar = root.querySelector(".run-head .progress > div");
  const doneCount = curFlat.filter(f => isProgressDone(f.step.id)).length;
  const totalCount = curFlat.length;
  if (progressBar) progressBar.style.width = `${totalCount ? doneCount / totalCount * 100 : 0}%`;
  if (progressText) {
    progressText.textContent = `${doneCount}/${totalCount} bước · ${totalCount ? Math.round(doneCount / totalCount * 100) : 0}%`;
  }
}

function startHtml() {
  if (!state.experimentsLoaded) return `<div class="empty">⏳ Đang tải danh sách thí nghiệm…</div>`;
  return `<div class="page-head"><h2>Quy trình</h2><p class="muted small">Chọn thí nghiệm đã lên kế hoạch để xem và thực hiện các bước.</p></div>
    ${state.experiments.length ? state.experiments.map(e => {
      const exp = normalizeExperiment(e);
      const steps = exp.sections.reduce((n, sec) => n + sec.steps.length, 0);
      return `<button type="button" class="card plan-card" data-act="open-experiment" data-exp="${esc(e.id)}">
        <span class="item-title">${esc(exp.title || "(không tên)")}</span>
        <span class="muted small">${exp.sections.length} thí nghiệm · ${steps} bước</span>
        ${exp.description ? `<span class="muted small">${esc(snippet(exp.description, 100))}</span>` : ""}
      </button>`;
    }).join("") : `<div class="empty">Chưa có thí nghiệm nào. Hãy tạo kế hoạch ở tab Kế hoạch.</div>`}`;
}

function hintFor(step, raw) {
  if (!step.require_input || step.require_input.type !== "number" || !step.branch_logic.length) return "";
  const v = parseNum(raw);
  if (Number.isNaN(v)) return "";
  const t = resolveBranch(step, { input_data: v });
  if (!t) return "↪ Gợi ý theo điều kiện: tiếp tục các bước.";
  if (t === END) return "↪ Gợi ý theo điều kiện: kết thúc phần này.";
  const f = curFlat.find(x => x.step.id === t);
  return f ? `↪ Gợi ý theo điều kiện: ưu tiên bước ${f.label}; các bước khác vẫn có thể mở.` : "";
}

function stepAccordion(f, st) {
  const s = f.step, id = s.id, log = state.logs[id];
  const isOpen = expanded.has(id);
  const isEdit = editing.has(id);
  const form = !log || isEdit;
  const role = s.assigned_role ? `Phụ trách: ${esc(s.assigned_role)}` : "";
  const dotContent = { done: "✓", current: f.label.split(".").pop(), pending: f.label.split(".").pop() }[st];

  let body = "";
  if (!isOpen) {
    return `<article class="sopstep ${st}" data-step="${id}">
      <div class="acc-head" data-act="toggle-acc">
        <span class="status-dot ${st}">${dotContent}</span>
        <span class="acc-title">${f.label} · ${richHtml(snippet(s.title || s.text, 64))}</span>
        ${role ? `<span class="acc-role">${role}</span>` : ""}
        <span class="acc-chev">▾</span>
      </div></article>`;
  }

  body = `<div class="step-text">${richHtml(s.text)}</div>` +
    (s.images.length ? `<div>${s.images.map(im => `<img class="thumb" src="${esc(im.url)}" data-act="zoom" data-src="${esc(im.url)}" alt="">`).join("")}</div>` : "");

  if (st === "done" && !isEdit && log) {
    const target = resolveBranch(s, log);
    const tf = target && target !== END ? curFlat.find(x => x.step.id === target) : null;
    body += `<div class="result-box">
      ${s.require_input ? `<div class="kv"><span>${esc(s.require_input.label || "Giá trị")}</span><b>${esc(log.input_data ?? "")} ${esc(log.input_unit || "")}</b></div>` : ""}
      ${log.observation_text ? `<div class="obs-label">${esc(s.observation?.label || "Hiện tượng quan sát thực tế")}</div><div>${richHtml(log.observation_text)}</div>` : ""}
      ${log.explanation_text ? `<div class="exp-label">${esc(s.explanation?.label || "Giải thích và PTPƯ minh họa")}</div><div>${richHtml(log.explanation_text)}</div>` : ""}
      ${log.photo_url ? `<img class="thumb" src="${esc(log.photo_url)}" data-act="zoom" data-src="${esc(log.photo_url)}" alt="ảnh">` : ""}
      ${target ? `<div class="muted small">↪ Điều kiện rẽ nhánh: ${target === END ? "kết thúc bài" : tf ? "bước " + tf.label : ""}</div>` : ""}
      <div class="by">✔ ${esc(log.executed_by_name)} · ${fmtTime(log.timestamp_ms)}</div>
      <div class="btn-row"><button class="btn sm" data-act="edit">✎ Sửa</button><button class="btn sm" data-act="toggle-acc">Gập lại</button></div></div>`;
  }

  if (form) {
    const d = drafts[id] || {};
    const ri = s.require_input;
    const num = ri && ri.type === "number";
    const hasPhoto = d.preview || (isEdit && log?.photo_url);
    const isSaving = saving.has(id);
    const isUploading = uploadingPhoto.has(id);
    body += `<div class="form">
      ${ri ? `<label class="lbl">${esc(ri.label || "Số liệu")}${ri.unit ? ` (${esc(ri.unit)})` : ""}
        <input class="inp big" data-draft="${id}" data-field="value" type="text" inputmode="${num ? "decimal" : "text"}" autocomplete="off"
          value="${esc(d.value ?? "")}" placeholder="${num ? "Nhập số…" : "Nhập…"}"></label>
        <div class="hint" id="hint-${id}">${esc(hintFor(s, d.value))}</div>` : ""}

      ${s.observation?.enabled ? `<label class="lbl">${esc(s.observation.label || "Hiện tượng quan sát thực tế")}
        <textarea class="inp" rows="2" data-draft="${id}" data-field="observation" placeholder="Mô tả hiện tượng đã quan sát được…">${esc(d.observation ?? (isEdit ? log?.observation_text ?? "" : ""))}</textarea></label>` : ""}
      ${s.explanation?.enabled ? `<label class="lbl">${esc(s.explanation.label || "Giải thích và PTPƯ minh họa")}
        <textarea class="inp" rows="2" data-draft="${id}" data-field="explanation" placeholder="Giải thích hiện tượng, viết PTPƯ: $\\ce{...}$">${esc(d.explanation ?? (isEdit ? log?.explanation_text ?? "" : ""))}</textarea></label>` : ""}

      <div class="photo-box">
        ${d.preview ? `<img class="thumb" src="${d.preview}" alt="ảnh mới">` : (isEdit && log?.photo_url ? `<img class="thumb" src="${esc(log.photo_url)}" alt="ảnh cũ">` : "")}
        <label class="btn">${isUploading ? '<span class="spin-ring dark"></span> Đang tải…' : `📷 ${hasPhoto ? "Chụp lại" : "Thêm ảnh"}${s.require_photo ? " (bắt buộc)" : " (tùy chọn)"}`}
          <input type="file" accept="image/*" capture="environment" hidden data-photo="${id}" ${isUploading ? "disabled" : ""}></label>
        ${d.imgMeta ? `<span class="muted small"> Đã tải lên Drive ✓</span>` : ""}
      </div>
      <div class="btn-row">
        <button class="btn primary big" data-act="save" ${isSaving || isUploading ? "disabled" : ""}>${isSaving ? "Đang lưu…" : "💾 Lưu"}</button>
        ${isEdit ? `<button class="btn" data-act="cancel-edit">Hủy</button>` : ""}
      </div></div>`;
  }

  return `<article class="sopstep ${st} expanded" data-step="${id}">
    <div class="acc-head" data-act="toggle-acc">
      <span class="status-dot ${st}">${dotContent}</span>
      <span class="acc-title">${f.label} · ${richHtml(snippet(s.title || s.text, 50))}</span>
      ${role ? `<span class="acc-role">${role}</span>` : ""}
      <span class="acc-chev">▾</span>
    </div>
    <div class="acc-body">${body}</div></article>`;
}

/* ---------- focus ---------- */
function captureFocus() {
  const a = document.activeElement;
  if (a && root.contains(a) && a.dataset?.draft) return { id: a.dataset.draft, field: a.dataset.field, s: a.selectionStart, e: a.selectionEnd };
  return null;
}
function restoreFocus(f) {
  if (!f) return;
  const el = root.querySelector(`[data-draft="${f.id}"][data-field="${f.field}"]`);
  if (el) { el.focus(); try { el.setSelectionRange(f.s, f.e); } catch { /* ignore */ } }
}

/* ---------- sự kiện ---------- */
function onInput(e) {
  const id = e.target.dataset?.draft, field = e.target.dataset?.field;
  if (!id || !field) return;
  (drafts[id] ||= {})[field] = e.target.value;
  updateStepProgress(id);
  if (field === "value") {
    const f = curFlat.find(x => x.step.id === id);
    const h = document.getElementById("hint-" + id);
    if (h && f) h.textContent = hintFor(f.step, e.target.value);
  }
}

async function onChange(e) {
  const id = e.target.dataset?.photo;
  if (!id) return;
  const file = e.target.files?.[0]; e.target.value = "";
  if (!file) return;
  if (!isDriveConfigured) return toast("Chưa cấu hình Google Drive — xem gas/README.md", "error", 4000);
  uploadingPhoto.add(id); render();
  try {
    toast("Đang nén & tải ảnh lên Drive…");
    const blob = await compressImage(file);
    const d = (drafts[id] ||= {});
    if (d.preview) URL.revokeObjectURL(d.preview);
    d.preview = URL.createObjectURL(blob);
    const f = curFlat.find(x => x.step.id === id);
    const meta = { expTitle: curExp.title, sectionName: f?.sec.section_name || "", stepLabel: f?.label || "", runName: state.activeRun?.name || "" };
    const img = await driveUpload(blob, "log", meta);
    d.imgMeta = img;
    updateStepProgress(id);
    toast("Đã tải ảnh lên Drive ✔", "success");
  } catch (err) { console.error(err); toast("Tải ảnh lỗi: " + err.message, "error", 4500); }
  finally { uploadingPhoto.delete(id); render(); }
}

async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn || !root.contains(btn)) return;
  const id = btn.closest("[data-step]")?.dataset.step || btn.dataset.step;
  switch (btn.dataset.act) {
    case "save": return save(id);
    case "toggle-acc": {
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      render(); break;
    }
    case "jump": {
      expanded.add(id);
      render();
      requestAnimationFrame(() => root.querySelector(`[data-step="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      break;
    }
    case "edit": {
      const log = state.logs[id];
      editing.add(id); expanded.add(id);
      drafts[id] = {
        value: log?.input_data != null ? String(log.input_data) : "",
        observation: log?.observation_text || "", explanation: log?.explanation_text || ""
      };
      render(); break;
    }
    case "cancel-edit": editing.delete(id); clearDraft(id); render(); break;
    case "zoom": openModal({ title: "", html: `<img class="zoom" src="${esc(btn.dataset.src)}" alt="">` }); break;
    case "open-experiment": return openExperiment(btn.dataset.exp);
    case "open-section": {
      selectedSectionId = btn.dataset.section;
      expanded.clear();
      const sectionSteps = curFlat.filter(f => f.sec.id === selectedSectionId);
      const firstPending = sectionSteps.find(f => !state.logs[f.step.id]);
      if (firstPending) expanded.add(firstPending.step.id);
      render();
      break;
    }
    case "section-list":
      selectedSectionId = null;
      expanded.clear();
      render();
      break;
    case "experiment-list":
      selectedByUser = false;
      selectedSectionId = null;
      expanded.clear();
      setActiveRun(null);
      render();
      break;
    case "csv": return exportCsv();
  }
}

function clearDraft(id) {
  if (drafts[id]?.preview) URL.revokeObjectURL(drafts[id].preview);
  delete drafts[id];
}

async function save(id) {
  if (saving.has(id) || !curExp) return;
  const f = curFlat.find(x => x.step.id === id); if (!f) return;
  const s = f.step, d = drafts[id] || {}, old = state.logs[id], isEdit = editing.has(id), run = state.activeRun;

  let input = null;
  if (s.require_input) {
    const raw = String(d.value ?? "").trim();
    if (s.require_input.type === "number") {
      const n = parseNum(raw);
      if (Number.isNaN(n)) return toast(`Hãy nhập số hợp lệ cho "${s.require_input.label || "số liệu"}"`, "error");
      input = n;
    } else {
      if (!raw) return toast("Hãy nhập nội dung", "error");
      input = raw;
    }
  }
  if (s.require_photo && !d.imgMeta && !(isEdit && old?.photo_url)) return toast("Bước này bắt buộc chụp ảnh", "error");
  if (uploadingPhoto.has(id)) return toast("Ảnh đang tải lên, vui lòng đợi", "warn");

  const name = state.team.includes(s.assigned_role) ? s.assigned_role : await pickName(state.team);
  if (!name) return;

  saving.add(id); render();
  try {
    const photo_url = d.imgMeta ? d.imgMeta.url : (isEdit ? (old?.photo_url || null) : null);
    const photo_file_id = d.imgMeta ? d.imgMeta.file_id : (isEdit ? (old?.photo_file_id || null) : null);
    const write = setDoc(doc(db, "execution_logs", `${state.activeRunId}__${id}`), {
      exp_id: run.exp_id, run_id: state.activeRunId, step_id: id, step_label: f.label,
      executed_by_name: name, input_data: input, input_unit: s.require_input?.unit || "",
      observation_text: s.observation?.enabled ? String(d.observation ?? "").trim() : "",
      explanation_text: s.explanation?.enabled ? String(d.explanation ?? "").trim() : "",
      photo_url, photo_file_id,
      timestamp: serverTimestamp(), timestamp_ms: Date.now()
    });
    const r = await Promise.race([write, new Promise(res => setTimeout(() => res("timeout"), 6000))]);
    clearDraft(id); editing.delete(id); expanded.delete(id);
    if (r !== "timeout") {
      const next = curFlat.find(item => item.sec.id === f.sec.id && item.ti > f.ti && !state.logs[item.step.id] && !hasDraftProgress(item.step.id));
      if (next) expanded.add(next.step.id);
    }
    toast(r === "timeout" ? "Đang ngoại tuyến — đã lưu tạm, sẽ đồng bộ khi có mạng" : "Đã lưu ✔", r === "timeout" ? "warn" : "success");
  } catch (err) {
    console.error(err); toast("Lưu thất bại: " + (err.code || err.message), "error", 4500);
  } finally { saving.delete(id); render(); }
}

/* ---------- Mở kế hoạch và dùng chung bản ghi của thí nghiệm ---------- */
async function openExperiment(expId) {
  if (openingExperiments.has(expId)) return;
  openingExperiments.add(expId);
  const exp = state.experiments.find(item => item.id === expId);
  try {
    if (!exp) return;
    if (!state.runsLoaded) {
      await new Promise(resolve => {
        let timeout;
        const off = on("runs", () => {
          if (state.runsLoaded) { clearTimeout(timeout); off(); resolve(); }
        });
        timeout = setTimeout(() => { off(); resolve(); }, 6000);
      });
    }
    if (!state.runsLoaded) return toast("Danh sách thí nghiệm chưa tải xong. Hãy thử lại.", "warn");
    let run = state.runs.find(item => item.exp_id === expId);
    if (!run) {
      const ref = doc(db, "runs", `experiment_${exp.id}`);
      run = { id: ref.id };
      await setDoc(ref, {
        exp_id: exp.id, exp_title: exp.title, name: exp.title || "Thí nghiệm",
        created_at_ms: Date.now()
      });
    }
    selectedByUser = true;
    selectedSectionId = null;
    expanded.clear();
    setActiveRun(run.id);
  } catch (err) {
    console.error(err);
    toast("Không mở được thí nghiệm: " + (err.code || err.message), "error", 4500);
  } finally {
    openingExperiments.delete(expId);
  }
}

function exportCsv() {
  if (!curFlow) return;
  const rows = [["Bước", "Tiêu đề", "Nội dung", "Người thực hiện", "Giá trị", "Đơn vị", "Hiện tượng quan sát", "Giải thích & PTPƯ", "Ảnh", "Thời gian"]];
  curFlat.forEach(f => {
    const l = state.logs[f.step.id];
    if (curFlow.status[f.step.id] === "done" && l)
      rows.push([f.label, f.step.title || "", f.step.text.replace(/\s+/g, " "), l.executed_by_name, l.input_data ?? "", l.input_unit || "",
        l.observation_text || "", l.explanation_text || "", l.photo_url || "", new Date(l.timestamp_ms).toLocaleString("vi-VN")]);
  });
  const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadFile(`${(state.activeRun?.name || "luot").replace(/[^\w\-]+/g, "_")}.csv`, csv, "text/csv;charset=utf-8");
}