// ============ LabMana ChemCalc — Bộ tính pha chế thống nhất, offline ============
import { esc, renderMath } from "../utils.js";
import { parseNum } from "../plan-logic.js";
 
/*
 * Quy ước:
 * - M: mol/L; N: eq/L (cần hệ số đương lượng n do người dùng xác định).
 * - % w/w: g chất tan / 100 g dung dịch.
 * - % w/v: g chất tan / 100 mL dung dịch.
 * - Không suy diễn % v/v hoặc molality khi thiếu dữ liệu vật lý cần thiết.
 * - Khối lượng riêng của dung dịch đậm đặc chỉ là giá trị tham khảo, phải thay
 *   bằng số liệu trên nhãn/SDS ở nhiệt độ phù hợp.
 */
const CHEMS = {
  hcl:       { name:"Axit clohidric", formula:"HCl", mw:36.4609, density:1.19, assay:37, state:"liquid", kind:"acid", refs:"Dung dịch đậm đặc tham khảo: 37% w/w; d≈1,19 g/mL." },
  h2so4:     { name:"Axit sulfuric", formula:"H₂SO₄", mw:98.079, density:1.84, assay:98, state:"liquid", kind:"acid", refs:"Dung dịch đậm đặc tham khảo: 98% w/w; d≈1,84 g/mL." },
  hno3:      { name:"Axit nitric", formula:"HNO₃", mw:63.012, density:1.39, assay:65, state:"liquid", kind:"oxidizer", refs:"Dung dịch đậm đặc tham khảo: 65% w/w; d≈1,39 g/mL." },
  ch3cooh:   { name:"Axit axetic băng", formula:"CH₃COOH", mw:60.052, density:1.049, assay:99.8, state:"liquid", kind:"acid", refs:"Axit axetic băng tham khảo: 99,8% w/w; d≈1,049 g/mL." },
  nh3:       { name:"Amoniac", formula:"NH₃", mw:17.031, density:0.91, assay:25, state:"liquid", kind:"base", refs:"Dung dịch amoniac tham khảo: 25% w/w; d≈0,91 g/mL." },
  naoh:      { name:"Natri hydroxide", formula:"NaOH", mw:39.997, purity:98, state:"solid", kind:"base" },
  koh:       { name:"Kali hydroxide", formula:"KOH", mw:56.106, purity:85, state:"solid", kind:"base", refs:"KOH hút ẩm và hấp thụ CO₂; độ tinh khiết phải theo nhãn." },
  nacl:      { name:"Natri clorua", formula:"NaCl", mw:58.443, purity:99.5, state:"solid", kind:"salt" },
  kcl:       { name:"Kali clorua", formula:"KCl", mw:74.551, purity:99.5, state:"solid", kind:"salt" },
  mgcl2:     { name:"Magie clorua khan", formula:"MgCl₂", mw:95.211, purity:98, state:"solid", kind:"salt" },
  cacl2:     { name:"Canxi clorua khan", formula:"CaCl₂", mw:110.98, purity:96, state:"solid", kind:"salt", refs:"CaCl₂ hút ẩm mạnh; nếu dùng dạng ngậm nước phải chọn đúng công thức." },
  bacl2_2h2o:{ name:"Bari clorua dihydrate", formula:"BaCl₂·2H₂O", mw:244.263, purity:99, state:"solid", kind:"toxic", refs:"Muối bari độc; tránh phát tán bụi và thu gom chất thải riêng." },
  al2so4_18: { name:"Nhôm sulfate octadecahydrate", formula:"Al₂(SO₄)₃·18H₂O", mw:666.425, purity:98, state:"solid", kind:"salt", refs:"Dạng ngậm nước được nêu trong giáo trình (phèn nhôm kali)." },
  cuso4_5:   { name:"Đồng(II) sulfate pentahydrate", formula:"CuSO₄·5H₂O", mw:249.685, purity:99, state:"solid", kind:"toxic", refs:"Dạng ngậm nước được nêu trong giáo trình điều chế phức đồng-amoniac." },
  feso4_7:   { name:"Sắt(II) sulfate heptahydrate", formula:"FeSO₄·7H₂O", mw:278.01, purity:98, state:"solid", kind:"salt" },
  mohr:      { name:"Muối Mohr", formula:"(NH₄)₂Fe(SO₄)₂·6H₂O", mw:392.14, purity:99, state:"solid", kind:"salt" },
  mnso4_h2o: { name:"Mangan(II) sulfate monohydrate", formula:"MnSO₄·H₂O", mw:169.02, purity:98, state:"solid", kind:"salt" },
  znso4_7:   { name:"Kẽm sulfate heptahydrate", formula:"ZnSO₄·7H₂O", mw:287.54, purity:99, state:"solid", kind:"salt" },
  sncl2_2:   { name:"Thiếc(II) clorua dihydrate", formula:"SnCl₂·2H₂O", mw:225.63, purity:98, state:"solid", kind:"salt" },
  na2co3:    { name:"Natri carbonate khan", formula:"Na₂CO₃", mw:105.988, purity:99, state:"solid", kind:"salt" },
  na2co3_10: { name:"Natri carbonate decahydrate", formula:"Na₂CO₃·10H₂O", mw:286.14, purity:99, state:"solid", kind:"salt" },
  na2so4:    { name:"Natri sulfate khan", formula:"Na₂SO₄", mw:142.04, purity:99, state:"solid", kind:"salt" },
  na2s2o3_5: { name:"Natri thiosulfate pentahydrate", formula:"Na₂S₂O₃·5H₂O", mw:248.18, purity:99, state:"solid", kind:"salt", refs:"Dạng ngậm nước xuất hiện trong phần điều chế thiosulfate của giáo trình." },
  k2cr2o7:   { name:"Kali dichromate", formula:"K₂Cr₂O₇", mw:294.185, purity:99.5, state:"solid", kind:"toxic", refs:"Hợp chất Cr(VI) độc, gây ung thư; chỉ thao tác theo SOP và thu gom riêng." },
  kmno4:     { name:"Kali permanganate", formula:"KMnO₄", mw:158.034, purity:99, state:"solid", kind:"oxidizer" },
  ki:        { name:"Kali iodide", formula:"KI", mw:166.003, purity:99, state:"solid", kind:"salt" },
  kbr:       { name:"Kali bromide", formula:"KBr", mw:119.002, purity:99, state:"solid", kind:"salt" },
  agno3:     { name:"Bạc nitrate", formula:"AgNO₃", mw:169.873, purity:99.5, state:"solid", kind:"oxidizer" },
  h2c2o4_2:  { name:"Axit oxalic dihydrate", formula:"H₂C₂O₄·2H₂O", mw:126.065, purity:99, state:"solid", kind:"toxic" },
  nh4cl:     { name:"Amoni clorua", formula:"NH₄Cl", mw:53.491, purity:99, state:"solid", kind:"salt" },
  crcl3_6:   { name:"Crom(III) clorua hexahydrate", formula:"CrCl₃·6H₂O", mw:266.45, purity:98, state:"solid", kind:"toxic" },
  fecl3_6:   { name:"Sắt(III) clorua hexahydrate", formula:"FeCl₃·6H₂O", mw:270.30, purity:98, state:"solid", kind:"salt" },
  niso4_6:   { name:"Niken(II) sulfate hexahydrate", formula:"NiSO₄·6H₂O", mw:262.85, purity:98, state:"solid", kind:"toxic" },
  cocl2_6:   { name:"Coban(II) clorua hexahydrate", formula:"CoCl₂·6H₂O", mw:237.93, purity:98, state:"solid", kind:"toxic" },
  pbno3_2:   { name:"Chì(II) nitrate", formula:"Pb(NO₃)₂", mw:331.21, purity:99, state:"solid", kind:"toxic" },
  k2cro4:    { name:"Kali chromate", formula:"K₂CrO₄", mw:194.19, purity:99, state:"solid", kind:"toxic" },
  k2so4:     { name:"Kali sulfate", formula:"K₂SO₄", mw:174.259, purity:99, state:"solid", kind:"salt" },
  na2s:      { name:"Natri sulfide khan", formula:"Na₂S", mw:78.045, purity:98, state:"solid", kind:"toxic" },
  h2o2:      { name:"Hydrogen peroxide", formula:"H₂O₂", mw:34.015, density:1.11, assay:30, state:"liquid", kind:"oxidizer", refs:"Dung dịch H₂O₂ 30% tham khảo; cần đối chiếu assay và khối lượng riêng trên nhãn." },
  na2sio3_9: { name:"Natri metasilicate nonahydrate", formula:"Na₂SiO₃·9H₂O", mw:284.20, purity:98, state:"solid", kind:"salt" },
  custom:    { name:"Hóa chất tự nhập", formula:"", mw:null, purity:100, state:"solid", kind:"unknown" }
};
 
