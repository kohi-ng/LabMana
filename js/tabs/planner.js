// ============ Tab Kế hoạch (Planner / Tree-builder) ============
// Khung soạn bài DÙNG CHUNG cho mọi bài trong giáo trình: một Bài gồm nhiều
// "Thí nghiệm" (section), mỗi Thí nghiệm gồm nhiều "Thao tác" (step, vd a/b/c…).
// Mỗi thao tác khi soạn có thể bật/tắt 2 cột ghi nhận đúng mẫu báo cáo:
// "Hiện tượng quan sát thực tế" và "Giải thích và PTPƯ minh họa".
import { state, on } from "../store.js";
import { db } from "../firebase.js";
import { doc, collection, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { driveUpload, driveDelete, driveImageUrl, driveFileUrl, isDriveConfigured } from "../drive.js";
import { esc, uid, snippet, richHtml, renderMath, toast, openModal, confirmBox, statusCard, downloadFile, $$ } from "../utils.js";
import { OPS, OP_LABELS, END, newStep, newSection, newExperiment, normalizeExperiment, serializeExperiment, validatePlan, flatten } from "../plan-logic.js";
import { openAICompose } from "../ai-compose.js";

let root, view = "list", exp = null, expId = null, dirty = false;
const openSteps = new Set(), previewSteps = new Set(), errSteps = new Set();
const uploadingImgs = new Set(); // step ids đang upload ảnh (khóa UI của ảnh đó)
const pendingDriveDeletes = new Set(), newlyUploadedDriveFiles = new Set(), failedDriveDeletes = new Set();
const aiUndoSnapshots = new Map(); // stepId → nội dung trước khi áp dụng AI, chỉ tồn tại trong phiên

const SPECIALS = ["°C", "±", "×", "→", "⇌", "Δ", "µ", "²", "³", "⁻", "₂", "₃"];
const SNIPPETS = [
  { l: "Hóa học", t: "$\\ce{}$", b: 2 },
  { l: "Phân số", t: "$\\frac{a}{b}$", b: 0 },
  { l: "C_M", t: "$C_{M}$", b: 0 }
];
const INPUT_FIELDS = new Set(["title", "description", "section_name", "step_title", "text", "input_label", "input_unit", "rule-value", "obs_label", "exp_label"]);
const CHANGE_FIELDS = new Set(["assigned_role", "req_input", "input_type", "req_photo", "rule-op", "rule-goto", "obs_enabled", "exp_enabled"]);

export function init(el) {
  root = el;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  on("experiments", () => { if (view === "list") render(); });
  on("config", () => { if (view === "editor") render(); });
  on("status", render);
  window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  render();
}
export function onShow() { render(); }

const clone = o => JSON.parse(JSON.stringify(o));

function render() {
  if (!state.ready) { root.innerHTML = statusCard(state); return; }
  view === "list" ? renderList() : renderEditor();
}

/* ---------- Danh sách ---------- */
function renderList() {
  const items = state.experiments;
  root.innerHTML = `
    <div class="page-head"><h2>Kế hoạch</h2></div>
    <div class="btn-row">
      <button class="btn primary" data-act="new">Bài mới</button>
      <button class="btn" data-act="import">Nhập JSON</button>
      <input type="file" id="pl-import" accept="application/json,.json" hidden>
    </div>
    ${!isDriveConfigured ? `<p class="muted small">Chưa cấu hình Google Drive: ảnh chưa tải lên được.</p>` : ""}
    ${items.length ? `<div class="list">${items.map(card).join("")}</div>` : `<div class="empty">Chưa có bài thí nghiệm.</div>`}`;
}
function card(e) {
  const n = normalizeExperiment(e);
  const steps = n.sections.reduce((a, s) => a + s.steps.length, 0);
  return `<div class="row" data-id="${esc(e.id)}" style="display:block">
    <div class="row-title">${esc(n.title || "(không tên)")}</div>
    <div class="row-meta">${n.sections.length} thí nghiệm · ${steps} thao tác</div>
    <div class="row-actions">
      <button class="link-btn" data-act="open">Mở</button>
      <button class="link-btn" data-act="dup">Nhân bản</button>
      <button class="link-btn danger" data-act="del">Xóa</button>
    </div></div>`;
}

/* ---------- Trình soạn thảo ---------- */
function renderEditor() {
  const flat = flatten(exp);
  root.innerHTML = `
    <div class="sticky-bar">
      <button class="link-btn" data-act="back">Danh sách</button>
      <span class="dirty ${dirty ? "" : "hidden"}">Chưa lưu</span>
      <span class="spacer"></span>
      <button class="link-btn" data-act="export">Xuất JSON</button>
      <button class="btn sm primary" data-act="save">Lưu</button>
    </div>
    <div>
      <label class="lbl">Tên bài<input class="inp" data-f="title" value="${esc(exp.title)}" placeholder="VD: Bài 1 — Phân nhóm IIA, IIIA"></label>
      <label class="lbl">Mô tả<textarea class="inp" rows="2" data-f="description">${esc(exp.description)}</textarea></label>
    </div>
    ${exp.sections.map((s, i) => sectionHtml(s, i, flat)).join("")}
    <button class="btn block" data-act="add-sec" style="margin-top:18px">Thêm thí nghiệm</button>`;
  $$("[data-preview]", root).forEach(el => {
    const f = findStep(el.dataset.preview);
    if (f) { el.innerHTML = richHtml(f.step.text) || '<span class="muted">(trống)</span>'; renderMath(el); }
  });
  renderMath(root);
}

function sectionHtml(sec, si, flat) {
  return `<section class="sec-block" data-sec="${sec.id}">
    <div class="sec-head"><span class="sec-no">TN ${si + 1}</span>
      <input class="inp" data-f="section_name" value="${esc(sec.section_name)}" placeholder="Tên thí nghiệm">
    </div>
    <div class="sec-tools">
      <button class="link-btn muted" data-act="move-sec" data-dir="-1">Lên</button>
      <button class="link-btn muted" data-act="move-sec" data-dir="1">Xuống</button>
      <button class="link-btn danger" data-act="del-sec">Xóa thí nghiệm</button>
    </div>
    <div class="steps">${sec.steps.map((st, ti) => stepHtml(st, `${si + 1}.${ti + 1}`, flat)).join("")}</div>
    <button class="btn block" data-act="add-step">Thêm thao tác</button>
  </section>`;
}

function stepHtml(s, label, flat) {
  const open = openSteps.has(s.id);
  const tags = [
    s.assigned_role ? esc(s.assigned_role) : "",
    s.require_input ? "Số liệu" : "",
    s.require_photo ? "Ảnh" : "",
    s.branch_logic.length ? "Rẽ nhánh" : ""
  ].filter(Boolean).join(" · ");
  return `<article class="step ${errSteps.has(s.id) ? "err" : ""}" data-step="${s.id}">
    <div class="step-head" data-act="toggle-step">
      <span class="step-no">${label}</span>
      <input class="step-title-field" data-f="step_title" value="${esc(s.title)}" placeholder="Tiêu đề (tùy chọn)" aria-label="Tiêu đề thao tác ${label}">
      <span class="row-end">${open ? "Thu gọn" : "Mở"}</span></div>
    ${tags && !open ? `<div class="step-tags" style="margin:-6px 0 8px 3em">${tags}</div>` : ""}
    ${open ? stepBody(s, flat) : ""}</article>`;
}

function stepBody(s, flat) {
  const ri = s.require_input;
  const roleOpts = [`<option value="">Cả nhóm</option>`]
    .concat(state.team.map(r => `<option value="${esc(r)}" ${s.assigned_role === r ? "selected" : ""}>${esc(r)}</option>`));
  if (s.assigned_role && !state.team.includes(s.assigned_role))
    roleOpts.push(`<option value="${esc(s.assigned_role)}" selected>${esc(s.assigned_role)} (không còn trong cài đặt)</option>`);
  return `<div class="step-body">
    <label class="lbl">Các bước tiến hành
      <div class="toolbar">
        ${SPECIALS.map(c => `<button type="button" data-act="ins" data-ins="${esc(c)}" data-back="0">${esc(c)}</button>`).join("")}
        ${SNIPPETS.map(x => `<button type="button" data-act="ins" data-ins="${esc(x.t)}" data-back="${x.b}">${esc(x.l)}</button>`).join("")}
        <button type="button" data-act="table">Bảng</button>
        <button type="button" class="ai-compose-trigger" data-act="ai-compose">✦ AI Compose</button>
        ${aiUndoSnapshots.has(s.id) ? `<button type="button" class="ai-undo-trigger" data-act="undo-ai">Hoàn tác</button>` : ""}
      </div>
      <textarea class="inp" rows="4" data-f="text" placeholder="Hướng dẫn thao tác. Công thức: $x^2$, hóa học: $\\ce{H2SO4}$">${esc(s.text)}</textarea>
    </label>
    <button class="link-btn" style="margin-left:-8px" data-act="toggle-preview">${previewSteps.has(s.id) ? "Ẩn xem trước" : "Xem trước"}</button>
    ${previewSteps.has(s.id) ? `<div class="preview" data-preview="${s.id}"></div>` : ""}

    <div class="lbl-t">Ảnh minh họa</div>
    ${imagesHtml(s)}
    <label class="btn sm">Thêm ảnh<input type="file" accept="image/*" multiple hidden data-f="add_img" ${uploadingImgs.has(s.id) ? "disabled" : ""}></label>

    <div class="lbl-t">Ghi nhận khi thực hiện</div>
    ${fieldToggleRow("obs", s.observation, "Hiện tượng quan sát thực tế")}
    ${fieldToggleRow("exp", s.explanation, "Giải thích và PTPƯ minh họa")}

    <label class="lbl">Giao cho
      <select class="inp" data-f="assigned_role">${roleOpts.join("")}</select>
    </label>

    <label class="check"><input type="checkbox" data-f="req_input" ${ri ? "checked" : ""}> Nhập số liệu</label>
    ${ri ? `<div class="sub">
      <div class="grid2">
        <label class="lbl">Tên đại lượng<input class="inp" data-f="input_label" value="${esc(ri.label)}" placeholder="VD: V NaOH tiêu tốn"></label>
        <label class="lbl">Đơn vị<input class="inp" data-f="input_unit" value="${esc(ri.unit)}" placeholder="mL"></label>
      </div>
      <label class="lbl">Kiểu dữ liệu<select class="inp" data-f="input_type">
        <option value="number" ${ri.type === "number" ? "selected" : ""}>Số (cho phép rẽ nhánh)</option>
        <option value="text" ${ri.type === "text" ? "selected" : ""}>Văn bản</option></select></label>
      ${ri.type === "number" ? branchHtml(s, flat) : ""}
    </div>` : ""}
    <label class="check"><input type="checkbox" data-f="req_photo" ${s.require_photo ? "checked" : ""}> Bắt buộc chụp ảnh</label>

    <div class="step-actions">
      <button class="link-btn muted" data-act="move-step" data-dir="-1">Lên</button>
      <button class="link-btn muted" data-act="move-step" data-dir="1">Xuống</button>
      <button class="link-btn" data-act="dup-step">Nhân bản</button>
      <button class="link-btn danger" data-act="del-step">Xóa thao tác</button>
    </div></div>`;
}

function fieldToggleRow(prefix, field, dflt) {
  return `<div class="field-toggle-row">
    <input type="checkbox" data-f="${prefix}_enabled" ${field?.enabled ? "checked" : ""}>
    <input class="inp sm" style="flex:1" data-f="${prefix}_label" value="${esc(field?.label || dflt)}" ${field?.enabled ? "" : "disabled"} placeholder="${esc(dflt)}">
  </div>`;
}

function imagesHtml(s) {
  const uploading = uploadingImgs.has(s.id);
  return `<div class="imgs">
    ${s.images.map((im, i) => `<div class="img-item">
      <div class="img"><img src="${esc(im.file_id ? driveImageUrl(im.file_id) : im.url)}" alt="" loading="lazy"></div>
      ${im.file_id ? `<a class="img-link" href="${esc(driveFileUrl(im.file_id))}" target="_blank" rel="noopener noreferrer">Mở trên Drive</a>` : ""}
      <button class="link-btn danger" style="padding:0;min-height:36px" data-act="del-img" data-i="${i}">Xóa ảnh</button>
    </div>`).join("")}
    ${uploading ? `<div class="img uploading"><img src="" alt=""><div class="spin"><div class="spin-ring dark"></div></div></div>` : ""}
  </div>`;
}

function gotoOptions(stepId, selected, flat) {
  const idx = flat.findIndex(f => f.step.id === stepId);
  const later = flat.slice(idx + 1);
  let html = `<option value="">Chọn bước đích</option>`;
  later.forEach(f => {
    html += `<option value="${f.step.id}" ${selected === f.step.id ? "selected" : ""}>Bước ${f.label} — ${esc(snippet(f.step.text, 30))}</option>`;
  });
  html += `<option value="${END}" ${selected === END ? "selected" : ""}>Kết thúc bài</option>`;
  if (selected && selected !== END && !later.some(f => f.step.id === selected))
    html += `<option value="${esc(selected)}" selected>(bước không còn hợp lệ)</option>`;
  return html;
}

function branchHtml(s, flat) {
  const rules = s.branch_logic.map((r, i) => `<div class="rule" data-rule="${i}">
    <div class="rule-line"><span>Nếu giá trị</span>
      <select class="inp sm" data-f="rule-op">${Object.keys(OPS).map(o => `<option value="${o}" ${r.op === o ? "selected" : ""}>${OP_LABELS[o]}</option>`).join("")}</select>
      <input class="inp sm" data-f="rule-value" inputmode="decimal" placeholder="X" value="${esc(r.value)}"></div>
    <div class="rule-line"><span>thì nhảy tới</span>
      <select class="inp sm grow" data-f="rule-goto">${gotoOptions(s.id, r.goto_step_id, flat)}</select>
      <button class="link-btn danger" data-act="del-rule" data-i="${i}">Xóa</button></div></div>`).join("");
  return `<div class="branch"><div class="lbl-t" style="margin-top:4px">Rẽ nhánh</div>
    ${rules}
    <button class="btn sm" data-act="add-rule">Thêm điều kiện</button></div>`;
}

/* ---------- Tiện ích dữ liệu ---------- */
function findStep(id) {
  for (const sec of exp.sections) {
    const i = sec.steps.findIndex(s => s.id === id);
    if (i >= 0) return { sec, step: sec.steps[i], i };
  }
  return null;
}
function markDirty() { dirty = true; root.querySelector(".dirty")?.classList.remove("hidden"); }

function moveStep(secId, stepId, dir) {
  const si = exp.sections.findIndex(s => s.id === secId);
  const sec = exp.sections[si];
  const i = sec.steps.findIndex(s => s.id === stepId);
  const j = i + dir;
  if (j >= 0 && j < sec.steps.length) [sec.steps[i], sec.steps[j]] = [sec.steps[j], sec.steps[i]];
  else {
    const t = si + dir;
    if (t < 0 || t >= exp.sections.length) return;
    const [st] = sec.steps.splice(i, 1);
    dir > 0 ? exp.sections[t].steps.unshift(st) : exp.sections[t].steps.push(st);
  }
}

function insertText(stepId, text, back = 0) {
  const ta = root.querySelector(`[data-step="${stepId}"] textarea[data-f="text"]`);
  if (!ta) return;
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  const pos = s + text.length - back;
  ta.focus(); ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

async function createTable(stepId) {
  const node = document.createElement("div");
  node.innerHTML = `<div class="grid2">
    <label class="lbl">Số dòng dữ liệu<input class="inp" id="table-rows" type="number" min="1" max="20" value="3"></label>
    <label class="lbl">Số cột<input class="inp" id="table-cols" type="number" min="2" max="8" value="2"></label>
  </div>`;
  const dimensions = await openModal({
    title: "Tạo bảng",
    node,
    buttons: [
      { label: "Hủy", value: null },
      {
        label: "Chèn bảng", kind: "primary",
        value: () => ({ rows: Number(node.querySelector("#table-rows").value), cols: Number(node.querySelector("#table-cols").value) }),
        validate: () => {
          const rows = Number(node.querySelector("#table-rows").value);
          const cols = Number(node.querySelector("#table-cols").value);
          if (!Number.isInteger(rows) || rows < 1 || rows > 20 || !Number.isInteger(cols) || cols < 2 || cols > 8) {
            toast("Bảng cần 1–20 dòng dữ liệu và 2–8 cột.", "warn");
            return false;
          }
          return true;
        }
      }
    ]
  });
  if (!dimensions) return;
  const header = `| ${Array.from({ length: dimensions.cols }, (_, i) => `Cột ${i + 1}`).join(" | ")} |`;
  const separator = `| ${Array(dimensions.cols).fill("---").join(" | ")} |`;
  const row = `| ${Array(dimensions.cols).fill("").join(" | ")} |`;
  insertText(stepId, `\n${header}\n${separator}\n${Array(dimensions.rows).fill(row).join("\n")}\n`);
}

/* ---------- Sự kiện ---------- */
function applyField(t) {
  const f = t.dataset.f;
  const stepEl = t.closest("[data-step]"), secEl = t.closest("[data-sec]");
  const found = stepEl ? findStep(stepEl.dataset.step) : null;
  const step = found?.step;
  const sec = secEl ? exp.sections.find(s => s.id === secEl.dataset.sec) : null;
  const ruleIdx = t.closest("[data-rule]")?.dataset.rule;
  const rule = step && ruleIdx !== undefined ? step.branch_logic[+ruleIdx] : null;
  let rerender = false;
  switch (f) {
    case "title": exp.title = t.value; break;
    case "description": exp.description = t.value; break;
    case "section_name": if (sec) sec.section_name = t.value; break;
    case "step_title":
      if (!step) return;
      step.title = t.value;
      break;
    case "text":
      if (!step) return;
      step.text = t.value;
      if (previewSteps.has(step.id)) {
        const p = stepEl.querySelector("[data-preview]");
        if (p) { p.innerHTML = richHtml(step.text) || '<span class="muted">(trống)</span>'; renderMath(p); }
      }
      break;
    case "assigned_role": if (step) { step.assigned_role = t.value; rerender = true; } break;
    case "obs_enabled": if (step) { step.observation.enabled = t.checked; rerender = true; } break;
    case "exp_enabled": if (step) { step.explanation.enabled = t.checked; rerender = true; } break;
    case "obs_label": if (step) step.observation.label = t.value; break;
    case "exp_label": if (step) step.explanation.label = t.value; break;
    case "req_input":
      if (!step) return;
      step.require_input = t.checked ? { label: "", unit: "", type: "number" } : null;
      if (!t.checked) step.branch_logic = [];
      rerender = true; break;
    case "input_label": if (step?.require_input) step.require_input.label = t.value; break;
    case "input_unit": if (step?.require_input) step.require_input.unit = t.value; break;
    case "input_type":
      if (step?.require_input) { step.require_input.type = t.value; if (t.value === "text") step.branch_logic = []; rerender = true; }
      break;
    case "req_photo": if (step) { step.require_photo = t.checked; rerender = true; } break;
    case "rule-op": if (rule) rule.op = t.value; break;
    case "rule-value": if (rule) rule.value = t.value; break;
    case "rule-goto": if (rule) rule.goto_step_id = t.value; break;
    default: return;
  }
  markDirty();
  if (rerender) render();
}

function onInput(e) { const f = e.target.dataset?.f; if (f && INPUT_FIELDS.has(f)) applyField(e.target); }

async function onChange(e) {
  const t = e.target, f = t.dataset?.f;
  if (t.id === "pl-import") return importJson(t);
  if (f === "add_img") {
    const files = Array.from(t.files || []); t.value = "";
    const sid = t.closest("[data-step]")?.dataset.step;
    if (files.length && sid) await addImages(sid, files);
    return;
  }
  if (f && CHANGE_FIELDS.has(f)) applyField(t);
}

async function addImages(stepId, files) {
  if (!isDriveConfigured) return toast("Chưa cấu hình Google Drive — xem hướng dẫn triển khai trong code.gs", "error", 4000);
  const found = findStep(stepId);
  if (!found) return;
  uploadingImgs.add(stepId); render();
  const failures = [];
  try {
    const meta = { expTitle: exp.title || "Bai-chua-ten", sectionName: found.sec.section_name || "Phan" };
    for (const [index, file] of files.entries()) {
      try {
        toast(`Đang tải ảnh lên Drive… (${index + 1}/${files.length})`);
        const img = await driveUpload(file, "plan", meta);
        found.step.images.push(img);
        if (img.file_id) newlyUploadedDriveFiles.add(img.file_id);
        markDirty();
        render();
      } catch (err) {
        console.error(err);
        failures.push(`${file.name}: ${err.message}`);
      }
    }
    if (failures.length) {
      toast(`Đã tải ${files.length - failures.length}/${files.length} ảnh. Lỗi: ${failures.join("; ")}`, "error", 7000);
    } else {
      toast(`Đã tải ${files.length} ảnh lên Drive`, "success");
    }
  } finally { uploadingImgs.delete(stepId); render(); }
}

async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn || !root.contains(btn)) return;
  if (btn.dataset.act === "toggle-step" && e.target.closest("input, textarea, select")) return;
  const act = btn.dataset.act;
  const stepEl = btn.closest("[data-step]"), secEl = btn.closest("[data-sec]");
  const sid = stepEl?.dataset.step, secId = secEl?.dataset.sec;
  const card = btn.closest("[data-id]");

  switch (act) {
    /* danh sách */
    case "new": exp = newExperiment(); expId = null; dirty = true; openSteps.clear(); previewSteps.clear(); errSteps.clear();
      openSteps.add(exp.sections[0].steps[0].id); view = "editor"; render(); break;
    case "import": root.querySelector("#pl-import").click(); break;
    case "open": {
      const raw = state.experiments.find(x => x.id === card.dataset.id); if (!raw) return;
      exp = normalizeExperiment(clone(raw)); expId = raw.id; exp.created_at_ms = raw.created_at_ms || null;
      dirty = false; openSteps.clear(); previewSteps.clear(); errSteps.clear(); view = "editor"; render(); break;
    }
    case "dup": {
      const raw = state.experiments.find(x => x.id === card.dataset.id); if (!raw) return;
      const copy = serializeExperiment(normalizeExperiment(clone(raw)));
      copy.title += " (bản sao)"; copy.created_at_ms = copy.updated_at_ms = Date.now();
      try { await setDoc(doc(collection(db, "experiments")), copy); toast("Đã nhân bản", "success"); } catch (err) { toast("Lỗi: " + (err.code || err.message), "error"); }
      break;
    }
    case "del":
      if (await confirmBox("Xóa bài thí nghiệm này? Các lượt thực hành đã tạo từ bài này sẽ không mở được nữa.", "Xóa")) {
        try { await deleteDoc(doc(db, "experiments", card.dataset.id)); toast("Đã xóa", "success"); } catch (err) { toast("Lỗi: " + (err.code || err.message), "error"); }
      }
      break;

    /* thanh công cụ */
    case "back":
      if (dirty && !(await confirmBox("Có thay đổi chưa lưu. Thoát và bỏ thay đổi?", "Bỏ thay đổi"))) return;
      await discardPendingPlanImages();
      dirty = false; pendingDriveDeletes.clear(); view = "list"; render(); break;
    case "save": await save(); break;
    case "export": downloadFile((exp.title || "bai-thi-nghiem").replace(/[^\w\-]+/g, "_") + ".json", JSON.stringify(serializeExperiment(exp), null, 2), "application/json"); break;

    /* thí nghiệm (section) */
    case "add-sec": { const s = newSection(`Thí nghiệm ${exp.sections.length + 1}`); exp.sections.push(s); openSteps.add(s.steps[0].id); markDirty(); render(); break; }
    case "del-sec":
      if (await confirmBox("Xóa cả thí nghiệm này và mọi thao tác bên trong?", "Xóa")) { exp.sections = exp.sections.filter(s => s.id !== secId); markDirty(); render(); }
      break;
    case "move-sec": {
      const i = exp.sections.findIndex(s => s.id === secId), j = i + +btn.dataset.dir;
      if (j < 0 || j >= exp.sections.length) return;
      [exp.sections[i], exp.sections[j]] = [exp.sections[j], exp.sections[i]]; markDirty(); render(); break;
    }

    /* thao tác (step) */
    case "add-step": { const sec = exp.sections.find(s => s.id === secId); const st = newStep(); sec.steps.push(st); openSteps.add(st.id); markDirty(); render(); break; }
    case "toggle-step": openSteps.has(sid) ? openSteps.delete(sid) : openSteps.add(sid); render(); break;
    case "toggle-preview": previewSteps.has(sid) ? previewSteps.delete(sid) : previewSteps.add(sid); render(); break;
    case "move-step": moveStep(secId, sid, +btn.dataset.dir); markDirty(); render(); break;
    case "dup-step": {
      const f = findStep(sid); const c = clone(f.step); c.id = uid("s"); c.branch_logic = c.branch_logic || [];
      f.sec.steps.splice(f.i + 1, 0, c); openSteps.add(c.id); markDirty(); render(); break;
    }
    case "del-step": {
      const f = findStep(sid);
      if (f.step.text.trim() && !(await confirmBox("Xóa thao tác này?", "Xóa"))) return;
      f.sec.steps.splice(f.i, 1); markDirty(); render(); break;
    }
    case "ins": insertText(sid, btn.dataset.ins, +btn.dataset.back || 0); break;
    case "table": await createTable(sid); break;
    case "ai-compose": {
      const ta = stepEl?.querySelector('textarea[data-f="text"]');
      if (!ta) return;
      await openAICompose({
        experiment: exp, stepId: sid, textarea: ta,
        onApply: nextText => {
          aiUndoSnapshots.set(sid, ta.value);
          ta.value = nextText;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          render();
        }
      });
      break;
    }
    case "undo-ai": {
      if (!aiUndoSnapshots.has(sid)) return;
      const previous = aiUndoSnapshots.get(sid);
      aiUndoSnapshots.delete(sid);
      const f = findStep(sid);
      if (f) f.step.text = previous;
      markDirty();
      render();
      break;
    }
    case "del-img": {
      const f = findStep(sid);
      const img = f.step.images[+btn.dataset.i];
      f.step.images.splice(+btn.dataset.i, 1); markDirty(); render();
      if (img?.file_id) {
        if (!newlyUploadedDriveFiles.has(img.file_id)) pendingDriveDeletes.add(img.file_id);
      }
      break;
    }
    case "add-rule": findStep(sid).step.branch_logic.push({ op: "<", value: "", goto_step_id: "" }); markDirty(); render(); break;
    case "del-rule": findStep(sid).step.branch_logic.splice(+btn.dataset.i, 1); markDirty(); render(); break;
  }
}

