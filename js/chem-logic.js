// ============ LabMana Bartender — logic thuần (không đụng DOM) ============
import { parseNum } from "./plan-logic.js";

/*
 * Mô hình: mọi nồng độ được quy về hai đại lượng gốc
 *   gL = gam chất tan / lít dung dịch      (nồng độ theo thể tích)
 *   w  = phân số khối lượng chất tan        (nồng độ theo khối lượng)
 * gL <-> w chỉ quy đổi được khi biết khối lượng riêng d của CHÍNH dung dịch đó:
 *   gL = w · d · 1000
 * Không có d thì không đoán — báo thiếu dữ liệu.
 *
 * Đơn vị: M, mM, N (cần n), g/L, ppm (mg/L), % w/v, % w/w, molal.
 */

export const KIND_LABEL = { acid: "Axit", base: "Bazơ", salt: "Muối", oxidizer: "Oxy hóa", toxic: "Độc", unknown: "Khác" };

export const CHEMS = {
  hcl:       { name:"Axit clohidric", formula:"HCl", mw:36.4609, density:1.19, assay:37, state:"liquid", kind:"acid", refs:"Đậm đặc tham khảo: 37% w/w; d ≈ 1,19 g/mL." },
  h2so4:     { name:"Axit sulfuric", formula:"H₂SO₄", mw:98.079, density:1.84, assay:98, state:"liquid", kind:"acid", refs:"Đậm đặc tham khảo: 98% w/w; d ≈ 1,84 g/mL." },
  hno3:      { name:"Axit nitric", formula:"HNO₃", mw:63.012, density:1.39, assay:65, state:"liquid", kind:"oxidizer", refs:"Đậm đặc tham khảo: 65% w/w; d ≈ 1,39 g/mL." },
  ch3cooh:   { name:"Axit axetic băng", formula:"CH₃COOH", mw:60.052, density:1.049, assay:99.8, state:"liquid", kind:"acid", refs:"Axit axetic băng tham khảo: 99,8% w/w; d ≈ 1,049 g/mL." },
  nh3:       { name:"Amoniac", formula:"NH₃", mw:17.031, density:0.91, assay:25, state:"liquid", kind:"base", refs:"Amoniac tham khảo: 25% w/w; d ≈ 0,91 g/mL." },
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
  h2o2:      { name:"Hydrogen peroxide", formula:"H₂O₂", mw:34.015, density:1.11, assay:30, state:"liquid", kind:"oxidizer", refs:"H₂O₂ 30% tham khảo; đối chiếu assay và khối lượng riêng trên nhãn." },
  na2sio3_9: { name:"Natri metasilicate nonahydrate", formula:"Na₂SiO₃·9H₂O", mw:284.20, purity:98, state:"solid", kind:"salt" },
  custom:    { name:"Hóa chất tự nhập", formula:"", mw:null, purity:100, state:"solid", kind:"unknown", refs:"Tự nhập khối lượng mol; dùng đúng công thức (khan/ngậm nước) của chất đang cân." }
};

/** Gợi ý hệ số đương lượng n [n, ghi chú] — chỉ là gợi ý, người dùng phải chọn theo phản ứng. */
/** Hóa chất người dùng tự thêm (Cài đặt → Hóa chất pha chế): id bắt đầu bằng "u_", gộp vào CHEMS, thay thế hoàn toàn bản cũ mỗi lần gọi. */
export const CUSTOM_PREFIX = "u_";
export function setCustomChems(list) {
  for (const id of Object.keys(CHEMS)) if (id.startsWith(CUSTOM_PREFIX)) delete CHEMS[id];
  const tail = CHEMS.custom; delete CHEMS.custom;           // "Hóa chất tự nhập" luôn nằm cuối danh sách
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || !String(c.id || "").startsWith(CUSTOM_PREFIX) || !String(c.name || "").trim()) continue;
    const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(+v) || +v <= 0) ? null : +v;
    const liquid = c.state === "liquid";
    const x = { name: String(c.name).trim(), formula: String(c.formula || "").trim(), mw: num(c.mw), state: liquid ? "liquid" : "solid",
      kind: KIND_LABEL[c.kind] ? c.kind : "unknown", refs: String(c.refs || "").trim() || "Hóa chất do người dùng thêm; đối chiếu thông số với nhãn chai/SDS.", user: true };
    if (liquid) { x.assay = num(c.assay) ?? 100; x.density = num(c.density) ?? 1; } else x.purity = num(c.purity) ?? 100;
    CHEMS[c.id] = x;
  }
  CHEMS.custom = tail;
}

