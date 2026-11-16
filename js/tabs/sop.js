// ============ Tab Quy trình (SOP & Data Logger) ============
// Chỉ hiển thị thao tác đang chọn; menu Tiến trình hỗ trợ điều hướng trực tiếp.
import { state, on, setActiveRun } from "../store.js";
import { db } from "../firebase.js";
import { doc, collection, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { driveUpload, driveDelete, driveImageUrl, driveFileUrl, isDriveConfigured } from "../drive.js";
import { esc, richHtml, richInline, renderMath, toast, openModal, confirmBox, pickName, statusCard, fmtTime, downloadFile } from "../utils.js";
import { photoLabel, observationWithNotes, secTagSp, computeFlow, resolveBranch, normalizeExperiment, parseNum, END } from "../plan-logic.js";

let root, raf = 0, selectedByUser = false, selectedSectionId = null, selectedStepId = null;
let expOpen = false, sectionOpen = false;   // ẩn/hiện: danh sách TN dưới tiêu đề bài; danh sách bước dưới tiêu đề thí nghiệm
let curExp = null, curFlow = null, curFlat = [];
const drafts = {};              // stepId → {value, blob, preview}
const editing = new Set(), saving = new Set(), uploadingPhoto = new Set();
const openingExperiments = new Set();

export function init(el) {
  root = el;
  ["status", "experiments", "runs", "run", "logs"].forEach(ev => on(ev, schedule));
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  render();
}
export function onShow() { schedule(); }   // giữ nguyên bài/bước đang làm khi chuyển qua lại giữa các tab
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

/* ---------- API cho menu Tiến trình ---------- */
export function isExperimentOpen() { return selectedByUser && !!state.activeRun; }
export function getSelection() { return { sectionId: selectedSectionId, stepId: selectedStepId }; }
export function isStepProgressDone(stepId) { return isProgressDone(stepId); }

export function goToProgress(sectionId = null, stepId = null) {
  if (!curExp) return;
  const section = curExp.sections.find(sec => sec.id === sectionId || sec.steps.some(step => step.id === stepId)) || curExp.sections[0];
  selectedSectionId = section?.id || null;
  const target = stepId
    ? section?.steps.find(step => step.id === stepId)
    : section?.steps.find(step => !isProgressDone(step.id)) || section?.steps[0];
  selectedStepId = target?.id || null;
  render();
  window.dispatchEvent(new CustomEvent("labmana:progress-change"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- vẽ ---------- */
function render() {
  document.body.classList.toggle("sop-open", !!(state.ready && state.activeRunId && selectedByUser));
  if (!state.ready) { root.innerHTML = statusCard(state); return; }
  const focus = captureFocus();

  if (!state.activeRunId || !selectedByUser) { root.innerHTML = startHtml(); return; }
  if (!state.activeRunLoaded || !state.experimentsLoaded) { root.innerHTML = `<div class="empty">Đang tải…</div>`; return; }
  const run = state.activeRun;
  if (!run) { root.innerHTML = `<div class="empty">Không tìm thấy thí nghiệm đang mở.</div>` + startHtml(); return; }
  const raw = state.experiments.find(e => e.id === run.exp_id);
  if (!raw) { root.innerHTML = `<div class="empty">Kế hoạch này đã bị xóa.</div>` + startHtml(); return; }

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
  }
  const sectionDone = sectionFlat.filter(f => isProgressDone(f.step.id)).length;
  const pct = sectionFlat.length ? Math.round(sectionDone / sectionFlat.length * 100) : 0;
  let html = `<div class="sop-head"><button type="button" class="link-btn" data-act="sop-home">Danh sách bài</button></div>
    <h1 class="sop-title"><button type="button" class="acc-btn" data-act="toggle-exp" aria-expanded="${expOpen}">
      <span>${richInline(curExp.title || "Bài thí nghiệm")}</span><span class="chev ${expOpen ? "open" : ""}" aria-hidden="true"></span></button></h1>
    ${expOpen ? sectionTabs() : ""}
    <div class="section-run-head">
      <h2><button type="button" class="acc-btn" data-act="toggle-section" aria-expanded="${sectionOpen}">
        <span>${richInline(selectedSection.section_name) || `Thí nghiệm ${sectionIndex + 1}`}</span><span class="chev ${sectionOpen ? "open" : ""}" aria-hidden="true"></span></button></h2>
      <p class="muted small">${sectionDone}/${sectionFlat.length} bước</p>
      <div class="bar"><span style="width:${pct}%"></span></div>
      ${sectionOpen ? tocStrip(sectionFlat) : ""}
    </div>`;
  if (sectionFlat.length && sectionFlat.every(f => state.logs[f.step.id])) html += `<p class="done-line">Đã hoàn thành thí nghiệm này</p>`;
  if (selectedStep) html += stepView(selectedStep);
  else html += `<div class="empty">Thí nghiệm này chưa có thao tác.</div>`;
  root.innerHTML = html;
  renderMath(root);
  restoreFocus(focus);
}

function sectionTabs() {
  if (!curExp.sections.length) return "";
  return `<nav class="tabs" aria-label="Chọn thí nghiệm">
    ${curExp.sections.map((section, index) => {
      const steps = curFlat.filter(item => item.sec.id === section.id);
      const done = steps.length > 0 && steps.every(item => isProgressDone(item.step.id));
      const active = section.id === selectedSectionId;
      return `<button type="button" class="tab-btn ${active ? "active" : ""} ${done ? "done" : ""}"
        data-act="select-section" data-section="${esc(section.id)}" aria-pressed="${active}">${secTagSp(index)}</button>`;
    }).join("")}
  </nav>`;
}

function tocStrip(steps) {
  return `<nav class="toc-strip" aria-label="Chọn thao tác">${steps.map(f => {
    const st = flowStatus(f.step.id);
    const active = f.step.id === selectedStepId;
    return `<button type="button" class="toc-pip ${st} ${active ? "active" : ""}" data-act="jump" data-step="${f.step.id}" aria-pressed="${active}">${f.label}</button>`;
  }).join("")}</nav>`;
}

function hasDraftProgress(id) {
  const draft = drafts[id];
  if (!draft) return false;
  return ["value", "observation", "explanation"].some(key => String(draft[key] ?? "").trim() !== "");
}

function isProgressDone(id) { return !!state.logs[id] || hasDraftProgress(id) || runDraftPhotos(id).length > 0; }
function savedPhotos(log) {
  if (Array.isArray(log?.photos) && log.photos.length) return log.photos.filter(photo => photo?.file_id || photo?.url);
  return log?.photo_file_id || log?.photo_url
    ? [{ file_id: log.photo_file_id || "", url: log.photo_url || "", name: log.photo_name || "" }]
    : [];
}
/* ---------- Ảnh: lưu cứng lên Firebase ngay sau khi tải Drive ----------
 * Bước đã có bản ghi → ảnh nằm trong execution_logs.photos; chưa lưu bước → nằm tạm trong runs.draft_photos[stepId]
 * (không tạo bản ghi nên không làm bước bị coi là đã xong). Khi bấm Lưu, ảnh được chuyển vào bản ghi. */
const runDraftPhotos = id => (state.activeRun?.draft_photos?.[id] || []).filter(p => p?.file_id || p?.url);
const stepPhotos = id => state.logs[id] ? savedPhotos(state.logs[id]) : runDraftPhotos(id);
const normPhoto = p => ({ file_id: p.file_id || "", url: p.url || "", name: p.name || "", title: String(p.title || "").trim(), note: String(p.note || "").trim(),
  ...(p.storage_fallback ? { storage_fallback: true } : {}) });
async function writePhotos(id, photos) {
  const list = photos.map(normPhoto), first = list[0] || null;
  if (!state.activeRunId) throw new Error("Chưa chọn lượt thực hiện");
  if (state.logs[id]) {
    await updateDoc(doc(db, "execution_logs", `${state.activeRunId}__${id}`), {
      photos: list,
      photo_url: first ? (first.url || (first.file_id ? driveImageUrl(first.file_id) : null)) : null,
      photo_file_id: first?.file_id || null
    });
  } else {
    await updateDoc(doc(db, "runs", state.activeRunId), { [`draft_photos.${id}`]: list.length ? list : deleteField() });
  }
}
function driveLinkHtml(fileId) {
  if (!fileId) return "";
  const url = driveFileUrl(fileId);
  return `<div class="drive-link-row">
    <a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Mở ảnh</a>
    <button type="button" class="link-btn" data-act="copy-drive-link" data-link="${esc(url)}">Sao chép link</button>
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
  const sectionSteps = curFlat.filter(f => f.sec.id === selectedSectionId);
  const sectionDoneCount = sectionSteps.filter(f => isProgressDone(f.step.id)).length;
  const summary = root.querySelector(".section-run-head .muted");
  if (summary) summary.textContent = `${sectionDoneCount}/${sectionSteps.length} bước`;
  const barFill = root.querySelector(".section-run-head .bar>span");
  if (barFill) barFill.style.width = `${sectionSteps.length ? Math.round(sectionDoneCount / sectionSteps.length * 100) : 0}%`;
  root.querySelectorAll(".tab-btn").forEach(tab => {
    const steps = curFlat.filter(f => f.sec.id === tab.dataset.section);
    tab.classList.toggle("done", steps.length > 0 && steps.every(f => isProgressDone(f.step.id)));
  });
  window.dispatchEvent(new CustomEvent("labmana:progress-change"));
}

function startHtml() {
  if (!state.experimentsLoaded) return `<div class="empty">Đang tải…</div>`;
  if (!state.experiments.length) return `<div class="page-head"><h2>Quy trình</h2></div>
    <div class="empty">Chưa có bài thí nghiệm.</div>`;
  return `<div class="page-head"><h2>Quy trình</h2></div>
    <div class="list">${state.experiments.map(raw => {
      const exp = normalizeExperiment(raw);
      return `<button type="button" class="row" data-act="open-experiment" data-exp="${esc(raw.id)}">
        <span class="grow row-title">${esc(exp.title || "(không tên)")}</span><span class="row-end">Mở</span>
      </button>`;
    }).join("")}</div>`;
}

function hintFor(step, raw) {
  if (!step.require_input || step.require_input.type !== "number" || !step.branch_logic.length) return "";
  const v = parseNum(raw);
  if (Number.isNaN(v)) return "";
  const t = resolveBranch(step, { input_data: v });
  if (!t) return "Gợi ý: tiếp tục các bước.";
  if (t === END) return "Gợi ý: kết thúc phần này.";
  const f = curFlat.find(x => x.step.id === t);
  return f ? `Gợi ý: ưu tiên bước ${f.label}.` : "";
}

function stepView(f) {
  const s = f.step, id = s.id, log = state.logs[id];
  const isEdit = editing.has(id);
  const form = !log || isEdit;

  let body = `<div class="step-meta">
      <span class="step-label">Bước ${f.label}</span>
      ${s.assigned_role ? `<span class="step-role">Phụ trách: ${esc(s.assigned_role)}</span>` : ""}
    </div>
    ${s.title ? `<h3 class="step-h">${richInline(s.title)}</h3>` : ""}
    <div class="step-text">${richHtml(s.text)}</div>` +
    (s.images.length ? `<div>${s.images.map(im => {
      const imageUrl = im.file_id ? driveImageUrl(im.file_id) : im.url;
      return `<img class="thumb" src="${esc(imageUrl)}" data-act="zoom" data-src="${esc(imageUrl)}" alt="">`;
    }).join("")}</div>` : "");

  if (log && !isEdit) {
    const target = resolveBranch(s, log);
    const tf = target && target !== END ? curFlat.find(x => x.step.id === target) : null;
    body += `<div class="result-box">
      ${s.require_input ? `<div class="kv"><span>${esc(s.require_input.label || "Giá trị")}</span><b>${esc(log.input_data ?? "")} ${esc(log.input_unit || "")}</b></div>` : ""}
      ${(() => { const obs = observationWithNotes(s.observation?.enabled ? log.observation_text : "", s.observation?.enabled ? savedPhotos(log) : []) || (s.observation?.enabled ? "" : log.observation_text || "");
        return obs ? `<div class="obs-label">${esc(s.observation?.label || "Hiện tượng quan sát thực tế")}</div><div>${richHtml(obs)}</div>` : ""; })()}
      ${log.explanation_text ? `<div class="exp-label">${esc(s.explanation?.label || "Giải thích và PTPƯ minh họa")}</div><div>${richHtml(log.explanation_text)}</div>` : ""}
      <div class="photo-list">${savedPhotos(log).map((photo, i) => photoCardHtml(photo, i, { readonly: true, showNote: !s.observation?.enabled })).join("")}</div>
      ${target ? `<div class="muted small">Rẽ nhánh: ${target === END ? "kết thúc bài" : tf ? "bước " + tf.label : ""}</div>` : ""}
      <div class="by">${esc(log.executed_by_name)} · ${fmtTime(log.timestamp_ms)}</div>
      <div class="btn-row"><button class="btn sm" data-act="edit">Sửa</button><button class="btn sm danger-outline" data-act="delete-log">Xóa kết quả</button></div></div>`;
  }

  if (form) {
    const d = drafts[id] || {};
    const ri = s.require_input;
    const num = ri && ri.type === "number";
    const keptPhotos = stepPhotos(id);
    const newPhotos = d.photoItems || [];
    const isSaving = saving.has(id);
    const isUploading = uploadingPhoto.has(id);
    const pendingUpload = newPhotos.some(photo => !photo.imgMeta && !photo.removed);
    body += `<div class="form">
      ${ri ? `<label class="lbl">${esc(ri.label || "Số liệu")}${ri.unit ? ` (${esc(ri.unit)})` : ""}
        <input class="inp big" data-draft="${id}" data-field="value" type="text" inputmode="${num ? "decimal" : "text"}" autocomplete="off"
          value="${esc(d.value ?? "")}" placeholder="${num ? "Nhập số" : "Nhập"}"></label>
        <div class="hint" id="hint-${id}">${esc(hintFor(s, d.value))}</div>` : ""}

      ${s.observation?.enabled ? `<label class="lbl">${esc(s.observation.label || "Hiện tượng quan sát thực tế")}
        <textarea class="inp" rows="2" data-draft="${id}" data-field="observation" placeholder="Mô tả hiện tượng">${esc(d.observation ?? (isEdit ? log?.observation_text ?? "" : ""))}</textarea></label>` : ""}
      ${s.explanation?.enabled ? `<label class="lbl">${esc(s.explanation.label || "Giải thích và PTPƯ minh họa")}
        <textarea class="inp" rows="2" data-draft="${id}" data-field="explanation" placeholder="Giải thích, PTPƯ: $\\ce{...}$">${esc(d.explanation ?? (isEdit ? log?.explanation_text ?? "" : ""))}</textarea></label>` : ""}

      ${s.observation?.enabled && keptPhotos.some(p => p.note) ? `<div class="obs-notes muted small">Tự thêm vào ô này khi lưu: ${keptPhotos.map((p, i) => (p.note ? esc(photoLabel(p, i)) + ": " + esc(p.note) : "")).filter(Boolean).join(" · ")}</div>` : ""}
      <div class="photo-list">
        ${keptPhotos.map((photo, i) => photoCardHtml(photo, i, { disabled: isSaving || isUploading })).join("")}
        ${newPhotos.map((photo, index) => photo.removed ? "" : `<div class="photo-item pending">
          <img class="thumb" src="${esc(photo.preview)}" alt="ảnh chưa tải lên">
          <div class="photo-cap">${esc(`Ảnh ${keptPhotos.length + newPhotos.slice(0, index).filter(x => !x.removed).length + 1}`)} · chưa tải lên</div>
          <button type="button" class="btn sm primary" data-act="upload-photo" data-photo-index="${index}" ${isSaving || isUploading ? "disabled" : ""}>
            ${isUploading ? '<span class="spin-ring"></span>&nbsp;Đang tải' : "Tải lên Drive"}
          </button>
          <button type="button" class="link-btn danger" data-act="remove-new-photo" data-photo-index="${index}" ${isSaving || isUploading ? "disabled" : ""}>Bỏ ảnh</button>
        </div>`).join("")}
      </div>
      <div class="step-submit-row">
        <label class="btn photo-action">Chụp / thêm ảnh${s.require_photo ? " (bắt buộc)" : ""}
          <input type="file" accept="image/*" capture="environment" multiple hidden data-photo="${id}" ${isSaving || isUploading ? "disabled" : ""}></label>
        <button class="btn primary" data-act="save" ${isSaving || isUploading || pendingUpload ? "disabled" : ""}>${isSaving ? "Đang lưu…" : "Lưu"}</button>
      </div>
      ${pendingUpload ? '<span class="muted small">Tải ảnh lên Drive trước khi lưu (ảnh tải xong được lưu cứng lên Firebase ngay).</span>' : ""}
      ${isEdit ? `<button class="btn cancel-edit" data-act="cancel-edit" ${isSaving || isUploading ? "disabled" : ""}>Hủy sửa</button>` : ""}
      </div>`;
  }

  return `<article class="sopstep" data-step="${id}">${body}</article>`;
}

/** Thẻ ảnh: ảnh (bấm để xem / ghi chú), tên "Ảnh N" hoặc tên đã đặt, ghi chú rút gọn, link Drive, nút xóa. */
function photoCardHtml(photo, i, { readonly = false, showNote = true, disabled = false } = {}) {
  const url = photo.file_id ? driveImageUrl(photo.file_id) : photo.url, key = photoKey(photo);
  return `<div class="photo-item saved-photo">
    <img class="thumb" src="${esc(url)}" data-act="view-photo" data-photo-key="${esc(key)}" alt="${esc(photoLabel(photo, i))}">
    <button type="button" class="photo-cap" data-act="view-photo" data-photo-key="${esc(key)}" title="Bấm để xem, đổi tên, ghi chú">${esc(photoLabel(photo, i))}</button>
    ${showNote && photo.note ? `<div class="photo-note">${esc(photo.note)}</div>` : ""}
    ${photo.file_id ? driveLinkHtml(photo.file_id) : photo.storage_fallback ? '<span class="muted small">Lưu kèm nhật ký</span>' : ""}
    ${readonly ? "" : `<button type="button" class="link-btn danger" data-act="remove-saved-photo" data-photo-key="${esc(key)}" ${disabled ? "disabled" : ""}>Xóa ảnh</button>`}
  </div>`;
}

/** Xem ảnh lớn; đổi tên (xóa tên → quay về "Ảnh N") và thêm ghi chú ngay dưới ảnh, lưu cứng lên Firebase. */
async function openPhotoViewer(id, key) {
  const photos = stepPhotos(id), i = photos.findIndex(p => photoKey(p) === key);
  if (i < 0) return;
  const p = photos[i], url = p.file_id ? driveImageUrl(p.file_id) : p.url, node = document.createElement("div");
  node.innerHTML = `<img class="zoom" src="${esc(url)}" alt="">
    <label class="lbl">Tên ảnh <input class="inp" data-pv="title" maxlength="80" value="${esc(p.title || "")}" placeholder="Ảnh ${i + 1}"></label>
    <label class="lbl">Ghi chú <textarea class="inp" rows="3" data-pv="note" placeholder="Ghi chú cho ảnh (tự thêm vào ô hiện tượng)">${esc(p.note || "")}</textarea></label>`;
  const ok = await openModal({ title: photoLabel(p, i), node, buttons: [{ label: "Đóng", value: false }, { label: "Lưu", kind: "primary", value: true }] });
  if (ok !== true) return;
  const title = node.querySelector("[data-pv=title]").value.trim(), note = node.querySelector("[data-pv=note]").value.trim();
  if (title === (p.title || "") && note === (p.note || "")) return;
  try {
    await writePhotos(id, stepPhotos(id).map(x => photoKey(x) === key ? { ...x, title, note } : x));
    toast("Đã lưu ghi chú ảnh", "success", 1800);
  } catch (err) { console.error(err); toast("Không lưu được ghi chú: " + (err.code || err.message), "error", 4500); }
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
    try { await writePhotos(id, [...stepPhotos(id), img]); }       // lưu cứng lên Firebase ngay
    catch (err) {
      if (img.file_id) { try { await driveDelete(img.file_id); } catch { /* bỏ qua */ } }
      throw new Error("đã tải lên Drive nhưng chưa lưu được lên Firebase (" + (err.code || err.message) + "); ảnh được giữ để thử lại");
    }
    if (photo.preview) URL.revokeObjectURL(photo.preview);
    d.photoItems.splice(d.photoItems.indexOf(photo), 1);
    updateStepProgress(id);
    toast(img.storage_fallback
      ? `Drive chưa xác nhận (${img.error || "không rõ lỗi"}). Ảnh được giữ trong nhật ký để lưu bước.`
      : `Đã tải ảnh ${img.name || "lên Drive"}`, img.storage_fallback ? "warn" : "success", img.storage_fallback ? 12000 : 5000);
  } catch (err) { console.error(err); toast("Tải ảnh lỗi: " + err.message, "error", 4500); }
  finally { uploadingPhoto.delete(id); render(); }
}

async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn || !root.contains(btn)) return;
  const id = btn.closest("[data-step]")?.dataset.step || btn.dataset.step;
  switch (btn.dataset.act) {
    case "save": return save(id);
    case "upload-photo": return uploadPhoto(id, Number(btn.dataset.photoIndex));
    case "copy-drive-link": return copyDriveLink(btn.dataset.link);
    case "jump": {
      selectedStepId = id;
      render();
      window.dispatchEvent(new CustomEvent("labmana:progress-change"));
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    }
    case "edit": {
      const log = state.logs[id];
      editing.add(id);
      drafts[id] = {
        value: log?.input_data != null ? String(log.input_data) : "",
        observation: log?.observation_text || "", explanation: log?.explanation_text || "",
        photoItems: []
      };
      render(); break;
    }
    case "cancel-edit": return cancelEdit(id);
    case "select-section": return goToProgress(btn.dataset.section);
    case "toggle-exp": expOpen = !expOpen; render(); break;
    case "toggle-section": sectionOpen = !sectionOpen; render(); break;
    case "view-photo": return openPhotoViewer(id, btn.dataset.photoKey);
    case "remove-saved-photo": return removeSavedPhoto(id, btn.dataset.photoKey);
    case "delete-log": return deleteLog(id);
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
      render();
      window.dispatchEvent(new CustomEvent("labmana:progress-change"));
      break;
    case "csv": return exportCsv();
  }
}

/** Xóa ảnh: gỡ khỏi Firebase ngay + xóa file trên Drive (lỗi Drive chỉ cảnh báo, không giữ ảnh "ma" trong bản ghi). */
async function removeSavedPhoto(id, key) {
  if (saving.has(id) || uploadingPhoto.has(id)) return;
  const photo = stepPhotos(id).find(p => photoKey(p) === key); if (!photo) return;
  if (!(await confirmBox("Ảnh sẽ bị xóa khỏi bản ghi và khỏi Google Drive. Tiếp tục?", "Xóa ảnh"))) return;
  uploadingPhoto.add(id); render();
  try {
    await writePhotos(id, stepPhotos(id).filter(p => photoKey(p) !== key));
    if (photo.file_id) { try { await driveDelete(photo.file_id); } catch (err) { console.error(err); toast("Đã gỡ ảnh khỏi bản ghi nhưng chưa xóa được file trên Drive.", "warn", 5000); } }
    window.dispatchEvent(new CustomEvent("labmana:progress-change"));
  } catch (err) { console.error(err); toast("Xóa ảnh lỗi: " + (err.code || err.message), "error", 4500); }
  finally { uploadingPhoto.delete(id); render(); }
}

/** Xóa toàn bộ kết quả của bước: bản ghi, số liệu, nội dung và mọi ảnh (cả trên Drive). */
async function deleteLog(id) {
  const log = state.logs[id]; if (!log || saving.has(id)) return;
  if (!(await confirmBox("Xóa toàn bộ kết quả của bước này (số liệu, hiện tượng, giải thích và mọi ảnh)? Không thể hoàn tác.", "Xóa kết quả"))) return;
  saving.add(id); render();
  try {
    const photos = savedPhotos(log);
    await deleteDoc(doc(db, "execution_logs", `${state.activeRunId}__${id}`));
    try { await updateDoc(doc(db, "runs", state.activeRunId), { [`draft_photos.${id}`]: deleteField() }); } catch { /* chưa có thì bỏ qua */ }
    let warn = false;
    for (const p of photos) if (p.file_id) { try { await driveDelete(p.file_id); } catch (err) { console.error(err); warn = true; } }
    editing.delete(id); clearDraft(id);
    toast(warn ? "Đã xóa kết quả, nhưng có ảnh chưa xóa được khỏi Drive." : "Đã xóa kết quả bước", warn ? "warn" : "success", 4000);
    window.dispatchEvent(new CustomEvent("labmana:progress-change"));
  } catch (err) { console.error(err); toast("Xóa thất bại: " + (err.code || err.message), "error", 4500); }
  finally { saving.delete(id); render(); }
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
    toast("Đã sao chép link", "success");
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

function cancelEdit(id) {
  editing.delete(id);
  clearDraft(id);
  render();
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
  const photosToSave = stepPhotos(id).map(normPhoto);
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
    if (state.activeRun?.draft_photos?.[id]) { try { await updateDoc(doc(db, "runs", state.activeRunId), { [`draft_photos.${id}`]: deleteField() }); } catch { /* bỏ qua */ } }
    clearDraft(id); editing.delete(id);
    const next = curFlat.find(item => item.sec.id === f.sec.id && item.ti > f.ti && !state.logs[item.step.id] && !hasDraftProgress(item.step.id));
    selectedStepId = next?.step.id || id;
    toast("Đã lưu", "success", 5000);
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
  const csv = "﻿" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadFile(`${(state.activeRun?.name || "luot").replace(/[^\w\-]+/g, "_")}.csv`, csv, "text/csv;charset=utf-8");
}
