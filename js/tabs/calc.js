// ============ Tab Pha chế — trình hướng dẫn pha chế từng bước + quy đổi đơn vị ============
import { esc, renderMath, toast } from "../utils.js";
import {
  CHEMS, KIND_LABEL, EQ_HINTS, UNITS, UNIT_ORDER, MASS_UNITS,
  fieldPlan, computeMix, computeConvert, safetyItems, fmt
} from "../chem-logic.js";

/*
 * Luồng pha chế (mỗi bước chỉ hiện đúng thứ cần cho lựa chọn trước đó):
 *   1 Hóa chất → 2 Cách pha → 3 Thông số → 4 Kết quả & thao tác
 * Chế độ Quy đổi: nhập một nồng độ → xem ngay mọi đơn vị còn lại.
 * Mọi phép tính nằm trong chem-logic.js (thuần, đã kiểm thử).
 */

const POPULAR = ["hcl", "h2so4", "hno3", "naoh", "nh3", "ch3cooh", "nacl", "kmno4"];
const STEPS = [["1", "Hóa chất"], ["2", "Cách pha"], ["3", "Thông số"], ["4", "Kết quả"]];
const NEED_SHORT = { mw: "nhập M (g/mol)", n: "nhập n", d: "nhập d" };

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/đ/g, "d").replace(/[₀-₉]/g, c => String(SUB.indexOf(c))).replace(/[^a-z0-9]/g, "");
// Gõ kiểu tiếng Việt quen thuộc (sunfat, sunphat, clorua…) vẫn khớp tên trong danh sách
const alias = t => t.replace(/sunfat|sunphat|sulphat|sulfat/g, "sulfat").replace(/hidroxit|hydroxit|hidroxid/g, "hydroxide").replace(/cacbonat|cacbonate|carbonat/g, "carbonate").replace(/nitrat/g, "nitrate");
const matches = (id, q) => {
  const tokens = String(q).trim().split(/\s+/).map(t => alias(norm(t))).filter(Boolean);
  return tokens.every(t => SEARCH_ALIASED[id].includes(t));
};
const SEARCH = Object.fromEntries(Object.entries(CHEMS).map(([id, x]) => [id, norm(`${x.formula} ${x.name} ${id} ${KIND_LABEL[x.kind]}`)]));
const SEARCH_ALIASED = Object.fromEntries(Object.entries(SEARCH).map(([id, t]) => [id, alias(t)]));

const S = {
  mode: "mix", step: 1, chem: null, method: null,
  stockUnit: "M", targetUnit: "M",
  v: {}, scale: { vol: "mL", mass: "g" }, q: "",
  conv: { from: "M", chem: null, pick: false, v: { value: "", mw: "", d: "", n: "" } }
};
let root;

export function init(el) {
  root = el;
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (b && !b.disabled) act(b.dataset.act, b.dataset.val);
  });
  root.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "bt-search") {
      S.q = t.value;
      const box = root.querySelector("#bt-chemlist-wrap");
      if (box) box.innerHTML = chemListHtml(S.mode === "conv" ? "convChem" : "pickChem", S.q);
    } else if (t.dataset.v !== undefined) { S.v[t.dataset.v] = t.value; refreshLive(); }
    else if (t.dataset.c !== undefined) { S.conv.v[t.dataset.c] = t.value; refreshConv(); }
  });
  root.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.sc) { S.scale[t.dataset.sc] = t.value; refreshLive(); }
  });
  root.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches?.("[data-v]")) {
      const nb = root.querySelector("#bt-next");
      if (nb && !nb.disabled) nb.click();
    }
  });
  render({ top: true });
}
export function onShow() {}