export const EQ_HINTS = {
  hcl: [[1, "1 H⁺"]],
  h2so4: [[2, "2 H⁺ (trung hòa hoàn toàn)"], [1, "chỉ nấc 1"]],
  hno3: [[1, "1 H⁺"]],
  ch3cooh: [[1, "1 H⁺"]],
  nh3: [[1, "nhận 1 H⁺"]],
  naoh: [[1, "1 OH⁻"]],
  koh: [[1, "1 OH⁻"]],
  kmno4: [[5, "môi trường axit (→ Mn²⁺)"], [3, "trung tính (→ MnO₂)"], [1, "kiềm mạnh (→ MnO₄²⁻)"]],
  k2cr2o7: [[6, "môi trường axit (→ Cr³⁺)"]],
  h2c2o4_2: [[2, "2 H⁺ hoặc 2 e⁻ (→ CO₂)"]],
  na2co3: [[2, "đến H₂CO₃"], [1, "đến HCO₃⁻"]],
  na2co3_10: [[2, "đến H₂CO₃"], [1, "đến HCO₃⁻"]],
  na2s2o3_5: [[1, "chuẩn độ iod"]],
  feso4_7: [[1, "Fe²⁺ → Fe³⁺"]],
  mohr: [[1, "Fe²⁺ → Fe³⁺"]],
  h2o2: [[2, "2 e⁻"]],
  agno3: [[1, "Ag⁺ + Cl⁻"]],
  ki: [[1, "I⁻ → I₂"]]
};

const SAFETY = {
  acid: ["Luôn rót axit vào nước, từ từ và có khuấy; không làm ngược lại.", "Rót từ từ axit vào nước, không rót nước vào axit. Khuấy và kiểm soát nhiệt."],
  oxidizer: ["Chất oxy hóa: tránh tiếp xúc chất hữu cơ, chất khử và vật liệu dễ cháy; dùng dụng cụ tương thích."],
  base: ["Kiềm ăn mòn. Khi hòa tan chất rắn, cho từ từ hóa chất vào nước; quá trình có thể tỏa nhiệt mạnh."],
  toxic: ["Hóa chất độc: hạn chế lượng thao tác, tránh bụi/giọt bắn, làm việc theo SOP và thu gom chất thải chuyên biệt."]
};
const SAFETY_EXTRA = {
  h2so4: "H₂SO₄ đặc pha loãng tỏa nhiệt rất mạnh: dùng bình chịu nhiệt, làm mát, để nguội hoàn toàn rồi mới định mức.",
  hno3: "HNO₃ là chất oxy hóa mạnh; thao tác trong tủ hút, tránh chất hữu cơ và vật liệu dễ cháy.",
  nh3: "Dung dịch NH₃ bay hơi mạnh; thao tác trong tủ hút, tránh hít hơi.",
  naoh: "Cho từ từ chất rắn vào nước; hòa tan tỏa nhiệt. Cân nhanh vì chất hút ẩm/CO₂.",
  koh: "Cho từ từ chất rắn vào nước; hòa tan tỏa nhiệt. Cân nhanh vì chất hút ẩm/CO₂."
};
export function safetyItems(id) {
  const x = CHEMS[id] || CHEMS.custom;
  const items = [...(SAFETY[x.kind] || [])];
  if (SAFETY_EXTRA[id]) items.push(SAFETY_EXTRA[id]);
  items.push("Mặc áo blouse, kính bảo hộ và găng phù hợp; đọc SDS và làm theo hướng dẫn giảng viên.");
  items.push("Không dùng thông số mặc định thay cho nhãn chai/SDS. Nếu không rõ hydrate, assay hoặc khối lượng riêng, dừng tính và xác minh trước.");
  return items;
}

