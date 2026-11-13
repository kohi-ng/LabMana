// ============ Tab 3: Trạm Pha Chế (ChemCalc) — chạy hoàn toàn ngoại tuyến ============
import { esc, renderMath } from "../utils.js";
import { parseNum } from "../plan-logic.js";

// Giá trị tham khảo — LUÔN đối chiếu % và d trên nhãn chai thực tế.
const CHEMS = {
  hcl:     { name: "HCl",        M: 36.46, d: 1.19, P: 37,   kind: "acid" },
  h2so4:   { name: "H₂SO₄",      M: 98.08, d: 1.84, P: 98,   kind: "acid" },
  hno3:    { name: "HNO₃",       M: 63.01, d: 1.39, P: 65,   kind: "acid" },
  ch3cooh: { name: "CH₃COOH băng", M: 60.05, d: 1.05, P: 99.8, kind: "acid" },
  nh3:     { name: "NH₃ (dd)",   M: 17.03, d: 0.91, P: 25,   kind: "base" },
  naoh:    { name: "NaOH (rắn)", M: 40.00, d: null, P: 98,   kind: "base", solid: true },
  custom:  { name: "Khác (tự nhập)", M: "", d: "", P: "", kind: "none" }
};

const MODES = {
  dilute: "Pha loãng C₁V₁=C₂V₂",
  conc:   "Từ dd đặc (d, P%)",
  solid:  "Từ chất rắn",
  mass:   "Theo % khối lượng"
};

const SAFETY = {
  general: [
    "Đeo kính bảo hộ, găng tay, áo blouse; thao tác trong tủ hút khi có hơi/khí.",
    "Dán nhãn bình pha (tên, nồng độ, ngày pha, người pha).",
    "Đối chiếu % và d trên nhãn chai thực tế — giá trị mặc định chỉ để tham khảo.",
    "Dính da/mắt: rửa nhiều nước ≥ 15 phút và báo ngay giảng viên."
  ],
  acid: ["⚠️ Tuyệt đối rót từ từ ACID vào NƯỚC, vừa rót vừa khuấy — KHÔNG làm ngược lại."],
  h2so4: [
    "H₂SO₄ đặc tỏa nhiệt rất mạnh: dùng cốc/bình chịu nhiệt, ngâm trong chậu nước lạnh, để nguội rồi mới định mức.",
    "Rót axit theo thành cốc, từng ít một."
  ],
  hcl: ["HCl đặc bốc khói, hơi ăn mòn: mở nắp và pha trong tủ hút."],
  hno3: ["HNO₃ đặc oxy hóa mạnh, sinh khí NO₂ độc: pha trong tủ hút, tránh xa chất hữu cơ/dễ cháy."],
  ch3cooh: ["Axit axetic băng: hơi ăn mòn, dễ cháy — tránh nguồn lửa, làm trong tủ hút."],
  nh3: ["Amoniac đặc: hơi gây ngạt/kích ứng — mở nắp trong tủ hút, giữ lạnh chai trước khi mở."],
  naoh: [
    "⚠️ Cho từ từ NaOH vào NƯỚC, khuấy nhẹ — không đổ nước vào NaOH; hòa tan tỏa nhiệt mạnh.",
    "Kiềm gây bỏng da/mắt và rất trơn; NaOH hút ẩm, hút CO₂: cân nhanh, đậy kín."
  ]
};

let root, mode = "dilute", chem = "hcl";
const vals = {};

export function init(el) {
  root = el;
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-mode]");
    if (b) { mode = b.dataset.mode; fixChem(); render(); }
  });
  root.addEventListener("change", e => {
    if (e.target.id === "cc-chem") { chem = e.target.value; ["d", "p", "m"].forEach(k => delete vals[k]); render(); }
  });
  root.addEventListener("input", compute);
  render();
}
export function onShow() { /* không cần */ }

function chemList() {
  return Object.entries(CHEMS).filter(([k, c]) => {
    if (mode === "conc") return !c.solid;
    if (mode === "solid") return k === "naoh" || k === "custom";
    return true;
  });
}
function fixChem() { if (!chemList().some(([k]) => k === chem)) { chem = chemList()[0][0]; ["d", "p", "m"].forEach(k => delete vals[k]); } }

const preset = k => {
  const c = CHEMS[chem];
  return { d: c.d ?? "", p: c.P, m: c.M }[k] ?? "";
};
const v = (k, dflt = "") => esc(vals[k] ?? (["d", "p", "m"].includes(k) ? preset(k) : dflt));