/** Tóm tắt thông số đang nhập trong tab Pha chế (để tab AI đính kèm làm ngữ cảnh). Trả về "" nếu chưa chọn hóa chất. */
export function getContextText() {
  const x = CHEMS[S.chem];
  if (!x) return "";
  const lines = [`Hóa chất: ${x.formula || ""} ${x.name}`.trim()];
  if (S.method) lines.push(S.method === "solid" ? "Cách pha: cân chất rắn rồi hòa tan" : "Cách pha: pha loãng từ dung dịch gốc");
  const v = S.v || {};
  if (S.method === "dilute" && v.stock) lines.push(`Nồng độ gốc: ${v.stock} (${UNITS[S.stockUnit]?.unit || S.stockUnit})${v.density ? `, d = ${v.density} g/mL` : ""}`);
  if (S.method === "solid" && v.purity) lines.push(`Độ tinh khiết: ${v.purity}%`);
  if (v.target) lines.push(`Nồng độ cần pha: ${v.target} (${UNITS[S.targetUnit]?.unit || S.targetUnit})`);
  if (v.amount) lines.push(`Lượng dung dịch cuối: ${v.amount} ${MASS_UNITS.has(S.targetUnit) ? S.scale.mass : S.scale.vol}`);
  if (v.mw) lines.push(`M = ${v.mw} g/mol`);
  if (v.n) lines.push(`n = ${v.n} eq/mol`);
  try {
    const r = S.method ? computeMix(mixInput()) : null;
    if (r?.status === "ok") {
      lines.push(`Kết quả tính: ${r.hero.label} = ${r.hero.value} (${r.hero.sub})`);
      (r.warns || []).forEach(w => lines.push(`Cảnh báo: ${w}`));
    }
  } catch { /* bỏ qua nếu chưa đủ dữ liệu */ }
  return lines.join("\n");
}

/* ------------------------------ Hành động ------------------------------ */
function act(a, val) {
  const x = CHEMS[S.chem];
  switch (a) {
    case "mode": S.mode = val; S.q = ""; render({ top: true }); break;
    case "goStep": S.step = +val; render({ top: true }); break;
    case "pickChem": pickChem(val); break;
    case "pickMethod":
      S.method = val;
      if (val === "dilute" && x?.state === "solid") { S.stockUnit = "M"; S.v.stock = ""; }
      S.step = 3; render({ top: true }); break;
    case "stockUnit":
      S.stockUnit = val;
      S.v.stock = val === "ww" && x?.assay ? String(x.assay) : "";
      if (val === "ww" && x?.density && !S.v.density) S.v.density = String(x.density);
      render(); break;
    case "targetUnit": {
      const was = MASS_UNITS.has(S.targetUnit), now = MASS_UNITS.has(val);
      S.targetUnit = val; S.v.target = "";
      if (was !== now) S.v.amount = "";
      render(); break;
    }
    case "nHint": S.v.n = val; render(); break;
    case "next": S.step = 4; render({ top: true }); break;
    case "back": S.step = x?.state === "liquid" ? 1 : 2; render({ top: true }); break;
    case "reset":
      Object.assign(S, { step: 1, chem: null, method: null, stockUnit: "M", targetUnit: "M", v: {}, q: "", scale: { vol: "mL", mass: "g" } });
      render({ top: true }); break;
    case "convUnit": S.conv.from = val; S.conv.v.value = ""; render(); break;
    case "convPick": S.conv.pick = !S.conv.pick; S.q = ""; render(); break;
    case "convChem": {
      const c = CHEMS[val];
      S.conv.chem = val; S.conv.pick = false; S.q = "";
      S.conv.v.mw = c.mw ? String(c.mw) : "";
      render(); break;
    }
    case "convPreset": {
      const c = CHEMS[S.conv.chem];
      if (c?.assay) { S.conv.from = "ww"; S.conv.v.value = String(c.assay); S.conv.v.d = String(c.density); }
      render(); break;
    }
    case "stage": toggleStage(); break;
    case "copy":
      try { navigator.clipboard?.writeText(val).then(() => toast(`Đã sao chép ${val}`, "success", 1400)).catch(() => {}); } catch { /* ignore */ }
      break;
  }
}