/* ------------------------------ Đơn vị ------------------------------ */
export const UNITS = {
  M:   { sym: "M",     unit: "mol/L",      name: "Nồng độ mol" },
  mM:  { sym: "mM",    unit: "mmol/L",     name: "Milimol/L" },
  N:   { sym: "N",     unit: "eq/L",       name: "Nồng độ đương lượng" },
  gL:  { sym: "g/L",   unit: "g/L",        name: "Gam trên lít" },
  ppm: { sym: "ppm",   unit: "mg/L",       name: "ppm (mg/L)" },
  wv:  { sym: "% w/v", unit: "g/100 mL",   name: "% khối lượng/thể tích" },
  ww:  { sym: "% w/w", unit: "g/100 g dd", name: "% khối lượng" },
  m:   { sym: "molal", unit: "mol/kg dm",  name: "Molan" }
};
export const UNIT_ORDER = ["M", "mM", "N", "gL", "ppm", "wv", "ww", "m"];
export const MASS_UNITS = new Set(["ww", "m"]);       // nồng độ theo khối lượng → lượng cuối tính bằng gam
export const MOL_UNITS = new Set(["M", "mM", "N", "m"]); // cần khối lượng mol

export const NEED_MSG = {
  mw: "Nhập khối lượng mol (g/mol).",
  n: "Nhập hệ số đương lượng n (eq/mol) — phụ thuộc phản ứng cụ thể.",
  d: "Cần khối lượng riêng của dung dịch (g/mL) để quy đổi giữa nồng độ khối lượng và thể tích."
};

/* ------------------------------ Định dạng số ------------------------------ */
export function fmt(x, digits = 4) {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  return Number(x.toPrecision(digits)).toLocaleString("vi-VN", { maximumSignificantDigits: digits });
}
export function fmtVol(mL) {
  if (mL < 1) return `${fmt(mL * 1000)} µL`;
  if (mL >= 1000) return `${fmt(mL / 1000)} L`;
  return `${fmt(mL)} mL`;
}
export function fmtMass(g) {
  if (g < 1) return `${fmt(g * 1000)} mg`;
  if (g >= 1000) return `${fmt(g / 1000)} kg`;
  return `${fmt(g)} g`;
}
const fmtMol = mol => (mol < 0.01 ? `${fmt(mol * 1000)} mmol` : `${fmt(mol)} mol`);

/** Ô nhập → {has, val, bad}. Chỉ chấp nhận số > 0. */
export function field(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { has: false, val: null, bad: false };
  const x = parseNum(s);
  return Number.isFinite(x) && x > 0 ? { has: true, val: x, bad: false } : { has: true, val: null, bad: true };
}

/* ------------------------------ Quy đổi lõi ------------------------------ */
/** (đơn vị, giá trị, {mw,n,d}) → {gL, w} (một trong hai có thể null) | {need} | {err} */
export function parseConc(unit, v, c) {
  const { mw, n, d } = c;
  let gL = null, w = null;
  switch (unit) {
    case "M":   if (!(mw > 0)) return { need: "mw" }; gL = v * mw; break;
    case "mM":  if (!(mw > 0)) return { need: "mw" }; gL = v / 1000 * mw; break;
    case "N":
      if (!(mw > 0)) return { need: "mw" };
      if (!(n > 0)) return { need: "n" };
      gL = v / n * mw; break;
    case "gL":  gL = v; break;
    case "ppm": gL = v / 1000; break;
    case "wv":  gL = v * 10; break;
    case "ww":
      if (v > 100) return { err: "% w/w không thể lớn hơn 100." };
      w = v / 100; break;
    case "m":
      if (!(mw > 0)) return { need: "mw" };
      w = v * mw / (1000 + v * mw); break;
    default: return { err: "Đơn vị không hợp lệ." };
  }
  if (gL != null && w == null && d > 0) w = gL / (1000 * d);
  if (w != null && gL == null && d > 0) gL = w * d * 1000;
  if (w != null && w > 1 + 1e-9) return { err: "Nồng độ lớn hơn khối lượng riêng cho phép (chất tan nhiều hơn cả dung dịch). Kiểm tra lại d hoặc nồng độ." };
  return { gL, w };
}

/** {gL,w} → giá trị ở đơn vị đích | {need} | {err} */
export function fromConc(unit, p, c) {
  const { mw, n } = c;
  const molar = () => {
    if (!(mw > 0)) return { need: "mw" };
    if (p.gL == null) return { need: "d" };
    return { v: p.gL / mw };
  };
  switch (unit) {
    case "M": return molar();
    case "mM": { const r = molar(); return r.v != null ? { v: r.v * 1000 } : r; }
    case "N": {
      if (!(n > 0)) return { need: "n" };
      const r = molar(); return r.v != null ? { v: r.v * n } : r;
    }
    case "gL": return p.gL == null ? { need: "d" } : { v: p.gL };
    case "ppm": return p.gL == null ? { need: "d" } : { v: p.gL * 1000 };
    case "wv": return p.gL == null ? { need: "d" } : { v: p.gL / 10 };
    case "ww": return p.w == null ? { need: "d" } : { v: p.w * 100 };
    case "m":
      if (!(mw > 0)) return { need: "mw" };
      if (p.w == null) return { need: "d" };
      if (p.w >= 1) return { err: "w ≥ 100%" };
      return { v: p.w / (1 - p.w) * 1000 / mw };
    default: return { err: "Đơn vị không hợp lệ." };
  }
}