const SAFETY = {
  acid: ["Rót từ từ axit vào nước, không rót nước vào axit. Khuấy và kiểm soát nhiệt."],
  oxidizer: ["Chất oxy hóa: tránh tiếp xúc chất hữu cơ, chất khử và vật liệu dễ cháy; dùng dụng cụ tương thích."],
  base: ["Kiềm ăn mòn. Khi hòa tan chất rắn, cho từ từ hóa chất vào nước; quá trình có thể tỏa nhiệt mạnh."],
  toxic: ["Hóa chất độc: hạn chế lượng thao tác, tránh bụi/giọt bắn, làm việc theo SOP và thu gom chất thải chuyên biệt."]
};
 
let root, chem = "h2so4", sourceType = "ww", targetType = "M", sourcePreset = true;
const vals = Object.create(null);
 
export function init(el) {
  root = el;
  root.addEventListener("input", e => {
    if (e.target.id === "cc-search") { filterChemicals(e.target.value); return; }
    if (e.target.matches("[data-k]")) vals[e.target.dataset.k] = e.target.value;
    compute();
  });
  root.addEventListener("change", e => {
    if (e.target.id === "cc-chem") { chem = e.target.value; resetChemicalFields(); render(); }
    if (e.target.id === "cc-source-type") { sourceType = e.target.value; delete vals.source; delete vals.factor; render(); }
    if (e.target.id === "cc-target-type") { targetType = e.target.value; delete vals.target; render(); }
  });
  render();
}
export function onShow() {}
 