function pickChem(id) {
  const x = CHEMS[id];
  S.chem = id; S.q = "";
  S.v = { mw: x.mw ? String(x.mw) : "", purity: x.purity ? String(x.purity) : "" };
  if (x.state === "liquid") {            // Chất lỏng chỉ pha loãng → bỏ qua bước 2
    S.method = "dilute"; S.stockUnit = "ww";
    S.v.stock = String(x.assay); S.v.density = String(x.density);
    S.step = 3;
  } else {
    S.method = null; S.stockUnit = "M"; S.step = 2;
  }
  render({ top: true });
}

/* ------------------------------ Dựng giao diện ------------------------------ */
const mixInput = () => ({
  chem: S.chem, method: S.method, stockUnit: S.stockUnit, targetUnit: S.targetUnit, v: S.v, scale: S.scale
});

function render({ top = false } = {}) {
  destroyStage();
  const st = root.scrollTop;
  root.innerHTML = `<div class="bt">${modesHtml()}${S.mode === "mix" ? mixHtml() : convHtml()}</div>`;
  root.scrollTop = top ? 0 : st;
  if (top) window.scrollTo(0, 0);
  if (S.mode === "mix" && S.step === 3) refreshLive();
  if (S.mode === "conv") refreshConv();
  renderMath(root);
}

const modesHtml = () => `<div class="bt-modes" role="tablist">
  <button type="button" role="tab" class="${S.mode === "mix" ? "on" : ""}" data-act="mode" data-val="mix">Pha chế</button>
  <button type="button" role="tab" class="${S.mode === "conv" ? "on" : ""}" data-act="mode" data-val="conv">Quy đổi đơn vị</button></div>`;

/* ---------- Chọn hóa chất (dùng chung cho Pha chế và Quy đổi) ---------- */
function chemListHtml(actName, q) {
  const qn = norm(q);
  let ids = Object.keys(CHEMS).filter(id => !qn || matches(id, q));
  if (!ids.length) ids = ["custom"];
  const cur = actName === "convChem" ? S.conv.chem : S.chem;
  const row = id => {
    const x = CHEMS[id];
    return `<button type="button" class="bt-chem ${id === cur ? "on" : ""}" data-act="${actName}" data-val="${id}">
      <span class="bt-chem-f">${esc(x.formula || "Khác")}</span>
      <span class="bt-chem-n">${esc(x.name)}<small>${x.state === "liquid" ? "dung dịch / lỏng" : "chất rắn"}</small></span>
      <span class="bt-tag ${x.kind}">${KIND_LABEL[x.kind]}</span></button>`;
  };
  const quick = !qn ? `<div class="bt-sub">Hay dùng</div><div class="bt-quick">${POPULAR.map(id =>
    `<button type="button" class="bt-qchip" data-act="${actName}" data-val="${id}">${esc(CHEMS[id].formula)}</button>`).join("")}</div>
    <div class="bt-sub">Tất cả</div>` : "";
  return `${quick}<div class="bt-chemlist">${ids.map(row).join("")}</div>`;
}
const searchHtml = actName => `<input class="inp" id="bt-search" type="search" autocomplete="off" placeholder="Tên hoặc công thức: H2SO4, NaOH…" value="${esc(S.q)}">
  <div id="bt-chemlist-wrap">${chemListHtml(actName, S.q)}</div>`;

/* ---------- Chế độ Pha chế ---------- */
function maxStep() {
  if (!S.chem) return 1;
  if (!S.method) return 2;
  return computeMix(mixInput()).status === "ok" ? 4 : 3;
}
function stepperHtml() {
  // Chỉ hiện bước đang làm; ở Bước 4/4 có nút Play đỏ mở mô phỏng 3D thao tác pha chế
  const play = S.step === 4 ? `<button type="button" class="lab3d-play" data-act="stage" aria-expanded="false" aria-label="Xem mô phỏng 3D thao tác pha chế" title="Xem mô phỏng 3D"><span aria-hidden="true">▶</span></button>` : "";
  return `<div class="bt-progress"><span>Bước ${S.step}/${STEPS.length}</span><b>${STEPS[S.step - 1][1]}</b>${play}</div>`;
}
function summaryHtml() {
  const x = CHEMS[S.chem];
  if (!x || S.step < 2) return "";
  return `<div class="bt-sum"><button type="button" class="bt-sumchip" data-act="goStep" data-val="1"><b>${esc(x.formula || "?")}</b> ${esc(x.name)} <i>Sửa</i></button>${
    S.method && S.step >= 3 ? `<button type="button" class="bt-sumchip" data-act="goStep" data-val="2">${S.method === "solid" ? "Cân chất rắn" : "Pha loãng"} <i>Sửa</i></button>` : ""}</div>`;
}