/* ------------------------------ Chế độ Quy đổi ------------------------------ */
const info = msg => ({ status: "info", msg });
const err = msg => ({ status: "error", msg });

export function computeConvert(c) {
  const v = field(c.value);
  if (!v.has) return info("Nhập nồng độ đang có để xem quy đổi sang mọi đơn vị.");
  if (v.bad) return err("Nồng độ phải là số lớn hơn 0.");
  const mwF = field(c.mw), dF = field(c.d), nF = field(c.n);
  if (mwF.bad) return err("Khối lượng mol phải là số lớn hơn 0.");
  if (dF.bad) return err("Khối lượng riêng phải là số lớn hơn 0.");
  if (nF.bad) return err("Hệ số đương lượng n phải là số lớn hơn 0.");
  const ctx = { mw: mwF.val, d: dF.val, n: nF.val };
  const p = parseConc(c.from, v.val, ctx);
  if (p.err) return err(p.err);
  if (p.need) return info(NEED_MSG[p.need]);
  const tiles = UNIT_ORDER.map(u => {
    if (u === c.from) return { unit: u, value: v.val, src: true };
    const r = fromConc(u, p, ctx);
    return { unit: u, value: r.v ?? null, need: r.need, err: r.err };
  });
  return { status: "ok", tiles };
}

/* ------------------------------ Chế độ Pha chế ------------------------------ */
/**
 * Các ô cần hiển thị cho bước nhập — để giao diện chỉ hiện đúng thứ cần dùng.
 * inp: { chem, method: "dilute"|"solid", stockUnit, targetUnit }
 */
export function fieldPlan(inp) {
  const solid = inp.method === "solid";
  const units = solid ? [inp.targetUnit] : [inp.stockUnit, inp.targetUnit];
  const sMass = MASS_UNITS.has(inp.stockUnit), tMass = MASS_UNITS.has(inp.targetUnit);
  return {
    showMw: units.some(u => MOL_UNITS.has(u)),
    showN: units.includes("N"),
    showD: !solid && !(!sMass && !tMass),   // chỉ cả hai theo thể tích thì không cần d
    dRequired: !solid && sMass !== tMass,   // trộn khối lượng ↔ thể tích thì bắt buộc
    showPurity: solid
  };
}

const pipetHint = mL =>
  mL < 1 ? "micropipet" : mL <= 25 ? "pipet chia vạch / pipet bầu (hoặc burette)" : mL <= 100 ? "burette hoặc ống đong" : "ống đong";
const LABEL_STEP = "Dán nhãn: tên/công thức, nồng độ, ngày pha, người pha; ghi dạng hóa chất, độ tinh khiết, nhiệt độ và dụng cụ định mức trong sổ thí nghiệm.";

/**
 * inp: { chem, method, stockUnit, targetUnit, v:{stock,density,mw,n,purity,target,amount}, scale:{vol,mass} }
 * → {status:"info"|"error"} | {status:"ok", hero, rows, equiv, warns, steps, basis}
 */
