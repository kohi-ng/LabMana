// ============ Tab Quy trình (SOP & Data Logger) ============
// Các bước chưa làm đều có thể mở và thực hiện độc lập; menu Tiến trình hỗ trợ điều hướng.
import { state, on, setActiveRun } from "../store.js";
import { db } from "../firebase.js";
import { doc, collection, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { driveUpload, driveDelete, driveImageUrl, driveFileUrl, isDriveConfigured } from "../drive.js";
import { esc, richHtml, renderMath, toast, openModal, confirmBox, pickName, statusCard, fmtTime, downloadFile } from "../utils.js";
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
export function onShow() {
  selectedByUser = false;
  selectedSectionId = null;
  expanded.clear();
  schedule();
}
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

export async function openProgressTarget(expId, sectionId = null, stepId = null) {
  const opened = await openExperiment(expId);
  if (!opened) return;
  const raw = state.experiments.find(item => item.id === expId);
  const sections = raw ? normalizeExperiment(raw).sections : [];
  selectedSectionId = sectionId || sections[0]?.id || null;
  expanded.clear();
  if (stepId) expanded.add(stepId);
  else if (sectionId) {
    const raw = state.experiments.find(item => item.id === expId);
    const section = raw && normalizeExperiment(raw).sections.find(item => item.id === sectionId);
    const firstPending = section?.steps.find(step => !state.logs[step.id]);
    if (firstPending) expanded.add(firstPending.id);
  }
  render();
  if (stepId) requestAnimationFrame(() => root.querySelector(`[data-step="${stepId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

export function isStepProgressDone(stepId) { return isProgressDone(stepId); }

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

  const selectedSection = curExp.sections.find(sec => sec.id === selectedSectionId) || curExp.sections[0];
  if (!selectedSection) { root.innerHTML = startHtml(); return; }
  if (selectedSection.id !== selectedSectionId) selectedSectionId = selectedSection.id;
  const sectionIndex = curExp.sections.indexOf(selectedSection);
  const sectionFlat = curFlat.filter(f => f.sec.id === selectedSection.id);
  const sectionDone = sectionFlat.filter(f => isProgressDone(f.step.id)).length;
  let html = `<div class="sop-active-head">
      <button class="btn sm" data-act="sop-home">← Trang chính</button>
      <h2>${esc(curExp.title || "Bài thí nghiệm")}</h2>
    </div>
    <div class="section-run-head">
      <h2>TN ${sectionIndex + 1} · ${richHtml(selectedSection.section_name)}</h2>
      <p class="muted small">${sectionDone}/${sectionFlat.length} bước đã thực hiện</p>
      ${tocStrip(sectionFlat)}
    </div>`;
  if (sectionFlat.length && sectionFlat.every(f => state.logs[f.step.id])) html += `<div class="done-banner">🎉 Đã hoàn thành thí nghiệm này!</div>`;
  html += sectionFlat.map(f => stepAccordion(f, flowStatus(f.step.id))).join("");
  root.innerHTML = html;
  renderMath(root);
  restoreFocus(focus);
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
  return (!draft.removePhoto && !!draft.imgMeta) || ["value", "observation", "explanation"].some(key => String(draft[key] ?? "").trim() !== "");
}

function isProgressDone(id) { return !!state.logs[id] || hasDraftProgress(id); }
function hasSavedPhoto(log) { return !!(log?.photo_file_id || log?.photo_url); }
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
  window.dispatchEvent(new CustomEvent("labmana:progress-change"));
}

function startHtml() {
  if (!state.experimentsLoaded) return `<div class="empty">⏳ Đang tải danh sách bài thí nghiệm…</div>`;
  if (!state.experiments.length) return `<div class="page-head"><h2>Quy trình</h2></div>
    <div class="empty">Chưa có bài thí nghiệm đã lên kế hoạch.</div>`;
  return `<div class="page-head"><h2>Quy trình</h2></div>
    <div class="planned-experiments">${state.experiments.map(raw => {
      const exp = normalizeExperiment(raw);
      return `<button type="button" class="card plan-card planned-experiment" data-act="open-experiment" data-exp="${esc(raw.id)}">
        ${esc(exp.title || "(không tên)")}
      </button>`;
    }).join("")}</div>`;
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
        <span class="acc-title">${f.label} · ${richHtml(s.title || s.text)}</span>
        ${role ? `<span class="acc-role">${role}</span>` : ""}
        <span class="acc-chev">▾</span>
      </div></article>`;
  }

  body = `<div class="step-text">${richHtml(s.text)}</div>` +
    (s.images.length ? `<div>${s.images.map(im => {
      const imageUrl = im.file_id ? driveImageUrl(im.file_id) : im.url;
      return `<img class="thumb" src="${esc(imageUrl)}" data-act="zoom" data-src="${esc(imageUrl)}" alt="">`;
    }).join("")}</div>` : "");

  if (st === "done" && !isEdit && log) {
    const target = resolveBranch(s, log);
    const tf = target && target !== END ? curFlat.find(x => x.step.id === target) : null;
    const photoUrl = log.photo_file_id ? driveImageUrl(log.photo_file_id) : log.photo_url;
    body += `<div class="result-box">
      ${s.require_input ? `<div class="kv"><span>${esc(s.require_input.label || "Giá trị")}</span><b>${esc(log.input_data ?? "")} ${esc(log.input_unit || "")}</b></div>` : ""}
      ${log.observation_text ? `<div class="obs-label">${esc(s.observation?.label || "Hiện tượng quan sát thực tế")}</div><div>${richHtml(log.observation_text)}</div>` : ""}
      ${log.explanation_text ? `<div class="exp-label">${esc(s.explanation?.label || "Giải thích và PTPƯ minh họa")}</div><div>${richHtml(log.explanation_text)}</div>` : ""}
      ${photoUrl ? `<img class="thumb" src="${esc(photoUrl)}" data-act="zoom" data-src="${esc(photoUrl)}" alt="ảnh">` : ""}
      ${target ? `<div class="muted small">↪ Điều kiện rẽ nhánh: ${target === END ? "kết thúc bài" : tf ? "bước " + tf.label : ""}</div>` : ""}
      <div class="by">✔ ${esc(log.executed_by_name)} · ${fmtTime(log.timestamp_ms)}</div>
      <div class="btn-row"><button class="btn sm" data-act="edit">✎ Sửa</button><button class="btn sm" data-act="toggle-acc">Gập lại</button></div></div>`;
  }

  if (form) {
    const d = drafts[id] || {};
    const ri = s.require_input;
    const num = ri && ri.type === "number";
    const oldPhotoUrl = log?.photo_file_id ? driveImageUrl(log.photo_file_id) : log?.photo_url;
    const hasPhoto = !d.removePhoto && (d.pendingPreview || d.preview || (isEdit && oldPhotoUrl));
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

      <div class="photo-preview">
        ${!d.removePhoto && (d.pendingPreview || d.preview) ? `<img class="thumb" src="${d.pendingPreview || d.preview}" alt="ảnh mới">` : (!d.removePhoto && isEdit && oldPhotoUrl ? `<img class="thumb" src="${esc(oldPhotoUrl)}" alt="ảnh cũ">` : "")}
        ${d.imgMeta && !d.pendingFile ? `${d.imgMeta.storage_fallback
          ? '<span class="muted small">Ảnh đã lưu kèm nhật ký ✓</span>'
          : `<a class="img-link" href="${esc(driveFileUrl(d.imgMeta.file_id))}" target="_blank" rel="noopener noreferrer">Ảnh đã tải lên Drive: ${esc(d.imgMeta.name || "Mở ảnh")} ↗</a>`}` : ""}
        ${d.removePhoto ? '<span class="muted small">Ảnh sẽ bị gỡ khi lưu.</span>' : ""}
      </div>
      ${d.pendingFile ? `<label class="lbl">Tên file trên Drive (không bắt buộc)
        <input class="inp" data-draft="${id}" data-field="photoName" value="${esc(d.photoName || "")}" placeholder="Để trống để dùng tên mặc định"></label>
        <button class="btn sm primary upload-photo" data-act="upload-photo" data-step="${id}" ${isSaving || isUploading ? "disabled" : ""}>
          ${isUploading ? '<span class="spin-ring dark"></span> Đang tải…' : "Tải ảnh lên Drive"}
        </button>` : ""}
      ${hasPhoto ? `<button class="btn sm danger photo-remove" data-act="${d.pendingFile ? "discard-pending-photo" : "remove-photo"}" ${isSaving || isUploading ? "disabled" : ""}>${d.pendingFile ? "Bỏ ảnh mới" : "Xóa ảnh"}</button>` : ""}
      <div class="step-submit-row">
        <label class="btn photo-action">${`📷 ${hasPhoto ? "Chụp lại" : "Chụp ảnh"}${s.require_photo ? " · Bắt buộc" : ""}`}
          <input type="file" accept="image/*" capture="environment" hidden data-photo="${id}" ${isSaving || isUploading ? "disabled" : ""}></label>
        <button class="btn primary" data-act="save" ${isSaving || isUploading || d.pendingFile ? "disabled" : ""}>${isSaving ? "Đang lưu…" : "Lưu"}</button>
      </div>
      ${d.pendingFile ? '<span class="muted small">Tải ảnh lên Drive trước khi lưu bước.</span>' : ""}
      ${isEdit ? `<button class="btn cancel-edit" data-act="cancel-edit" ${isSaving || isUploading ? "disabled" : ""}>Hủy sửa</button>` : ""}
      </div>`;
  }

  return `<article class="sopstep ${st} expanded" data-step="${id}">
    <div class="acc-head" data-act="toggle-acc">
      <span class="status-dot ${st}">${dotContent}</span>
      <span class="acc-title">${f.label} · ${richHtml(s.title || s.text)}</span>
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
  if (!isDriveConfigured) return toast("Chưa cấu hình Google Drive — xem hướng dẫn triển khai trong code.gs", "error", 4000);
  const d = (drafts[id] ||= {});
  if (d.pendingPreview) URL.revokeObjectURL(d.pendingPreview);
  d.pendingFile = file;
  d.pendingPreview = URL.createObjectURL(file);
  d.photoName = "";
  d.removePhoto = false;
  render();
}

async function uploadPhoto(id) {
  const d = drafts[id];
  if (!d?.pendingFile || uploadingPhoto.has(id)) return;
  uploadingPhoto.add(id); render();
  try {
    toast("Đang tải ảnh lên Drive…");
    const previousUpload = d.imgMeta;
    const f = curFlat.find(x => x.step.id === id);
    const file = d.pendingFile;
    const meta = {
      expTitle: curExp.title, sectionName: f?.sec.section_name || "",
      stepLabel: f?.label || "", runName: state.activeRun?.name || "",
      fileName: d.photoName, originalName: file.name
    };
    const img = await driveUpload(file, "log", meta);
    d.imgMeta = img;
    d.pendingFile = null;
    if (d.preview) URL.revokeObjectURL(d.preview);
    d.preview = d.pendingPreview;
    d.pendingPreview = null;
    d.removePhoto = false;
    if (previousUpload?.file_id && previousUpload.file_id !== img.file_id &&
        previousUpload.file_id !== state.logs[id]?.photo_file_id) {
      try { await driveDelete(previousUpload.file_id); }
      catch (err) {
        console.error(err);
        toast("Đã nhận ảnh mới, nhưng ảnh chụp trước chưa xóa được khỏi Drive.", "warn", 5000);
      }
    }
    updateStepProgress(id);
    toast(img.storage_fallback
      ? "Drive chưa xác nhận; ảnh đã được giữ trong nhật ký để có thể lưu bước."
      : `Đã tải ảnh ${img.name || "lên Drive"} ✔`, img.storage_fallback ? "warn" : "success", 5000);
  } catch (err) { console.error(err); toast("Tải ảnh lỗi: " + err.message, "error", 4500); }
  finally { uploadingPhoto.delete(id); render(); }
}

async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn || !root.contains(btn)) return;
  if (btn.dataset.act === "toggle-acc" && e.target.closest("input, textarea, select")) return;
  const id = btn.closest("[data-step]")?.dataset.step || btn.dataset.step;
  switch (btn.dataset.act) {
    case "save": return save(id);
    case "upload-photo": return uploadPhoto(id);
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
    case "discard-pending-photo": {
      const draft = drafts[id];
      if (draft?.pendingPreview) URL.revokeObjectURL(draft.pendingPreview);
      if (draft) { draft.pendingFile = null; draft.pendingPreview = null; draft.photoName = ""; }
      render();
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
    case "cancel-edit": return cancelEdit(id);
    case "remove-photo": {
      if (!(await confirmBox("Ảnh sẽ bị gỡ khỏi bản ghi và xóa khỏi Google Drive khi bạn lưu. Tiếp tục?", "Xóa ảnh"))) return;
      (drafts[id] ||= {}).removePhoto = true;
      updateStepProgress(id);
      render();
      break;
    }
    case "zoom": openModal({ title: "", html: `<img class="zoom" src="${esc(btn.dataset.src)}" alt="">` }); break;
    case "open-experiment": return openExperiment(btn.dataset.exp);
    case "sop-home":
      selectedByUser = false;
      selectedSectionId = null;
      expanded.clear();
      render();
      break;
    case "csv": return exportCsv();
  }
}

function clearDraft(id) {
  if (drafts[id]?.preview) URL.revokeObjectURL(drafts[id].preview);
  if (drafts[id]?.pendingPreview) URL.revokeObjectURL(drafts[id].pendingPreview);
  delete drafts[id];
}

async function cancelEdit(id) {
  const draft = drafts[id];
  const oldFileId = state.logs[id]?.photo_file_id;
  editing.delete(id);
  clearDraft(id);
  render();
  if (draft?.imgMeta?.file_id && draft.imgMeta.file_id !== oldFileId) {
    try { await driveDelete(draft.imgMeta.file_id); }
    catch (err) {
      console.error(err);
      toast("Sửa đã hủy, nhưng ảnh mới chưa xóa được khỏi Drive: " + err.message, "warn", 5000);
    }
  }
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
  if (uploadingPhoto.has(id)) return toast("Ảnh đang tải lên, vui lòng đợi", "warn");
  if (d.pendingFile) return toast("Hãy tải ảnh lên Drive trước khi lưu bước", "warn");
  const uploadedPhoto = !!(d.imgMeta?.file_id || d.imgMeta?.url);
  if (s.require_photo && (d.removePhoto || (!uploadedPhoto && !(isEdit && hasSavedPhoto(old))))) {
    return toast("Bước này bắt buộc chụp ảnh", "error");
  }

  const name = state.team.includes(s.assigned_role) ? s.assigned_role : await pickName(state.team);
  if (!name) return;

  saving.add(id); render();
  try {
    const photo_url = d.removePhoto ? null : (d.imgMeta ? d.imgMeta.url :
      (isEdit ? (old?.photo_url || (old?.photo_file_id ? driveImageUrl(old.photo_file_id) : null)) : null));
    const photo_file_id = d.removePhoto ? null : (d.imgMeta ? d.imgMeta.file_id : (isEdit ? (old?.photo_file_id || null) : null));
    await setDoc(doc(db, "execution_logs", `${state.activeRunId}__${id}`), {
      exp_id: run.exp_id, run_id: state.activeRunId, step_id: id, step_label: f.label,
      executed_by_name: name, input_data: input, input_unit: s.require_input?.unit || "",
      observation_text: s.observation?.enabled ? String(d.observation ?? "").trim() : "",
      explanation_text: s.explanation?.enabled ? String(d.explanation ?? "").trim() : "",
      photo_url, photo_file_id,
      timestamp: serverTimestamp(), timestamp_ms: Date.now()
    });
    const filesToDelete = new Set();
    if (old?.photo_file_id && old.photo_file_id !== photo_file_id) filesToDelete.add(old.photo_file_id);
    if (d.removePhoto && d.imgMeta?.file_id) filesToDelete.add(d.imgMeta.file_id);
    clearDraft(id); editing.delete(id); expanded.delete(id);
    const next = curFlat.find(item => item.sec.id === f.sec.id && item.ti > f.ti && !state.logs[item.step.id] && !hasDraftProgress(item.step.id));
    if (next) expanded.add(next.step.id);
    let deleteWarning = "";
    for (const fileId of filesToDelete) {
      try { await driveDelete(fileId); }
      catch (err) {
        console.error(err);
        deleteWarning = " Bản ghi đã lưu nhưng có ảnh chưa xóa được khỏi Drive.";
      }
    }
    toast(deleteWarning ? `Đã lưu ✔${deleteWarning}` : "Đã lưu ✔", deleteWarning ? "warn" : "success", 5000);
  } catch (err) {
    console.error(err); toast("Lưu thất bại: " + (err.code || err.message), "error", 4500);
  } finally { saving.delete(id); render(); }
}

/* ---------- Mở kế hoạch và dùng chung bản ghi của thí nghiệm ---------- */
async function openExperiment(expId) {
  if (openingExperiments.has(expId)) return false;
  openingExperiments.add(expId);
  const exp = state.experiments.find(item => item.id === expId);
  try {
    if (!exp) return false;
    if (!state.runsLoaded) {
      await new Promise(resolve => {
        let timeout;
        const off = on("runs", () => {
          if (state.runsLoaded) { clearTimeout(timeout); off(); resolve(); }
        });
        if (state.runsLoaded) { off(); return resolve(); }
        timeout = setTimeout(() => { off(); resolve(); }, 6000);
      });
    }
    if (!state.runsLoaded) {
      toast("Danh sách thí nghiệm chưa tải xong. Hãy thử lại.", "warn");
      return false;
    }
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
    selectedSectionId = normalizeExperiment(exp).sections[0]?.id || null;
    expanded.clear();
    setActiveRun(run.id);
    render();
    return true;
  } catch (err) {
    console.error(err);
    toast("Không mở được thí nghiệm: " + (err.code || err.message), "error", 4500);
    return false;
  } finally {
    openingExperiments.delete(expId);
  }
}

export function canExportCurrentCsv() { return !!curFlow; }
export function exportCurrentCsv() { exportCsv(); }

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