function mixHtml() {
  // Đảm bảo bước hiện tại hợp lệ với dữ liệu đã chọn
  S.step = Math.min(S.step, maxStep());
  const body = S.step === 1 ? step1() : S.step === 2 ? step2() : S.step === 3 ? step3() : step4();
  return `${stepperHtml()}${summaryHtml()}<div class="bt-panel">${body}</div>`;
}

const step1 = () => `<h4 class="bt-q">Hóa chất cần pha</h4>${searchHtml("pickChem")}`;

function step2() {
  const liquid = CHEMS[S.chem].state === "liquid";
  return `<h4 class="bt-q">Cách pha</h4>
    <button type="button" class="bt-opt ${S.method === "dilute" ? "on" : ""}" data-act="pickMethod" data-val="dilute"><b>Pha loãng từ dung dịch gốc</b></button>
    <button type="button" class="bt-opt ${S.method === "solid" ? "on" : ""}" ${liquid ? "disabled" : ""} data-act="pickMethod" data-val="solid"><b>Cân chất rắn rồi hòa tan</b>${liquid ? "<small>Hóa chất này ở dạng lỏng.</small>" : ""}</button>`;
}

const unitChips = (actName, cur) => `<div class="bt-units">${UNIT_ORDER.map(u =>
  `<button type="button" class="bt-unit ${u === cur ? "on" : ""}" data-act="${actName}" data-val="${u}"><b>${UNITS[u].sym}</b><small>${UNITS[u].unit}</small></button>`).join("")}</div>`;

const fld = (key, label, suffix, ph, hint = "", attr = "data-v") => `<label class="lbl">${label}
  <div class="inp-unit"><input class="inp" ${attr}="${key}" inputmode="decimal" autocomplete="off" placeholder="${esc(ph)}" value="${esc((attr === "data-v" ? S.v[key] : S.conv.v[key]) ?? "")}">${suffix}</div>
  ${hint ? `<span class="bt-hint">${hint}</span>` : ""}</label>`;
