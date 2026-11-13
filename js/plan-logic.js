// ============ Logic thuần của kế hoạch & luồng thực hiện (không đụng DOM/Firebase) ============
import { uid } from "./utils.js";

export const END = "__END__";
export const OPS = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => Math.abs(a - b) < 1e-9,
  "!=": (a, b) => Math.abs(a - b) >= 1e-9
};
export const OP_LABELS = { "<": "<", "<=": "≤", ">": ">", ">=": "≥", "==": "=", "!=": "≠" };

/** Chuỗi → số (chấp nhận dấu phẩy thập phân). Không hợp lệ → NaN. */
export function parseNum(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(",", ".");
  if (s === "") return NaN;
  return Number(s);
}

export const newStep = () => ({
  id: uid("s"), title: "", text: "", images: [], assigned_role: "",
  observation: { enabled: true, label: "Hiện tượng quan sát thực tế" },
  explanation: { enabled: true, label: "Giải thích và PTPƯ minh họa" },
  require_input: null, require_photo: false, branch_logic: []
});
export const newSection = (name = "Phần mới") => ({ id: uid("p"), section_name: name, steps: [newStep()] });
export const newExperiment = () => ({
  schema_version: 2, title: "Bài thí nghiệm mới", description: "",
  created_at_ms: null, sections: [newSection("Chuẩn bị")]
});

/** Ảnh v1 là chuỗi URL, v2 là {file_id, url, name}: luôn trả về dạng object (hoặc null nếu rỗng). */
function normImage(im) {
  if (typeof im === "string") return im ? { file_id: "", url: im, name: "" } : null;
  if (im && typeof im === "object" && (im.url || im.file_id))
    return { file_id: im.file_id || "", url: im.url || "", name: im.name || "" };
  return null;
}

/** Dữ liệu thô (Firestore / file JSON nhập vào) → cấu trúc chuẩn, đảm bảo id duy nhất. */
export function normalizeExperiment(raw = {}) {
  const e = {
    schema_version: 2,
    title: raw.title ?? "", description: raw.description ?? "",
    created_at_ms: raw.created_at_ms || null, sections: []
  };
  const seen = new Set();
  const ensure = (id, p) => { let x = id; if (!x || seen.has(x)) x = uid(p); seen.add(x); return x; };
  (Array.isArray(raw.sections) ? raw.sections : []).forEach(sec => {
    const s = { id: ensure(sec.id, "p"), section_name: sec.section_name ?? "", steps: [] };
    (Array.isArray(sec.steps) ? sec.steps : []).forEach(st => {
      const ri = st.require_input;
      s.steps.push({
        id: ensure(st.id, "s"),
        title: st.title ?? "",
        text: st.text ?? "",
        images: (Array.isArray(st.images) ? st.images : []).map(normImage).filter(Boolean),
        assigned_role: st.assigned_role ?? "",
        observation: {
          enabled: st.observation?.enabled ?? true,
          label: st.observation?.label || "Hiện tượng quan sát thực tế"
        },
        explanation: {
          enabled: st.explanation?.enabled ?? true,
          label: st.explanation?.label || "Giải thích và PTPƯ minh họa"
        },
        require_input: ri && typeof ri === "object"
          ? { label: ri.label ?? "", unit: ri.unit ?? "", type: ri.type === "text" ? "text" : "number" }
          : (ri === true ? { label: "", unit: "", type: "number" } : null),
        require_photo: !!st.require_photo,
        branch_logic: Array.isArray(st.branch_logic)
          ? st.branch_logic.map(r => ({ op: r.op || "<", value: r.value ?? "", goto_step_id: r.goto_step_id || "" }))
          : []
      });
    });
    e.sections.push(s);
  });
  return e;
}

