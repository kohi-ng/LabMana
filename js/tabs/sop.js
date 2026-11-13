// ============ Tab Quy trình (SOP & Data Logger) ============
// Chỉ hiển thị thao tác đang chọn; menu Tiến trình hỗ trợ điều hướng trực tiếp.
import { state, on, setActiveRun } from "../store.js";
import { db } from "../firebase.js";
import { doc, collection, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { driveUpload, driveDelete, driveImageUrl, driveFileUrl, isDriveConfigured } from "../drive.js";
import { esc, richHtml, renderMath, toast, openModal, pickName, statusCard, fmtTime, downloadFile } from "../utils.js";
import { computeFlow, resolveBranch, normalizeExperiment, parseNum, END } from "../plan-logic.js";

let root, raf = 0, selectedByUser = false, selectedSectionId = null, selectedStepId = null;
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
  selectedStepId = null;
  expanded.clear();
  schedule();
}
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

export async function openProgressTarget(expId, sectionId = null, stepId = null) {
  const opened = await openExperiment(expId);
  if (!opened) return;
  const raw = state.experiments.find(item => item.id === expId);
  const sections = raw ? normalizeExperiment(raw).sections : [];
  const targetSection = sections.find(section => section.id === sectionId || section.steps.some(step => step.id === stepId)) || sections[0];
  selectedSectionId = targetSection?.id || null;
  expanded.clear();
  const targetStep = stepId
    ? targetSection?.steps.find(step => step.id === stepId)
    : targetSection?.steps.find(step => !state.logs[step.id] && !hasDraftProgress(step.id)) || targetSection?.steps[0];
  selectedStepId = targetStep?.id || null;
  if (targetStep) expanded.add(targetStep.id);
  render();
  window.dispatchEvent(new CustomEvent("labmana:progress-change"));
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  let selectedStep = sectionFlat.find(f => f.step.id === selectedStepId);
  if (!selectedStep) {
    selectedStep = sectionFlat.find(f => !isProgressDone(f.step.id)) || sectionFlat[0];
    selectedStepId = selectedStep?.step.id || null;
    expanded.clear();
    if (selectedStep) expanded.add(selectedStep.step.id);
  }
  const sectionDone = sectionFlat.filter(f => isProgressDone(f.step.id)).length;
  let html = `<div class="sop-active-head">
      <button class="btn sm sop-back" data-act="sop-home" aria-label="Quay lại danh sách bài" title="Quay lại danh sách bài">←</button>
      <div class="sop-active-title">
        <h2>${esc(curExp.title || "Bài thí nghiệm")}</h2>
        ${sectionPickerHtml()}
      </div>
    </div>
    <div class="section-run-head">
      <h2>TN ${sectionIndex + 1} · ${richHtml(selectedSection.section_name)}</h2>
      <p class="muted small">${sectionDone}/${sectionFlat.length} bước đã thực hiện</p>
      ${tocStrip(sectionFlat)}
    </div>`;
  if (sectionFlat.length && sectionFlat.every(f => state.logs[f.step.id])) html += `<div class="done-banner">🎉 Đã hoàn thành thí nghiệm này!</div>`;
  if (selectedStep) html += stepAccordion(selectedStep, flowStatus(selectedStep.step.id));
  else html += `<div class="empty">Thí nghiệm này chưa có thao tác.</div>`;
  root.innerHTML = html;
  renderMath(root);
  restoreFocus(focus);
}

function sectionPickerHtml() {
  return `<nav class="sop-section-picker" aria-label="Chọn thí nghiệm">
    ${curExp.sections.map((section, index) => {
      const steps = curFlat.filter(item => item.sec.id === section.id);
      const done = steps.length > 0 && steps.every(item => isProgressDone(item.step.id));
      return `<button type="button" class="sop-section-dot ${section.id === selectedSectionId ? "active" : ""} ${done ? "done" : ""}"
        data-act="select-section" data-section="${esc(section.id)}" aria-label="Thí nghiệm ${index + 1}: ${esc(section.section_name || "Chưa đặt tên")}"
        aria-pressed="${section.id === selectedSectionId}" title="${esc(section.section_name || `Thí nghiệm ${index + 1}`)}">${index + 1}</button>`;
    }).join("")}
  </nav>`;
}