async function save() {
  const errs = validatePlan(exp);
  if (errs.length) {
    errSteps.clear();
    errs.forEach(x => { if (x.stepId) { errSteps.add(x.stepId); openSteps.add(x.stepId); } });
    render();
    await openModal({ title: `Có ${errs.length} lỗi cần sửa`, html: `<ul class="errs">${errs.map(x => `<li>${esc(x.msg)}</li>`).join("")}</ul>` });
    return;
  }
  errSteps.clear();
  const data = serializeExperiment(exp);
  data.updated_at_ms = Date.now();
  data.created_at_ms = exp.created_at_ms || Date.now();
  const ref = expId ? doc(db, "experiments", expId) : doc(collection(db, "experiments"));
  try {
    await setDoc(ref, data);
    expId = ref.id; exp.created_at_ms = data.created_at_ms; dirty = false;
    let deleteWarning = false;
    const filesToDelete = new Set([...pendingDriveDeletes, ...failedDriveDeletes]);
    pendingDriveDeletes.clear();
    for (const fileId of newlyUploadedDriveFiles) {
      if (isImageReferenced(fileId)) {
        newlyUploadedDriveFiles.delete(fileId);
        continue;
      }
      filesToDelete.add(fileId);
    }
    for (const fileId of filesToDelete) {
      if (isImageReferenced(fileId)) {
        failedDriveDeletes.delete(fileId);
        newlyUploadedDriveFiles.delete(fileId);
        continue;
      }
      try {
        await driveDelete(fileId);
        failedDriveDeletes.delete(fileId);
        newlyUploadedDriveFiles.delete(fileId);
      } catch (err) {
        console.error(err);
        failedDriveDeletes.add(fileId);
        newlyUploadedDriveFiles.delete(fileId);
        deleteWarning = true;
      }
    }
    render();
    toast(deleteWarning ? "Đã lưu kế hoạch, nhưng có ảnh chưa xóa được khỏi Drive." : "Đã lưu kế hoạch",
      deleteWarning ? "warn" : "success", 5000);
  } catch (err) { console.error(err); toast("Lưu thất bại: " + (err.code || err.message), "error", 4500); }
}