function resetChemicalFields() {
  ["mw","purity","density","source","target","volume","mass","factor"].forEach(k => delete vals[k]);
  sourcePreset = true;
}
const c = () => CHEMS[chem] || CHEMS.custom;
const n = k => {
  const raw = String(vals[k] ?? "").trim();
  if (!raw) return null;
  const x = parseNum(raw);
  return Number.isFinite(x) ? x : NaN;
};
const val = (k, fallback = "") => esc(vals[k] ?? fallback);
const f = (k, label, unit, placeholder = "", fallback = "") => `
  <label class="lbl">${label}<div class="inp-unit">
    <input class="inp" data-k="${k}" inputmode="decimal" autocomplete="off" value="${val(k, fallback)}" placeholder="${placeholder}">
    <span class="unit">${unit}</span></div></label>`;
const select = (id, label, options, selected) => `<label class="lbl">${label}<select class="inp" id="${id}">${options.map(([v,t]) => `<option value="${v}" ${v===selected?"selected":""}>${t}</option>`).join("")}</select></label>`;
const optionsSource = [["M","M (mol/L)"],["N","N (eq/L)"],["ww","% khối lượng (w/w)"],["wv","% khối lượng/thể tích (w/v)"]];
const optionsTarget = [["M","M (mol/L)"],["N","N (eq/L)"],["ww","% khối lượng (w/w)"],["wv","% khối lượng/thể tích (w/v)"]];
 