const fld = (k, label, unit, ph = "") => `<label class="lbl">${label}
  <div class="inp-unit"><input class="inp" data-k="${k}" inputmode="decimal" autocomplete="off" value="${v(k)}" placeholder="${ph}"><span class="unit">${unit}</span></div></label>`;

function formHtml() {
  switch (mode) {
    case "dilute": return `<div class="formula">$C_1 V_1 = C_2 V_2$</div>
      <p class="muted small">Để trống đúng <b>1 ô</b> cần tính. Nồng độ cùng đơn vị, thể tích cùng đơn vị.</p>
      <div class="grid2">${fld("c1", "C gốc (C₁)", "", "vd 12")}${fld("v1", "V gốc (V₁)", "", "")}</div>
      <div class="grid2">${fld("c2", "C đích (C₂)", "", "vd 0.1")}${fld("v2", "V đích (V₂)", "", "vd 500")}</div>`;
    case "conc": return `<div class="formula">$C_M = \\dfrac{10\\, d\\, P}{M}$ &nbsp; ; &nbsp; $V_{gốc} = \\dfrac{C\\,V}{C_M}$</div>
      <div class="grid2">${fld("d", "Khối lượng riêng d", "g/mL")}${fld("p", "Nồng độ P", "%")}</div>
      ${fld("m", "Khối lượng mol M", "g/mol")}
      <div class="grid2">${fld("c", "C cần pha", "mol/L", "vd 0.1")}${fld("v", "V cần pha", "mL", "vd 500")}</div>`;
    case "solid": return `<div class="formula">$m = \\dfrac{C\\,V}{1000}\\cdot M \\cdot \\dfrac{100}{P}$</div>
      <div class="grid2">${fld("m", "Khối lượng mol M", "g/mol")}${fld("p", "Độ tinh khiết P", "%")}</div>
      <div class="grid2">${fld("c", "C cần pha", "mol/L", "vd 0.1")}${fld("v", "V cần pha", "mL", "vd 500")}</div>`;
    case "mass": return `<div class="formula">$m_1 P_1 = m_2 P_2$</div>
      <div class="grid2">${fld("p1", "P% dd gốc (P₁)", "%", "vd 37")}${fld("p2", "P% cần pha (P₂)", "%", "vd 10")}</div>
      <div class="grid2">${fld("m2", "Khối lượng dd cần pha (m₂)", "g", "vd 200")}${fld("d1", "d dd gốc (tùy chọn)", "g/mL", "vd 1.19")}</div>`;
  }
  return "";
}

function render() {
  root.innerHTML = `
    <div class="page-head"><h2>Trạm pha chế</h2><p class="muted small">Máy tính pha dung dịch + cảnh báo an toàn tự động. Dùng được khi không có mạng.</p></div>
    <div class="seg">${Object.entries(MODES).map(([k, n]) => `<button data-mode="${k}" class="${k === mode ? "active" : ""}">${n}</button>`).join("")}</div>
    <div class="card">
      <label class="lbl">Hóa chất<select class="inp" id="cc-chem">${chemList().map(([k, c]) => `<option value="${k}" ${k === chem ? "selected" : ""}>${c.name}</option>`).join("")}</select></label>
      ${formHtml()}
    </div>
    <div id="cc-result"></div>
    <div id="cc-safety"></div>`;
  renderMath(root);
  compute();
}

const fmt = x => { const n = Number(x.toPrecision(4)); return String(n); };
const rows = list => `<div class="result">${list.map(([l, val, u]) => `<div class="res-row"><span>${l}</span><b>${fmt(val)} ${u}</b></div>`).join("")}</div>`;
const msg = (t, k = "info") => `<div class="result ${k}">${t}</div>`;

function compute(e) {
  root.querySelectorAll("[data-k]").forEach(i => { vals[i.dataset.k] = i.value; });
  const out = root.querySelector("#cc-result");
  if (!out) return;
  out.innerHTML = solve();
  root.querySelector("#cc-safety").innerHTML = safetyHtml();
}