function tocStrip(steps) {
  return `<nav class="toc-strip" aria-label="Chọn thao tác">${steps.map(f => {
    const st = flowStatus(f.step.id);
    const active = f.step.id === selectedStepId;
    return `<button type="button" class="toc-pip ${st} ${active ? "active" : ""}" data-act="jump" data-step="${f.step.id}" aria-label="Hiện bước ${f.label}" aria-pressed="${active}" title="Bước ${f.label}">${f.label}</button>`;
  }).join("")}</nav>`;
}

function hasDraftProgress(id) {
  const draft = drafts[id];
  if (!draft) return false;
  return (draft.photoItems || []).some(item => item.imgMeta && !item.removed) ||
    ["value", "observation", "explanation"].some(key => String(draft[key] ?? "").trim() !== "");
}

function isProgressDone(id) { return !!state.logs[id] || hasDraftProgress(id); }
function savedPhotos(log) {
  if (Array.isArray(log?.photos) && log.photos.length) return log.photos.filter(photo => photo?.file_id || photo?.url);
  return log?.photo_file_id || log?.photo_url
    ? [{ file_id: log.photo_file_id || "", url: log.photo_url || "", name: log.photo_name || "" }]
    : [];
}
function driveLinkHtml(fileId) {
  if (!fileId) return "";
  const url = driveFileUrl(fileId);
  return `<div class="drive-link-panel">
    <span class="muted small">Link Google Drive</span>
    <div class="drive-link-row">
      <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Mở ảnh ↗</a>
      <input class="inp drive-link-input" type="text" readonly value="${esc(url)}" aria-label="Link Google Drive của ảnh">
      <button type="button" class="btn sm" data-act="copy-drive-link" data-link="${esc(url)}">Sao chép</button>
    </div>
  </div>`;
}
function photoKey(photo) {
  if (photo.file_id) return photo.file_id;
  const url = photo.url || "";
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) hash = Math.imul(hash ^ url.charCodeAt(i), 16777619);
  return `url-${url.length}-${hash >>> 0}`;
}
function flowStatus(id) { return isProgressDone(id) ? "done" : curFlow.status[id]; }