function chemicalOptions() {
  return Object.entries(CHEMS).map(([id,x]) => `<option value="${id}" ${id===chem?"selected":""}>${x.formula ? x.formula+" — " : ""}${x.name}</option>`).join("");
}
function filterChemicals(q) {
  const s = q.trim().toLocaleLowerCase("vi");
  const sel = root.querySelector("#cc-chem");
  if (!sel) return;
  [...sel.options].forEach(o => { o.hidden = !!s && !o.text.toLocaleLowerCase("vi").includes(s); });
  const current = [...sel.options].find(o => o.value === chem);
  if (current && current.hidden) current.selected = false;
}
function render() {
  const x = c();
  const defaultSource = sourceType === "ww" ? (x.assay ?? "") : sourceType === "M" ? "" : "";
  const defaultPurity = x.purity ?? 99;
  const solid = x.state === "solid";
  root.innerHTML = `
    <div class="card">
      <label class="lbl">Tìm hóa chất<input class="inp" id="cc-search" placeholder="Tên hoặc công thức: H₂SO₄, CuSO₄·5H₂O..."></label>
      <label class="lbl">Hóa chất<select class="inp" id="cc-chem">${chemicalOptions()}</select></label>
      <div class="muted small">${esc(x.refs || (solid ? "Chọn đúng dạng khan/ngậm nước và độ tinh khiết theo chai hóa chất." : "Thông số tham khảo; luôn xác nhận nồng độ và khối lượng riêng trên nhãn/SDS."))}</div>
    </div>
    <div class="card">
      <h3>1. Dung dịch ban đầu</h3>
      ${select("cc-source-type","Đơn vị nồng độ ban đầu",optionsSource,sourceType)}
      <div class="grid2">
        ${f("source","Nồng độ ban đầu",sourceType==="M"?"mol/L":sourceType==="N"?"eq/L": "%", "Ví dụ: 98", solid?"":defaultSource)}
        ${f("mw","Khối lượng mol M","g/mol","Ví dụ: 98.079",x.mw ?? "")}
      </div>
      <div class="grid2">
        ${f("density","Khối lượng riêng dung dịch gốc","g/mL","Cần cho % w/w ↔ M",x.density ?? "")}
        ${f("purity","Độ tinh khiết chất rắn (khi cân)","%","Theo nhãn hóa chất",x.purity ?? 100)}
      </div>
      ${(sourceType==="N" || targetType==="N") ? f("factor","Hệ số đương lượng n","eq/mol","Bắt buộc khi dùng N","") : ""}
      <p class="muted small">${solid ? "Hóa chất đang chọn là chất rắn. Chọn “Pha từ chất rắn” ở phần cách pha bên dưới nếu cân trực tiếp." : "Với dung dịch % w/w, cần khối lượng riêng để quy đổi sang mol/L hoặc tính theo thể tích."}</p>
    </div>
    <div class="card">
      <h3>2. Dung dịch cần pha</h3>
      ${select("cc-target-type","Đơn vị nồng độ đích",optionsTarget,targetType)}
      <div class="grid2">
        ${f("target","Nồng độ đích",targetType==="M"?"mol/L":targetType==="N"?"eq/L":"%", "Ví dụ: 0.1")}
        ${targetType==="ww" ? f("mass","Khối lượng dung dịch cuối","g","Ví dụ: 250") : f("volume","Thể tích dung dịch cuối","mL","Ví dụ: 250")}
      </div>
    </div>
    <div class="card">
      <h3>3. Cách pha</h3>
      <label class="check"><input type="radio" name="cc-method" value="solution" ${x.state==="liquid"?"checked":""}> Pha loãng từ dung dịch ban đầu</label>
      <label class="check"><input type="radio" name="cc-method" value="solid" ${x.state==="solid"?"checked":""}> Cân chất rắn rồi hòa tan</label>
      <p class="muted small">Khi chọn chất rắn, dùng đúng công thức hydrate hiển thị và khối lượng mol tương ứng.</p>
    </div>
    <div id="cc-result"></div>
    <div id="cc-guide"></div>
    <div class="card">
      <h3>Cách sử dụng và quy ước tính</h3>
      <ol class="small">
        <li>Chọn đúng hóa chất và đúng dạng khan/ngậm nước. Khối lượng mol phải ứng với công thức đang cân.</li>
        <li>Chọn đơn vị nồng độ của dung dịch gốc, nhập nồng độ thực tế trên nhãn; với % w/w phải nhập khối lượng riêng.</li>
        <li>Chọn đơn vị nồng độ đích và nhập thể tích cuối hoặc khối lượng cuối theo yêu cầu.</li>
        <li>Chọn “Cân chất rắn” nếu pha trực tiếp từ hóa chất rắn. Phần mềm tự hiệu chỉnh theo độ tinh khiết.</li>
      </ol>
      <p class="small"><b>Quy ước:</b> % w/w = g chất tan/100 g dung dịch; % w/v = g chất tan/100 mL dung dịch; M = mol/L; N = đương lượng/L.</p>
      <p class="small"><b>Lưu ý quy đổi:</b> M ↔ % w/w cần khối lượng riêng dung dịch; % w/v ↔ M cần khối lượng mol; N cần hệ số đương lượng theo phản ứng. Không có đủ dữ liệu thì không tự ước lượng.</p>
      <p class="small"><b>Độ chính xác:</b> kết quả là giá trị lý thuyết theo dữ liệu nhập. Dùng bình định mức để định thể tích; không cộng trừ thể tích dung môi một cách máy móc.</p>
    </div>
    ${safetyHtml()}`;
  // Persist the current selection after rebuilding the controls.
  root.querySelector("#cc-chem").value = chem;
  root.querySelector("#cc-source-type").value = sourceType;
  root.querySelector("#cc-target-type").value = targetType;
  root.querySelectorAll("[data-k]").forEach(i => i.addEventListener("input", () => { vals[i.dataset.k] = i.value; compute(); }));
  root.querySelectorAll('input[name="cc-method"]').forEach(i => i.addEventListener("change", compute));
  renderMath(root);
  compute();
}
 