export function computeMix(inp) {
  const chem = CHEMS[inp.chem];
  if (!chem) return info("Chọn hóa chất ở bước 1.");
  if (!inp.method) return info("Chọn cách pha ở bước 2.");
  const solid = inp.method === "solid";
  const tU = inp.targetUnit, sU = inp.stockUnit;
  const tMass = MASS_UNITS.has(tU);
  const plan = fieldPlan(inp);
  const F = k => field(inp.v?.[k]);
  const sF = F("stock"), dF = F("density"), pF = F("purity"), T = F("target"), A = F("amount"), mwF = F("mw"), nF = F("n");

  // Kiểm tra theo đúng thứ tự các ô trên màn hình: A → B → C
  if (!solid) {
    if (!sF.has) return info("Nhập nồng độ dung dịch gốc.");
    if (sF.bad) return err("Nồng độ dung dịch gốc phải là số lớn hơn 0.");
    if (plan.showD && dF.bad) return err("Khối lượng riêng phải là số lớn hơn 0 (g/mL).");
    if (plan.dRequired && !dF.has) return info("Nhập khối lượng riêng dung dịch gốc (g/mL) — cần để chuyển giữa nồng độ khối lượng và thể tích.");
  } else {
    if (!pF.has) return info("Nhập độ tinh khiết của chất rắn (%), xem trên nhãn chai.");
    if (pF.bad || pF.val > 100) return err("Độ tinh khiết phải lớn hơn 0 và không vượt quá 100%.");
  }
  if (!T.has) return info("Nhập nồng độ cần pha.");
  if (T.bad) return err("Nồng độ cần pha phải là số lớn hơn 0.");
  if (!A.has) return info(tMass ? "Nhập khối lượng dung dịch cuối." : "Nhập thể tích dung dịch cuối.");
  if (A.bad) return err("Lượng dung dịch cuối phải là số lớn hơn 0.");
  if (plan.showMw && mwF.bad) return err("Khối lượng mol phải là số lớn hơn 0.");
  if (plan.showMw && !mwF.has) return info(NEED_MSG.mw);
  if (plan.showN && nF.bad) return err("Hệ số đương lượng n phải là số lớn hơn 0.");
  if (plan.showN && !nF.has) return info(NEED_MSG.n);

  const mw = plan.showMw ? mwF.val : null;
  const n = plan.showN ? nF.val : null;
  const d = plan.showD && dF.has ? dF.val : null;
  const amount = A.val * (tMass ? (inp.scale?.mass === "kg" ? 1000 : 1) : (inp.scale?.vol === "L" ? 1000 : 1)); // g hoặc mL
  const finalTxt = tMass ? fmtMass(amount) : fmtVol(amount);
  const lbl = chem.formula || chem.name;
  const kind = chem.kind;
  const heat = kind === "acid" || kind === "base";
  const addWord = kind === "acid" ? "axit" : kind === "base" ? "dung dịch kiềm" : "dung dịch gốc";

  // Nồng độ đích (không bao giờ cần d của dung dịch đích)
  const tgt = parseConc(tU, T.val, { mw, n, d: null });
  if (tgt.err) return err(tgt.err);
  if (tgt.need) return info(NEED_MSG[tgt.need]);

  const warns = [];
  const rows = [];
  let hero, steps, basis, anim;

  if (solid) {
    const pur = pF.val;
    let pure, weigh;
    if (tMass) {
      pure = amount * tgt.w;
      weigh = pure * 100 / pur;
      if (weigh > amount * (1 + 1e-12)) return err("Khối lượng chất rắn cần cân vượt khối lượng dung dịch cuối — nồng độ đích quá cao.");
      const water = amount - weigh;
      rows.push(["Chất tan tinh khiết cần có", fmtMass(pure)]);
      rows.push(["Chất rắn cần cân (đã hiệu chỉnh độ tinh khiết)", fmtMass(weigh)]);
      rows.push(["Dung môi (nước) cần thêm", fmtMass(water)]);
      rows.push(["Khối lượng dung dịch cuối", fmtMass(amount)]);
      steps = [
        `Cân chính xác ${fmtMass(weigh)} ${lbl} vào cốc đã cân bì (cân nhanh nếu chất hút ẩm).`,
        `Thêm ${fmtMass(water)} dung môi (nước cất) — cân trực tiếp để tổng khối lượng dung dịch đạt ${fmtMass(amount)}.`,
        `Khuấy đến tan hoàn toàn${heat ? "; để nguội nếu tỏa nhiệt" : ""}.`,
        LABEL_STEP
      ];
      basis = String.raw`$m_{\text{cân}}=\dfrac{w_{\text{đích}}\cdot m_{\text{cuối}}}{P/100}$ — với $P$ là độ tinh khiết (%).`;
      anim = { mode: "solid-mass", soluteAmount: weigh, soluteUnit: "g", solventAmount: water, finalMass: amount, finalVolume: null, soluteVolume: null };
    } else {
      pure = tgt.gL * amount / 1000;
      weigh = pure * 100 / pur;
      rows.push(["Nồng độ đích quy về", `${fmt(tgt.gL)} g/L`]);
      if (mw) rows.push(["Số mol chất tan", fmtMol(pure / mw)]);
      rows.push(["Chất tan tinh khiết cần có", fmtMass(pure)]);
      rows.push(["Chất rắn cần cân (đã hiệu chỉnh độ tinh khiết)", fmtMass(weigh)]);
      rows.push(["Thể tích cuối cần định mức", fmtVol(amount)]);
      steps = [
        `Cân chính xác ${fmtMass(weigh)} ${lbl} (cân nhanh nếu chất hút ẩm hoặc hấp thụ CO₂).`,
        `Cho vào cốc chứa khoảng 60–70% thể tích dung môi, khuấy đến tan hoàn toàn${heat ? ", để nguội về nhiệt độ phòng (hòa tan tỏa nhiệt)" : ""}.`,
        `Chuyển định lượng vào bình định mức ${fmtVol(amount)} (tráng cốc 2–3 lần), thêm dung môi sát vạch rồi nhỏ giọt đến vạch; đậy nút, đảo ngược ≥ 10 lần.`,
        LABEL_STEP
      ];
      basis = mw && (tU === "M" || tU === "mM" || tU === "N")
        ? String.raw`$m_{\text{cân}}=\dfrac{C_M\cdot V\cdot M}{P/100}$ — với $M$ là khối lượng mol của đúng công thức đang cân.`
        : String.raw`$m_{\text{cân}}=\dfrac{C\cdot V}{P/100}$ — với $C$ quy về g/L.`;
      anim = { mode: "solid-vol", soluteAmount: weigh, soluteUnit: "g", solventAmount: amount, finalMass: null, finalVolume: amount, soluteVolume: null };
    }
    if (weigh < 0.02) warns.push("Lượng cân rất nhỏ (< 20 mg) — sai số cân lớn. Nên tăng lượng dung dịch pha hoặc pha dung dịch đậm hơn rồi pha loãng.");
    if (chem.formula.includes("·")) warns.push(`${lbl} là muối ngậm nước — khối lượng mol đã tính cả nước kết tinh; không thay bằng muối khan.`);
    hero = { label: "Cân chất rắn", value: fmtMass(weigh), sub: `${lbl} → ${fmt(T.val)} ${UNITS[tU].sym} × ${finalTxt}` };
  } else {
    const sp = parseConc(sU, sF.val, { mw, n, d });
    if (sp.err) return err(sp.err);
    if (sp.need) return info(NEED_MSG[sp.need]);

    if (!tMass) {
      if (sp.gL == null) return info(NEED_MSG.d);
      if (tgt.gL > sp.gL * (1 + 1e-10)) return err(`Nồng độ đích (${fmt(tgt.gL)} g/L) lớn hơn dung dịch gốc (${fmt(sp.gL)} g/L) — không thể pha loãng để đạt nồng độ này.`);
      const Vs = tgt.gL * amount / sp.gL;
      rows.push(["Nồng độ gốc quy về", `${fmt(sp.gL)} g/L`]);
      rows.push(["Nồng độ đích quy về", `${fmt(tgt.gL)} g/L`]);
      rows.push(["Thể tích dung dịch gốc cần lấy", fmtVol(Vs)]);
      if (d) rows.push(["Khối lượng dung dịch gốc tương ứng", fmtMass(Vs * d)]);
      rows.push(["Thể tích cuối cần định mức", fmtVol(amount)]);
      if (mw) rows.push(["Số mol chất tan trong dung dịch cuối", fmtMol(tgt.gL * amount / 1000 / mw)]);
      rows.push(["Hệ số pha loãng", `${fmt(sp.gL / tgt.gL)} lần`]);
      steps = [
        `Chuẩn bị bình định mức ${fmtVol(amount)}; cho vào trước ${heat ? "khoảng một nửa thể tích" : "một phần"} dung môi (nước cất).`,
        `Dùng ${pipetHint(Vs)} lấy chính xác ${fmtVol(Vs)} ${lbl} gốc${heat ? `, rót ${addWord} từ từ dọc thành bình vào nước (không làm ngược lại), vừa rót vừa xoay nhẹ; chờ nguội nếu tỏa nhiệt` : " cho vào bình"}.`,
        `Để về nhiệt độ phòng, thêm dung môi sát vạch rồi nhỏ giọt đến vạch định mức; đậy nút, đảo ngược ≥ 10 lần.`,
        LABEL_STEP
      ];
      basis = String.raw`$V_{\text{gốc}}=\dfrac{C_{\text{đích}}\cdot V_{\text{cuối}}}{C_{\text{gốc}}}$ — hai nồng độ cùng quy về g/L.`;
      anim = { mode: "dilute-vol", soluteAmount: Vs, soluteUnit: "mL", solventAmount: amount - Vs, finalMass: null, finalVolume: amount, soluteVolume: Vs };
      if (Vs < 0.1) warns.push("Thể tích cần lấy quá nhỏ (< 0,1 mL) — khó đạt chính xác. Nên pha dung dịch trung gian (pha loãng 10–100 lần) rồi pha tiếp, hoặc tăng thể tích cuối.");
      hero = { label: "Lấy dung dịch gốc", value: fmtVol(Vs), sub: `${lbl} ${fmt(sF.val)} ${UNITS[sU].sym} → ${fmt(T.val)} ${UNITS[tU].sym} × ${finalTxt}` };
    } else {
      if (sp.w == null) return info(NEED_MSG.d);
      if (tgt.w > sp.w * (1 + 1e-10)) return err(`Nồng độ đích (${fmt(tgt.w * 100)}% w/w) lớn hơn dung dịch gốc (${fmt(sp.w * 100)}% w/w) — không thể pha loãng để đạt nồng độ này.`);
      const sol = amount * tgt.w;
      const Ms = sol / sp.w;
      const water = amount - Ms;
      rows.push(["Chất tan cần có", fmtMass(sol)]);
      rows.push(["Khối lượng dung dịch gốc cần lấy", fmtMass(Ms)]);
      if (d) rows.push(["Thể tích dung dịch gốc tương ứng", fmtVol(Ms / d)]);
      rows.push(["Khối lượng dung môi (nước) cần thêm", fmtMass(water)]);
      rows.push(["Khối lượng dung dịch cuối", fmtMass(amount)]);
      rows.push(["Hệ số pha loãng", `${fmt(sp.w / tgt.w)} lần`]);
      steps = [
        `Đặt bình/cốc sạch lên cân và tare.${heat ? ` Cho vào ${fmtMass(water)} nước cất trước (${addWord} luôn cho vào nước).` : ` Cho vào ${fmtMass(water)} dung môi (nước cất).`}`,
        `Thêm từ từ ${fmtMass(Ms)} ${lbl} gốc${d ? ` (≈ ${fmtVol(Ms / d)})` : ""}, khuấy nhẹ${heat ? "; chờ nguội nếu tỏa nhiệt" : ""}.`,
        `Kiểm tra tổng khối lượng dung dịch đạt ${fmtMass(amount)}; khuấy đều.`,
        LABEL_STEP
      ];
      basis = String.raw`$m_{\text{gốc}}=\dfrac{w_{\text{đích}}\cdot m_{\text{cuối}}}{w_{\text{gốc}}}$ — pha theo khối lượng, khối lượng có tính cộng.`;
      anim = { mode: "dilute-mass", soluteAmount: Ms, soluteUnit: "g", solventAmount: water, finalMass: amount, finalVolume: null, soluteVolume: d ? Ms / d : null };
      hero = { label: "Lấy dung dịch gốc", value: fmtMass(Ms), sub: `${lbl} ${fmt(sF.val)} ${UNITS[sU].sym} → ${fmt(T.val)} ${UNITS[tU].sym} × ${finalTxt}` };
    }
    if (chem.assay) warns.push("Nồng độ và khối lượng riêng mặc định chỉ là giá trị tham khảo — đối chiếu nhãn chai/SDS ở đúng nhiệt độ rồi chỉnh nếu khác.");
  }

  if (tU === "N" || sU === "N") warns.push(`Đang dùng hệ số đương lượng n = ${fmt(n)} eq/mol. N phụ thuộc phản ứng cụ thể — xác nhận n đúng với phản ứng của bạn.`);

  // Dung dịch đích ở các đơn vị khác (chỉ những đơn vị tính được mà không cần đoán d)
  const equiv = [];
  for (const u of UNIT_ORDER) {
    if (u === tU) continue;
    const r = fromConc(u, tgt, { mw, n, d: null });
    if (r.v != null) equiv.push(`${fmt(r.v)} ${UNITS[u].sym}`);
  }

  anim = { ...anim, chemId: inp.chem, soluteFormula: lbl, isAcid: kind === "acid", exothermic: heat, targetText: `${fmt(T.val)} ${UNITS[tU].sym}` };
  return { status: "ok", hero, rows, equiv, warns, steps, basis, anim };
}