function updateStepProgress(id) {
  const done = isProgressDone(id);
  root.querySelectorAll(".toc-pip").forEach(pip => {
    if (pip.dataset.step !== id) return;
    pip.classList.toggle("done", done);
    pip.classList.toggle("active", selectedStepId === id);
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
  root.querySelectorAll(".sop-section-dot").forEach(dot => {
    const steps = curFlat.filter(f => f.sec.id === dot.dataset.section);
    dot.classList.toggle("done", steps.length > 0 && steps.every(f => isProgressDone(f.step.id)));
  });
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
    body += `<div class="result-box">
      ${s.require_input ? `<div class="kv"><span>${esc(s.require_input.label || "Giá trị")}</span><b>${esc(log.input_data ?? "")} ${esc(log.input_unit || "")}</b></div>` : ""}
      ${log.observation_text ? `<div class="obs-label">${esc(s.observation?.label || "Hiện tượng quan sát thực tế")}</div><div>${richHtml(log.observation_text)}</div>` : ""}
      ${log.explanation_text ? `<div class="exp-label">${esc(s.explanation?.label || "Giải thích và PTPƯ minh họa")}</div><div>${richHtml(log.explanation_text)}</div>` : ""}
      ${savedPhotos(log).map(photo => {
        const url = photo.file_id ? driveImageUrl(photo.file_id) : photo.url;
        return `<div class="saved-photo">
          <img class="thumb" src="${esc(url)}" data-act="zoom" data-src="${esc(url)}" alt="ảnh">
          ${photo.file_id ? driveLinkHtml(photo.file_id) : ""}
        </div>`;
      }).join("")}
      ${target ? `<div class="muted small">↪ Điều kiện rẽ nhánh: ${target === END ? "kết thúc bài" : tf ? "bước " + tf.label : ""}</div>` : ""}
      <div class="by">✔ ${esc(log.executed_by_name)} · ${fmtTime(log.timestamp_ms)}</div>
      <div class="btn-row"><button class="btn sm" data-act="edit">✎ Sửa</button><button class="btn sm" data-act="toggle-acc">Gập lại</button></div></div>`;
  }

  if (form) {
    const d = drafts[id] || {};
    const ri = s.require_input;
    const num = ri && ri.type === "number";
    const oldPhotos = isEdit ? savedPhotos(log) : [];
    const removedPhotos = d.removedPhotos || new Set();
    const retainedPhotos = oldPhotos.filter(photo => !removedPhotos.has(photoKey(photo)));
    const newPhotos = d.photoItems || [];
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

      <div class="photo-list">
        ${retainedPhotos.map(photo => {
          const url = photo.file_id ? driveImageUrl(photo.file_id) : photo.url;
          return `<div class="photo-item saved-photo">
            <img class="thumb" src="${esc(url)}" data-act="zoom" data-src="${esc(url)}" alt="ảnh đã lưu">
            ${photo.file_id ? driveLinkHtml(photo.file_id) : '<span class="muted small">Ảnh đã lưu</span>'}
            <button type="button" class="btn sm danger" data-act="remove-saved-photo" data-photo-key="${esc(photoKey(photo))}" ${isSaving || isUploading ? "disabled" : ""}>Xóa ảnh</button>
          </div>`;
        }).join("")}
        ${newPhotos.map((photo, index) => photo.removed ? "" : `<div class="photo-item">
          <img class="thumb" src="${esc(photo.preview)}" alt="ảnh ${index + 1}">
          ${photo.imgMeta ? (photo.imgMeta.storage_fallback
            ? '<span class="muted small">Ảnh đã lưu kèm nhật ký ✓</span>'
            : driveLinkHtml(photo.imgMeta.file_id))
            : `<label class="lbl">Tên file trên Drive (không bắt buộc)
                <input class="inp" data-photo-name="${index}" value="${esc(photo.name || "")}" placeholder="Để trống để dùng tên mặc định">
              </label>
              <button type="button" class="btn sm primary" data-act="upload-photo" data-photo-index="${index}" ${isSaving || isUploading ? "disabled" : ""}>
                ${isUploading ? '<span class="spin-ring dark"></span> Đang tải…' : "Tải ảnh lên Drive"}
              </button>`}
          <button type="button" class="btn sm danger" data-act="remove-new-photo" data-photo-index="${index}" ${isSaving || isUploading ? "disabled" : ""}>Bỏ ảnh</button>
        </div>`).join("")}
      </div>
      ${retainedPhotos.some(photo => photo.file_id) ? '<span class="muted small">Ảnh đã lưu trên Drive.</span>' : ""}
      <div class="step-submit-row">
        <label class="btn photo-action">📷 Chụp / thêm ảnh${s.require_photo ? " · Bắt buộc" : ""}
          <input type="file" accept="image/*" capture="environment" multiple hidden data-photo="${id}" ${isSaving || isUploading ? "disabled" : ""}></label>
        <button class="btn primary" data-act="save" ${isSaving || isUploading || newPhotos.some(photo => !photo.imgMeta && !photo.removed) ? "disabled" : ""}>${isSaving ? "Đang lưu…" : "Lưu"}</button>
      </div>
      ${newPhotos.some(photo => !photo.imgMeta && !photo.removed) ? '<span class="muted small">Tải ảnh mới lên Drive trước khi lưu bước.</span>' : ""}
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
  const photoIndex = e.target.dataset?.photoName;
  const stepId = e.target.closest("[data-step]")?.dataset.step;
  if (photoIndex !== undefined && stepId) {
    const item = drafts[stepId]?.photoItems?.[Number(photoIndex)];
    if (item) item.name = e.target.value;
    return;
  }
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
  const files = Array.from(e.target.files || []); e.target.value = "";
  if (!files.length) return;
  if (!isDriveConfigured) return toast("Chưa cấu hình Google Drive — xem hướng dẫn triển khai trong code.gs", "error", 4000);
  const d = (drafts[id] ||= {});
  d.photoItems ||= [];
  files.forEach(file => d.photoItems.push({
    file,
    preview: URL.createObjectURL(file),
    name: "",
    imgMeta: null,
    removed: false
  }));
  render();
}

async function uploadPhoto(id, index) {
  const d = drafts[id];
  const photo = d?.photoItems?.[index];
  if (!photo?.file || photo.removed || uploadingPhoto.has(id)) return;
  uploadingPhoto.add(id); render();
  try {
    toast("Đang tải ảnh lên Drive…");
    const f = curFlat.find(x => x.step.id === id);
    const file = photo.file;
    const meta = {
      expTitle: curExp.title, sectionName: f?.sec.section_name || "",
      stepLabel: f?.label || "", runName: state.activeRun?.name || "",
      fileName: photo.name, originalName: file.name
    };
    const img = await driveUpload(file, "log", meta);
    photo.imgMeta = img;
    photo.file = null;
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
    case "upload-photo": return uploadPhoto(id, Number(btn.dataset.photoIndex));
    case "copy-drive-link": return copyDriveLink(btn.dataset.link);
    case "toggle-acc": {
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      render(); break;
    }
    case "jump": {
      selectedStepId = id;
      expanded.clear();
      expanded.add(id);
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    }
    case "edit": {
      const log = state.logs[id];
      editing.add(id); expanded.add(id);
      drafts[id] = {
        value: log?.input_data != null ? String(log.input_data) : "",
        observation: log?.observation_text || "", explanation: log?.explanation_text || "",
        removedPhotos: new Set(), photoItems: []
      };
      render(); break;
    }
    case "cancel-edit": return cancelEdit(id);
    case "select-section": {
      selectedSectionId = btn.dataset.section;
      expanded.clear();
      const sectionSteps = curFlat.filter(f => f.sec.id === selectedSectionId);
      const target = sectionSteps.find(f => !isProgressDone(f.step.id)) || sectionSteps[0];
      selectedStepId = target?.step.id || null;
      if (target) expanded.add(target.step.id);
      render();
      window.dispatchEvent(new CustomEvent("labmana:progress-change"));
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    }
    case "remove-saved-photo": {
      if (!(await confirmBox("Ảnh sẽ bị gỡ khỏi bản ghi và xóa khỏi Google Drive khi bạn lưu. Tiếp tục?", "Xóa ảnh"))) return;
      const draft = (drafts[id] ||= {});
      draft.removedPhotos ||= new Set();
      draft.removedPhotos.add(btn.dataset.photoKey);
      render();
      window.dispatchEvent(new CustomEvent("labmana:progress-change"));
      break;
    }
    case "remove-new-photo": {
      if (!(await confirmBox("Bạn có chắc muốn bỏ ảnh này khỏi bước?", "Bỏ ảnh"))) return;
      const photo = drafts[id]?.photoItems?.[Number(btn.dataset.photoIndex)];
      if (photo) photo.removed = true;
      render();
      updateStepProgress(id);
      break;
    }
    case "zoom": openModal({ title: "", html: `<img class="zoom" src="${esc(btn.dataset.src)}" alt="">` }); break;
    case "open-experiment": return openExperiment(btn.dataset.exp);
    case "sop-home":
      selectedByUser = false;
      selectedSectionId = null;
      selectedStepId = null;
      expanded.clear();
      render();
      break;
    case "csv": return exportCsv();
  }
}

async function copyDriveLink(url) {
  if (!url) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement("textarea");
      input.value = url;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("Trình duyệt không cho phép sao chép liên kết.");
    }
    toast("Đã sao chép link Google Drive ✔", "success");
  } catch (err) {
    console.error(err);
    toast("Không sao chép được link: " + err.message, "error");
  }
}