function fmt(x, digits=5) {
  if (!Number.isFinite(x)) return "—";
  return Number(x.toPrecision(digits)).toLocaleString("vi-VN", {maximumSignificantDigits:digits});
}
function rows(items) {
  return `<div class="result">${items.map(([label,value,unit]) => `<div class="res-row"><span>${label}</span><b>${fmt(value)} ${unit||""}</b></div>`).join("")}</div>`;
}
function error(t) { return `<div class="result error">${t}</div>`; }
function info(t) { return `<div class="result info">${t}</div>`; }
function method() { return root.querySelector('input[name="cc-method"]:checked')?.value || "solution"; }
 
function compute() {
  if (!root?.querySelector("#cc-result")) return;
  root.querySelectorAll("[data-k]").forEach(i => { vals[i.dataset.k] = i.value; });
  const result = root.querySelector("#cc-result");
  const guide = root.querySelector("#cc-guide");
  const chemical = c();
  const mw = n("mw") ?? chemical.mw;
  const purity = n("purity") ?? chemical.purity ?? 100;
  const target = n("target");
  const isSolid = method() === "solid";
  const volume = n("volume");
  const finalMass = n("mass");
  if (isSolid && chemical.state === "liquid") { result.innerHTML = error("Hóa chất đang chọn là dung dịch/lỏng; hãy chọn “Pha loãng từ dung dịch ban đầu” hoặc chọn chất rắn phù hợp."); guide.innerHTML = ""; return; }
  if (!(mw > 0)) { result.innerHTML = info("Nhập khối lượng mol của chất tan để tính."); guide.innerHTML = ""; return; }
  if (!(target > 0)) { result.innerHTML = info("Nhập nồng độ đích để xem kết quả."); guide.innerHTML = ""; return; }
  if (purity <= 0 || purity > 100) { result.innerHTML = error("Độ tinh khiết phải lớn hơn 0 và không vượt quá 100%."); return; }
 
  if (isSolid) {
    if (targetType === "ww") {
      if (!(finalMass > 0)) { result.innerHTML = info("Nhập khối lượng dung dịch cuối (g)."); return; }
      const solute = finalMass * target / 100;
      const weigh = solute * 100 / purity;
      if (weigh > finalMass) { result.innerHTML = error("Khối lượng chất rắn cần cân vượt khối lượng dung dịch cuối."); return; }
      result.innerHTML = rows([["Khối lượng chất tan tinh khiết cần có",solute,"g"],["Khối lượng chất rắn cần cân (đã hiệu chỉnh độ tinh khiết)",weigh,"g"],["Khối lượng nước/dung môi cần thêm (xấp xỉ)",finalMass-weigh,"g"]]);
      guide.innerHTML = guideHtml(`Cân ${fmt(weigh)} g ${chemical.formula || chemical.name}. Hòa tan trong một phần dung môi, để nguội nếu có tỏa nhiệt, sau đó bổ sung dung môi đến tổng khối lượng ${fmt(finalMass)} g.`, "Công thức: m cân = (P đích × m dung dịch cuối / 100) × 100 / độ tinh khiết.");
      return;
    }
    if (!(volume > 0)) { result.innerHTML = info("Nhập thể tích dung dịch cuối (mL)."); return; }
    let molarity = target;
    if (targetType === "N") {
      const factor = n("factor");
      if (!(factor > 0)) { result.innerHTML = error("Nồng độ N cần hệ số đương lượng n (eq/mol), phụ thuộc phản ứng cụ thể."); return; }
      molarity = target / factor;
    } else if (targetType === "ww" || targetType === "wv") {
      result.innerHTML = error("Để pha chất rắn theo % khối lượng/thể tích, chọn đơn vị đích % w/w hoặc % w/v và nhập đúng đại lượng khối lượng/thể tích."); return;
    }
    const pureMass = molarity * volume / 1000 * mw;
    const weigh = pureMass * 100 / purity;
    result.innerHTML = rows([["Nồng độ mol tương đương",molarity,"mol/L"],["Số mol chất tan",molarity*volume/1000,"mol"],["Khối lượng chất tan tinh khiết",pureMass,"g"],["Khối lượng chất rắn cần cân",weigh,"g"]]);
    guide.innerHTML = guideHtml(`Cân ${fmt(weigh)} g ${chemical.formula || chemical.name}. Hòa tan trong khoảng 60–70% thể tích dung môi, để nguội về nhiệt độ phòng, chuyển định lượng vào bình định mức ${fmt(volume)} mL và thêm dung môi đến vạch.`, "Với muối ngậm nước, M phải là khối lượng mol của toàn bộ công thức hydrate, không phải muối khan.");
    return;
  }
 
  // Convert stock concentration into grams of solute per litre of stock.
  const source = n("source");
  if (!(source > 0)) { result.innerHTML = info("Nhập nồng độ dung dịch ban đầu."); return; }
  let stockGL = NaN;
  if (sourceType === "M") stockGL = source * mw;
  if (sourceType === "N") {
    const factor = n("factor");
    if (!(factor > 0)) { result.innerHTML = error("Nồng độ N cần hệ số đương lượng n (eq/mol), phụ thuộc phản ứng cụ thể."); return; }
    stockGL = source / factor * mw;
  }
  if (sourceType === "ww") {
    const d = n("density");
    if (!(d > 0)) { result.innerHTML = error("Muốn quy đổi % w/w cần nhập khối lượng riêng dung dịch ban đầu (g/mL)."); return; }
    stockGL = source / 100 * d * 1000;
  }
  if (sourceType === "wv") stockGL = source * 10;
  if (!(stockGL > 0)) { result.innerHTML = error("Không thể quy đổi nồng độ ban đầu với dữ liệu hiện có."); return; }
 
  if (targetType === "ww") {
    if (!(finalMass > 0)) { result.innerHTML = info("Nhập khối lượng dung dịch cuối (g) để pha theo % khối lượng."); return; }
    const soluteMass = finalMass * target / 100;
    let stockMass, stockVol;
    if (sourceType === "ww") {
      stockMass = soluteMass / (source/100);
      stockVol = stockMass / n("density");
    } else {
      const d = n("density");
      if (!(d > 0)) { result.innerHTML = error("Cần khối lượng riêng dung dịch gốc để chuyển lượng lấy từ thể tích sang khối lượng."); return; }
      stockVol = soluteMass / stockGL * 1000;
      stockMass = stockVol * d;
    }
    if (stockMass > finalMass) { result.innerHTML = error("Dung dịch gốc cần dùng có khối lượng lớn hơn khối lượng dung dịch cuối. Nồng độ đích có thể cao hơn nồng độ gốc."); return; }
    result.innerHTML = rows([["Khối lượng chất tan cần có",soluteMass,"g"],["Khối lượng dung dịch gốc cần lấy",stockMass,"g"],["Thể tích dung dịch gốc (nếu có d)",stockVol,"mL"],["Khối lượng nước/dung môi thêm (xấp xỉ)",finalMass-stockMass,"g"]]);
    guide.innerHTML = guideHtml(`Cân/lấy ${fmt(stockMass)} g dung dịch gốc, thêm dung môi đến tổng khối lượng ${fmt(finalMass)} g.`, "Pha theo khối lượng: cân chính xác dung dịch gốc và dung môi; không lấy hiệu hai thể tích để suy ra thể tích dung môi.");
    return;
  }
 
  if (!(volume > 0)) { result.innerHTML = info("Nhập thể tích dung dịch cuối (mL)."); return; }
  let targetGL;
  if (targetType === "M") targetGL = target * mw;
  if (targetType === "N") {
    const factor = n("factor");
    if (!(factor > 0)) { result.innerHTML = error("Nồng độ N cần hệ số đương lượng n (eq/mol), phụ thuộc phản ứng cụ thể."); return; }
    targetGL = target / factor * mw;
  }
  if (targetType === "wv") targetGL = target * 10;
  if (!(targetGL > 0)) { result.innerHTML = error("Đơn vị nồng độ đích không hợp lệ."); return; }
  if (targetGL > stockGL * (1 + 1e-10)) { result.innerHTML = error(`Nồng độ đích tương đương ${fmt(targetGL)} g/L lớn hơn dung dịch gốc ${fmt(stockGL)} g/L. Không thể pha loãng để đạt nồng độ này.`); return; }
  const stockVol = targetGL * volume / stockGL;
  if (stockVol > volume * (1 + 1e-10)) { result.innerHTML = error("Thể tích dung dịch gốc cần lấy vượt thể tích cuối."); return; }
  const list = [["Nồng độ chất tan trong dung dịch gốc",stockGL,"g/L"],["Nồng độ đích quy đổi",targetGL,"g/L"],["Thể tích dung dịch gốc cần lấy",stockVol,"mL"],["Thể tích cuối cần định mức",volume,"mL"]];
  if (sourceType === "ww" && n("density") > 0) list.push(["Khối lượng dung dịch gốc tương ứng",stockVol*n("density"),"g"]);
  result.innerHTML = rows(list);
  guide.innerHTML = guideHtml(`Dùng pipet lấy ${fmt(stockVol)} mL dung dịch gốc, chuyển vào bình định mức ${fmt(volume)} mL. Thêm dung môi đến gần vạch, trộn đều, chờ cân bằng nhiệt rồi định mức đến vạch.`, "Không tính nước thêm bằng phép trừ thể tích một cách tuyệt đối: thể tích sau khi trộn có thể không cộng tính, nhất là với axit/kiềm đậm đặc.");
}
 