function solve() {
  const raw = k => String(vals[k] ?? (["d", "p", "m"].includes(k) ? preset(k) : "")).trim();
  const num = k => parseNum(raw(k));
  const need = keys => keys.filter(k => raw(k) === "");
  const bad = keys => keys.filter(k => raw(k) !== "" && !(num(k) > 0));

  if (mode === "dilute") {
    const keys = ["c1", "v1", "c2", "v2"];
    const b = bad(keys); if (b.length) return msg("Các giá trị nhập phải là số dương.", "error");
    const blank = need(keys);
    if (blank.length !== 1) return msg("Để trống đúng 1 ô cần tính (C₁, V₁, C₂ hoặc V₂).");
    let [c1, v1, c2, v2] = keys.map(num);
    const t = blank[0];
    if (t === "c1") c1 = c2 * v2 / v1;
    if (t === "v1") v1 = c2 * v2 / c1;
    if (t === "c2") c2 = c1 * v1 / v2;
    if (t === "v2") v2 = c1 * v1 / c2;
    if (c2 > c1 * (1 + 1e-9)) return msg("C đích lớn hơn C gốc — không thể pha loãng.", "error");
    if (v1 > v2 * (1 + 1e-9)) return msg("V gốc lớn hơn V đích — kiểm tra lại số liệu.", "error");
    return rows([["C gốc (C₁)", c1, ""], ["V gốc cần lấy (V₁)", v1, ""], ["C đích (C₂)", c2, ""], ["V đích (V₂)", v2, ""], ["Lượng nước/dung môi thêm vào", v2 - v1, ""]]) +
      msg("Cách pha: lấy V₁ dung dịch gốc, thêm nước/dung môi đến đủ V₂ (định mức).");
  }

  if (mode === "conc") {
    const keys = ["d", "p", "m", "c", "v"];
    if (need(keys).length) return msg("Nhập đủ d, P%, M, C cần pha và V cần pha.");
    if (bad(keys).length) return msg("Các giá trị nhập phải là số dương.", "error");
    const [d, p, m, c, vol] = keys.map(num);
    if (p > 100) return msg("P% không thể lớn hơn 100.", "error");
    const cm = 10 * d * p / m;
    if (c > cm) return msg(`C cần pha (${fmt(c)} M) lớn hơn nồng độ dung dịch gốc (${fmt(cm)} M).`, "error");
    const vs = c * vol / cm;
    return rows([["Nồng độ dd gốc C_M", cm, "mol/L"], ["Thể tích dd gốc cần lấy", vs, "mL"], ["Khối lượng dd gốc tương ứng", vs * d, "g"], ["Nước thêm (gần đúng)", vol - vs, "mL"]]) +
      msg("Cho ~½ lượng nước vào bình định mức trước, rót từ từ dd đặc vào, để nguội rồi thêm nước đến vạch. Thể tích không cộng tính tuyệt đối nên luôn định mức đến vạch.");
  }

  if (mode === "solid") {
    const keys = ["m", "p", "c", "v"];
    if (need(keys).length) return msg("Nhập đủ M, độ tinh khiết P%, C và V cần pha.");
    if (bad(keys).length) return msg("Các giá trị nhập phải là số dương.", "error");
    const [m, p, c, vol] = keys.map(num);
    if (p > 100) return msg("P% không thể lớn hơn 100.", "error");
    const mol = c * vol / 1000;
    return rows([["Số mol cần có", mol, "mol"], ["Khối lượng chất rắn cần cân", mol * m * 100 / p, "g"]]) +
      msg("Hòa tan hoàn toàn trong lượng nước nhỏ, để nguội, chuyển vào bình định mức rồi thêm nước đến vạch.");
  }

  if (mode === "mass") {
    const keys = ["p1", "p2", "m2"];
    if (need(keys).length) return msg("Nhập đủ P₁, P₂ và m₂.");
    if (bad(keys).length || bad(["d1"]).length) return msg("Các giá trị nhập phải là số dương.", "error");
    const [p1, p2, m2] = keys.map(num);
    if (p1 > 100 || p2 > 100) return msg("P% không thể lớn hơn 100.", "error");
    if (p2 > p1) return msg("P₂ lớn hơn P₁ — không thể pha loãng.", "error");
    const m1 = m2 * p2 / p1;
    const list = [["Khối lượng dd gốc cần lấy (m₁)", m1, "g"], ["Khối lượng nước thêm", m2 - m1, "g"]];
    if (raw("d1") !== "") list.push(["Thể tích dd gốc (m₁/d₁)", m1 / num("d1"), "mL"]);
    return rows(list);
  }
  return "";
}

function safetyHtml() {
  const c = CHEMS[chem];
  const items = [];
  if (c.kind === "acid") SAFETY.acid.forEach(t => items.push([t, true]));
  (SAFETY[chem] || []).forEach(t => items.push([t, t.startsWith("⚠️")]));
  SAFETY.general.forEach(t => items.push([t, false]));
  return `<div class="safety"><h3>⚠️ An toàn khi pha ${esc(c.name)}</h3><ul>${items.map(([t, s]) => `<li class="${s ? "strong" : ""}">${esc(t)}</li>`).join("")}</ul></div>`;
}