const unitSpan = u => `<span class="unit">${esc(u)}</span>`;
const scaleSel = (key, opts) => `<select class="bt-scale" data-sc="${key}" aria-label="Đơn vị">${opts.map(o => `<option ${S.scale[key] === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;

function step3() {
  const x = CHEMS[S.chem], plan = fieldPlan(mixInput()), solid = S.method === "solid";
  const tMass = MASS_UNITS.has(S.targetUnit);
  const hints = (EQ_HINTS[S.chem] || []).map(([n, note]) =>
    `<button type="button" class="bt-nhint" data-act="nHint" data-val="${n}">n = ${n}<small>${esc(note)}</small></button>`).join("");

  const blockA = solid
    ? `<div class="bt-block"><div class="bt-bh">Chất rắn</div>
        ${fld("purity", "Độ tinh khiết", unitSpan("%"), "VD: 98")}</div>`
    : `<div class="bt-block"><div class="bt-bh">Dung dịch gốc</div>
        ${unitChips("stockUnit", S.stockUnit)}
        ${fld("stock", "Nồng độ gốc", unitSpan(UNITS[S.stockUnit].unit), "VD: 98")}
        ${plan.showD ? fld("density", "Khối lượng riêng", unitSpan("g/mL"), "VD: 1,84",
          plan.dRequired ? "Bắt buộc" : "Không bắt buộc") : ""}
        ${x.assay ? '<p class="bt-note">Giá trị điền sẵn là tham khảo, đối chiếu nhãn chai.</p>' : ""}</div>`;

  const blockB = `<div class="bt-block"><div class="bt-bh">Dung dịch cần pha</div>
      ${unitChips("targetUnit", S.targetUnit)}
      ${fld("target", "Nồng độ cần pha", unitSpan(UNITS[S.targetUnit].unit), "VD: 0,1")}
      ${fld("amount", tMass ? "Khối lượng dung dịch cuối" : "Thể tích dung dịch cuối",
        tMass ? scaleSel("mass", ["g", "kg"]) : scaleSel("vol", ["mL", "L"]), tMass ? "VD: 100" : "VD: 250")}</div>`;

  const blockC = plan.showMw || plan.showN ? `<div class="bt-block"><div class="bt-bh">Thông số hóa chất</div>
      ${plan.showMw ? fld("mw", "Khối lượng mol M", unitSpan("g/mol"), "VD: 98,079",
        x.formula.includes("·") ? "Đã gồm nước kết tinh" : "") : ""}
      ${plan.showN ? fld("n", "Hệ số đương lượng n", unitSpan("eq/mol"), "VD: 2") : ""}
      ${plan.showN && hints ? `<div class="bt-nhints">${hints}</div>` : ""}</div>` : "";

  return `<h4 class="bt-q">Thông số</h4>${blockA}${blockB}${blockC}
    <div id="bt-live" class="bt-live"></div>
    <div class="bt-nav"><button type="button" class="btn" data-act="back">Quay lại</button>
      <button type="button" class="btn primary" id="bt-next" data-act="next" disabled>Xem kết quả</button></div>`;
}

function liveHtml(r) {
  if (r.status === "ok") return `<div class="bt-live-ok"><span>${esc(r.hero.label)}</span><b>${esc(r.hero.value)}</b></div>`;
  return `<div class="bt-live-msg ${r.status}">${esc(r.msg)}</div>`;
}
function refreshLive() {
  const live = root.querySelector("#bt-live");
  if (!live) return;
  const r = computeMix(mixInput());
  live.innerHTML = liveHtml(r);
  const nb = root.querySelector("#bt-next");
  if (nb) nb.disabled = r.status !== "ok";
}

function step4() {
  const r = computeMix(mixInput());
  const items = safetyItems(S.chem);
  return `<div id="bt-stage" class="lab3d-wrap" hidden></div>
    <div class="bt-hero"><div class="bt-hero-k">${esc(r.hero.label)}</div>
      <div class="bt-hero-v">${esc(r.hero.value)}</div><div class="bt-hero-s">${esc(r.hero.sub)}</div></div>
    ${r.warns.map(w => `<div class="bt-warn">${esc(w)}</div>`).join("")}
    <div class="bt-rows">${r.rows.map(([k, v]) => `<div class="bt-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
    ${r.equiv.length ? `<div class="bt-equiv"><span>Dung dịch đích tương đương</span>${r.equiv.map(e => `<i>${esc(e)}</i>`).join("")}</div>` : ""}
    <h4 class="bt-q">Thao tác</h4>
    <ol class="bt-steps">${r.steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
    <p class="bt-basis"><b>Cơ sở tính:</b> ${esc(r.basis)}</p>
    <div class="safety"><h3>An toàn — ${esc(CHEMS[S.chem].formula || CHEMS[S.chem].name)}</h3><ul>${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>
    <div class="bt-nav"><button type="button" class="btn" data-act="goStep" data-val="3">Sửa thông số</button>
      <button type="button" class="btn primary" data-act="reset">Pha dung dịch khác</button></div>`;
}

/* ---------- Mô phỏng 3D (js/lab-animator.js, nạp khi bấm Play) ---------- */
let stage = null;
function destroyStage() { if (stage) { try { stage.handle.destroy(); } catch { /* ignore */ } stage = null; } }
async function toggleStage() {
  const wrap = root.querySelector("#bt-stage"), btn = root.querySelector(".lab3d-play");
  if (!wrap || !btn) return;
  const g = window.gsap;
  if (stage) { // đóng: trượt gọn rồi giải phóng WebGL
    const done = () => { destroyStage(); wrap.hidden = true; wrap.style.height = ""; };
    btn.classList.remove("on"); btn.setAttribute("aria-expanded", "false");
    if (g) g.to(wrap, { height: 0, opacity: 0, duration: .35, ease: "power2.inOut", onComplete: done }); else done();
    return;
  }
  const r = computeMix(mixInput());
  if (r.status !== "ok" || !r.anim) return;
  btn.classList.add("on"); btn.setAttribute("aria-expanded", "true");
  wrap.hidden = false;
  try {
    const mod = await import("../lab-animator.js");
    stage = { handle: mod.mount(wrap, r.anim) };
    if (g) g.fromTo(wrap, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: .45, ease: "power2.out" });
  } catch (e) {
    wrap.hidden = true; btn.classList.remove("on"); btn.setAttribute("aria-expanded", "false");
    toast("Không tải được mô phỏng 3D", "error", 2200);
  }
}

/* ---------- Chế độ Quy đổi ---------- */
function convHtml() {
  const x = CHEMS[S.conv.chem], c = S.conv;
  return `<div class="bt-block"><div class="bt-bh">Hóa chất</div>
      <button type="button" class="bt-pill" data-act="convPick">${x ? `<b>${esc(x.formula || "—")}</b> ${esc(x.name)}` : "Chưa chọn"}<i>${c.pick ? "Đóng" : "Đổi"}</i></button>
      ${c.pick ? searchHtml("convChem") : ""}
      ${x?.assay && !c.pick ? `<button type="button" class="bt-link" data-act="convPreset">Điền thông số nhãn (${x.assay}% w/w, d = ${x.density})</button>` : ""}</div>
    <div class="bt-block"><div class="bt-bh">Nồng độ đang có</div>
      ${unitChips("convUnit", c.from)}
      ${fld("value", "Giá trị", unitSpan(UNITS[c.from].unit), "VD: 98", "", "data-c")}</div>
    <div class="bt-block"><div class="bt-bh">Thông số bổ sung</div>
      <div class="bt-grid3">
        ${fld("mw", "M (g/mol)", "", "", "", "data-c")}
        ${fld("d", "d (g/mL)", "", "", "", "data-c")}
        ${fld("n", "n (eq/mol)", "", "", "", "data-c")}
      </div></div>
    <div class="bt-block"><div class="bt-bh">Kết quả</div>
      <div id="bt-conv-msg"></div><div id="bt-tiles" class="bt-tiles"></div>
      <p class="bt-note">Chạm vào ô để sao chép.</p></div>`;
}

function refreshConv() {
  const tilesEl = root.querySelector("#bt-tiles"), msgEl = root.querySelector("#bt-conv-msg");
  if (!tilesEl) return;
  const cv = S.conv.v;
  const r = computeConvert({ from: S.conv.from, value: cv.value, mw: cv.mw, d: cv.d, n: cv.n });
  msgEl.innerHTML = r.status === "ok" ? "" : `<div class="bt-live-msg ${r.status}">${esc(r.msg)}</div>`;
  const tiles = r.status === "ok" ? r.tiles : UNIT_ORDER.map(u => ({ unit: u, value: null, empty: true }));
  tilesEl.innerHTML = tiles.map(t => {
    const u = UNITS[t.unit];
    let body, copy = "";
    if (t.value != null) { copy = fmt(t.value, 5); body = `<b>${copy}</b>`; }
    else if (t.need) body = `<em>${NEED_SHORT[t.need]}</em>`;
    else if (t.err) body = `<em class="e">${esc(t.err)}</em>`;
    else body = `<b class="bt-dash">—</b>`;
    return `<button type="button" class="bt-tile ${t.src ? "src" : ""} ${t.value == null ? "na" : ""}" ${copy ? `data-act="copy" data-val="${esc(copy)}"` : "disabled"}>
      <span class="bt-tile-k">${u.sym}${t.src ? " · đang có" : ""}</span>${body}<small>${u.unit}</small></button>`;
  }).join("");
}