function guideHtml(action, formula) {
  return `<div class="card"><h3>Hướng dẫn thao tác</h3><ol>
    <li>${action}</li>
    <li>Đậy nút, đảo trộn đồng nhất và dán nhãn: tên hóa chất, công thức, nồng độ, ngày pha, người pha.</li>
    <li>Ghi rõ dạng hóa chất, độ tinh khiết, nhiệt độ và dụng cụ định mức trong sổ thí nghiệm.</li>
  </ol><p class="muted small"><b>Cơ sở tính:</b> ${formula}</p></div>`;
}
 
function safetyHtml() {
  const x = c(), items = [...(SAFETY[x.kind] || [])];
  if (x.kind === "acid") items.unshift("Luôn rót axit vào nước, từ từ và có khuấy; không làm ngược lại.");
  if (chem === "h2so4") items.push("H₂SO₄ đặc pha loãng tỏa nhiệt rất mạnh: dùng bình chịu nhiệt, làm mát, để nguội hoàn toàn rồi mới định mức.");
  if (chem === "hno3") items.push("HNO₃ là chất oxy hóa mạnh; thao tác trong tủ hút, tránh chất hữu cơ và vật liệu dễ cháy.");
  if (chem === "nh3") items.push("Dung dịch NH₃ bay hơi mạnh; thao tác trong tủ hút, tránh hít hơi.");
  if (chem === "naoh" || chem === "koh") items.push("Cho từ từ chất rắn vào nước; hòa tan tỏa nhiệt. Cân nhanh vì chất hút ẩm/CO₂.");
  items.push("Mặc áo blouse, kính bảo hộ và găng phù hợp; đọc SDS và làm theo hướng dẫn giảng viên.");
  items.push("Không dùng thông số mặc định thay cho nhãn chai/SDS. Nếu không rõ hydrate, assay hoặc khối lượng riêng, dừng tính và xác minh trước.");
  return `<div class="safety"><h3>⚠️ An toàn — ${esc(x.formula || x.name)}</h3><ul>${items.map(t=>`<li>${esc(t)}</li>`).join("")}</ul></div>`;
}