function clearDraft(id) {
  if (drafts[id]?.preview) URL.revokeObjectURL(drafts[id].preview);
  if (drafts[id]?.pendingPreview) URL.revokeObjectURL(drafts[id].pendingPreview);
  for (const photo of drafts[id]?.photoItems || []) {
    if (photo.preview) URL.revokeObjectURL(photo.preview);
  }
  delete drafts[id];
}

async function cancelEdit(id) {
  const draft = drafts[id];
  const oldFileIds = new Set(savedPhotos(state.logs[id]).map(photo => photo.file_id).filter(Boolean));
  editing.delete(id);
  clearDraft(id);
  render();
  let deleteWarning = false;
  for (const photo of draft?.photoItems || []) {
    const fileId = photo.imgMeta?.file_id;
    if (!fileId || oldFileIds.has(fileId)) continue;
    try { await driveDelete(fileId); }
    catch (err) {
      console.error(err);
      deleteWarning = true;
    }
  }
  if (deleteWarning) toast("Sửa đã hủy, nhưng có ảnh mới chưa xóa được khỏi Drive.", "warn", 5000);
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
  if ((d.photoItems || []).some(photo => !photo.removed && !photo.imgMeta)) return toast("Hãy tải ảnh mới lên Drive trước khi lưu bước", "warn");
  const photosToSave = [
    ...(isEdit ? savedPhotos(old).filter(photo => !d.removedPhotos?.has(photoKey(photo))) : []),
    ...(d.photoItems || []).filter(photo => !photo.removed && photo.imgMeta)
      .map(photo => ({ file_id: photo.imgMeta.file_id || "", url: photo.imgMeta.url || "", name: photo.imgMeta.name || "" }))
  ];
  if (s.require_photo && !photosToSave.length) {
    return toast("Bước này bắt buộc chụp ảnh", "error");
  }

  const name = state.team.includes(s.assigned_role) ? s.assigned_role : await pickName(state.team);
  if (!name) return;

  saving.add(id); render();
  try {
    const primaryPhoto = photosToSave[0] || null;
    await setDoc(doc(db, "execution_logs", `${state.activeRunId}__${id}`), {
      exp_id: run.exp_id, run_id: state.activeRunId, step_id: id, step_label: f.label,
      executed_by_name: name, input_data: input, input_unit: s.require_input?.unit || "",
      observation_text: s.observation?.enabled ? String(d.observation ?? "").trim() : "",
      explanation_text: s.explanation?.enabled ? String(d.explanation ?? "").trim() : "",
      photos: photosToSave,
      photo_url: primaryPhoto?.url || (primaryPhoto?.file_id ? driveImageUrl(primaryPhoto.file_id) : null),
      photo_file_id: primaryPhoto?.file_id || null,
      timestamp: serverTimestamp(), timestamp_ms: Date.now()
    });
    const filesToDelete = new Set();
    const retainedPhotoIds = new Set(photosToSave.map(photo => photo.file_id).filter(Boolean));
    for (const photo of savedPhotos(old)) {
      if (photo.file_id && !retainedPhotoIds.has(photo.file_id)) filesToDelete.add(photo.file_id);
    }
    for (const photo of d.photoItems || []) {
      if (photo.removed && photo.imgMeta?.file_id) filesToDelete.add(photo.imgMeta.file_id);
    }
    clearDraft(id); editing.delete(id); expanded.delete(id);
    const next = curFlat.find(item => item.sec.id === f.sec.id && item.ti > f.ti && !state.logs[item.step.id] && !hasDraftProgress(item.step.id));
    selectedStepId = next?.step.id || id;
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
    const firstSection = normalizeExperiment(exp).sections[0];
    selectedSectionId = firstSection?.id || null;
    const firstStep = firstSection?.steps.find(step => !state.logs[step.id] && !hasDraftProgress(step.id)) || firstSection?.steps[0];
    selectedStepId = firstStep?.id || null;
    expanded.clear();
    if (firstStep) expanded.add(firstStep.id);
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
        l.observation_text || "", l.explanation_text || "", savedPhotos(l).map(photo => photo.url || photo.file_id).join(" | "), new Date(l.timestamp_ms).toLocaleString("vi-VN")]);
  });
  const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadFile(`${(state.activeRun?.name || "luot").replace(/[^\w\-]+/g, "_")}.csv`, csv, "text/csv;charset=utf-8");
}