/** Cấu trúc đang soạn → dữ liệu sạch để ghi Firestore / xuất JSON. */
export function serializeExperiment(exp) {
  return {
    schema_version: 2,
    title: exp.title.trim(),
    description: exp.description.trim(),
    sections: exp.sections.map(sec => ({
      id: sec.id,
      section_name: sec.section_name.trim(),
      steps: sec.steps.map(s => ({
        id: s.id,
        title: s.title.trim(),
        text: s.text.trim(),
        images: [...s.images],
        assigned_role: s.assigned_role || "",
        observation: { enabled: !!s.observation?.enabled, label: s.observation?.label?.trim() || "Hiện tượng quan sát thực tế" },
        explanation: { enabled: !!s.explanation?.enabled, label: s.explanation?.label?.trim() || "Giải thích và PTPƯ minh họa" },
        require_input: s.require_input
          ? { label: s.require_input.label.trim(), unit: s.require_input.unit.trim(), type: s.require_input.type }
          : null,
        require_photo: !!s.require_photo,
        branch_logic: s.require_input && s.require_input.type === "number"
          ? s.branch_logic.map(r => ({ op: r.op, value: parseNum(r.value), goto_step_id: r.goto_step_id }))
          : []
      }))
    }))
  };
}

/** Làm phẳng sections → danh sách bước theo thứ tự thực hiện, kèm nhãn "2.3". */
export function flatten(exp) {
  const out = [];
  exp.sections.forEach((sec, si) => sec.steps.forEach((step, ti) =>
    out.push({ step, sec, si, ti, label: `${si + 1}.${ti + 1}`, index: out.length })));
  return out;
}

/** Kiểm tra hợp lệ trước khi lưu. Trả về [{msg, stepId}]. */
export function validatePlan(exp) {
  const errs = [];
  const add = (msg, stepId = null) => errs.push({ msg, stepId });
  if (!exp.title.trim()) add("Chưa đặt tên bài thí nghiệm.");
  if (!exp.sections.length) add("Cần ít nhất 1 phần.");
  exp.sections.forEach((sec, si) => {
    if (!sec.section_name.trim()) add(`Phần ${si + 1}: chưa đặt tên.`);
    if (!sec.steps.length) add(`Phần ${si + 1}: chưa có bước nào.`);
  });
  const flat = flatten(exp);
  const idx = new Map(flat.map(f => [f.step.id, f.index]));
  flat.forEach(f => {
    const s = f.step, L = `Bước ${f.label}`;
    if (!s.text.trim()) add(`${L}: chưa có nội dung hướng dẫn.`, s.id);
    const ri = s.require_input;
    if (ri && !ri.label.trim()) add(`${L}: hãy nhập tên đại lượng cần thu thập.`, s.id);
    if (s.branch_logic.length) {
      if (!ri || ri.type !== "number") {
        add(`${L}: rẽ nhánh chỉ dùng được khi thu thập dữ liệu kiểu số.`, s.id);
        return;
      }
      s.branch_logic.forEach((r, k) => {
        const R = `${L}, điều kiện ${k + 1}`;
        if (!OPS[r.op]) add(`${R}: toán tử không hợp lệ.`, s.id);
        if (Number.isNaN(parseNum(r.value))) add(`${R}: giá trị so sánh X phải là số.`, s.id);
        if (!r.goto_step_id) add(`${R}: chưa chọn bước đích.`, s.id);
        else if (r.goto_step_id !== END) {
          const t = idx.get(r.goto_step_id);
          if (t === undefined) add(`${R}: bước đích không tồn tại (đã bị xóa).`, s.id);
          else if (t <= f.index) add(`${R}: bước đích phải nằm SAU bước hiện tại (không cho nhảy ngược).`, s.id);
        }
      });
    }
  });
  return errs;
}

/** Áp dụng rẽ nhánh của một bước với giá trị đã nhập. Trả về id bước đích | END | null. */
export function resolveBranch(step, log) {
  if (!step.require_input || step.require_input.type !== "number" || !step.branch_logic?.length) return null;
  const v = parseNum(log?.input_data);
  if (Number.isNaN(v)) return null;
  for (const r of step.branch_logic) {
    const fn = OPS[r.op];
    const x = parseNum(r.value);
    if (fn && !Number.isNaN(x) && fn(v, x)) return r.goto_step_id || null;
  }
  return null;
}

/**
 * Tính trạng thái từng bước; các bước chưa làm đều có thể thực hiện độc lập.
 */
export function computeFlow(exp, logs) {
  const flat = flatten(exp);
  const status = {};
  flat.forEach(f => { status[f.step.id] = logs[f.step.id] ? "done" : "pending"; });
  const currentId = flat.find(f => status[f.step.id] !== "done")?.step.id || null;
  if (currentId) status[currentId] = "current";
  const done = flat.filter(f => status[f.step.id] === "done").length;
  const active = flat.length;
  return { status, currentId, finished: currentId === null && flat.length > 0, done, active, flat };
}