function isImageReferenced(fileId) {
  const inCurrent = exp.sections.some(section => section.steps.some(step => step.images.some(image => image.file_id === fileId)));
  if (inCurrent) return true;
  return state.experiments.some(raw => raw.id !== expId &&
    normalizeExperiment(raw).sections.some(section => section.steps.some(step => step.images.some(image => image.file_id === fileId))));
}

async function discardPendingPlanImages() {
  let deleteWarning = false;
  for (const fileId of newlyUploadedDriveFiles) {
    try { await driveDelete(fileId); }
    catch (err) {
      console.error(err);
      failedDriveDeletes.add(fileId);
      deleteWarning = true;
    }
  }
  newlyUploadedDriveFiles.clear();
  if (deleteWarning) toast("Đã bỏ thay đổi, nhưng có ảnh mới chưa xóa được khỏi Drive.", "warn", 5000);
}

function importJson(input) {
  const file = input.files?.[0]; input.value = "";
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (!Array.isArray(data.sections)) throw new Error("Thiếu mảng sections");
      exp = normalizeExperiment(data); expId = null; dirty = true;
      openSteps.clear(); previewSteps.clear(); errSteps.clear(); view = "editor"; render();
      toast("Đã nhập — kiểm tra rồi bấm Lưu", "success");
    } catch (err) { toast("File JSON không hợp lệ: " + err.message, "error", 4500); }
  };
  rd.readAsText(file);
}