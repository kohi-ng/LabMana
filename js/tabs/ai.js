// ============ Tab AI — cửa sổ chat Gemini (kiểu Gemini), đọc cấu hình từ Firestore config/gemini ============
import { state } from "../store.js";
import { db, ready, isConfigured } from "../firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, snippet, richHtml, renderMath } from "../utils.js";
import { normalizeExperiment, secTagSp } from "../plan-logic.js";
import * as sop from "./sop.js";
import * as calc from "./calc.js";

const LS_CFG = "labmana_gemini_config";
const LS_MODEL = "labmana_ai_model";
const LS_CTX = "labmana_ai_ctx";
const LS_TUNE = "labmana_ai_tuning";   // { [modelId]: { turns, temperature, maxOutputTokens, thinkingBudget } } — chỉ lưu phần người dùng đã chỉnh
const DEFAULT_TURNS = 3;        // 1 lượt = 1 câu hỏi + 1 câu trả lời → 3 lượt = 6 phần tử user/model
// Thứ tự ưu tiên từ cao xuống thấp — cũng là thứ tự hạ cấp khi quá tải
const CASCADE = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];
// Mặc định theo từng dòng: model càng mạnh càng cho phép suy luận ngầm sâu + trả lời dài; dòng lite tắt/giảm suy luận để nhanh, ít tốn lượt.
// Lưu ý: token suy luận tính vào maxOutputTokens → luôn để maxOutputTokens lớn hơn thinkingBudget ít nhất ~2000 để câu trả lời không bị cắt.
const MODEL_DEFAULTS = {
  "gemini-3.8-flash":       { temperature: 0.2,  maxOutputTokens: 3072, thinkingBudget: 512 },
  "gemini-3.6-flash":       { temperature: 0.25, maxOutputTokens: 3072, thinkingBudget: 256 },
  "gemini-3-flash-preview": { temperature: 0.25, maxOutputTokens: 2048, thinkingBudget: 256 },
  "gemini-3.1-flash-lite":  { temperature: 0.3,  maxOutputTokens: 2048, thinkingBudget: 128 },
  "gemini-3.5-flash-lite":  { temperature: 0.3,  maxOutputTokens: 1536, thinkingBudget: 128 }
};
const FALLBACK_STATUS = new Set([429, 500, 503]);
const TURN_CHOICES = [1, 3, 5, 10];
const TOKEN_CHOICES = [1024, 2048, 3072, 4096];
const THINK_CHOICES = [[0, "Tắt (0)"], [128, "Nhẹ (128)"], [256, "Vừa (256)"], [512, "Sâu (512)"]];
const CTX_CHAR_LIMIT = 6000;

const SYSTEM_BASE = "Bạn là trợ lý thực hành hóa học tại bàn thí nghiệm (LabMana). Trả lời ngắn gọn, thực chiến, gạch đầu dòng rõ ràng để đọc lướt trên điện thoại. Luôn đặt CẢNH BÁO AN TOÀN lên dòng đầu tiên nếu liên quan axit/kiềm đặc, chất oxy hóa mạnh hoặc phản ứng tỏa nhiệt.";

let root, el = {};
let config = null, configPromise = null;
let selectedModel = lsGet(LS_MODEL) || null;
let ctxOn = lsGet(LS_CTX) !== "0";
let ctxSel = null;              // null = tự động (bước đang xem + thông số Pha chế); Set = người dùng tự chọn
let popOpen = false, advOpen = false, busy = false;
let tuning = loadTuning();
const messages = [];            // {role: "user"|"model", text, error?, failed?}

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
/** Ép kiểu số (Firestore có thể lưu "2048" dạng chuỗi); rỗng/không hợp lệ → mặc định. */
function num(v, d) {
  if (v === "" || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function loadTuning() {
  try {
    const t = JSON.parse(lsGet(LS_TUNE) || "{}");
    return t && typeof t === "object" && !Array.isArray(t) ? t : {};
  } catch { return {}; }
}
const saveTuning = () => lsSet(LS_TUNE, JSON.stringify(tuning));

/** Thông số chuẩn của mô hình (chưa tính tùy chỉnh cá nhân). Model lạ → dùng giá trị chung từ config/gemini. */
function baseParams(model) {
  const d = MODEL_DEFAULTS[model];
  return {
    turns: DEFAULT_TURNS,
    temperature: d ? d.temperature : num(config?.temperature, 0.3),
    maxOutputTokens: d ? d.maxOutputTokens : num(config?.maxOutputTokens, 2048),
    thinkingBudget: d ? d.thinkingBudget : (config?.thinkingBudget ?? null)
  };
}
/** Thông số hiệu lực = chuẩn của model + phần người dùng đã chỉnh riêng cho model đó. */
function paramsFor(model) {
  const o = tuning[model] || {};
  const p = baseParams(model);
  if (Number.isFinite(o.turns)) p.turns = clamp(Math.round(o.turns), 1, 10);
  if (Number.isFinite(o.temperature)) p.temperature = clamp(o.temperature, 0, 1);
  if (Number.isFinite(o.maxOutputTokens)) p.maxOutputTokens = clamp(Math.round(o.maxOutputTokens), 64, 32768);
  if (Number.isFinite(o.thinkingBudget)) p.thinkingBudget = clamp(Math.round(o.thinkingBudget), 0, 24576);
  return p;
}
function setTuning(model, key, value) {
  tuning[model] = { ...(tuning[model] || {}), [key]: value };
  saveTuning();
}

/* ------------------------------ Cấu hình Gemini ------------------------------ */
function readCache() {
  try {
    const c = JSON.parse(lsGet(LS_CFG) || "null");
    return c && c.apiKey ? c : null;
  } catch { return null; }
}

/** Đọc config/gemini: ưu tiên cache localStorage, chỉ hỏi Firestore khi chưa có cache (hoặc force). */
async function loadConfig(force = false) {
  if (!force) {
    const cached = readCache();
    if (cached) { config = cached; return config; }
  }
  if (configPromise) return configPromise;
  configPromise = (async () => {
    if (!isConfigured) throw new Error("Chưa cấu hình Firebase.");
    await ready;
    const snap = await getDoc(doc(db, "config", "gemini"));
    if (!snap.exists()) throw new Error("Chưa có tài liệu config/gemini trên Firestore.");
    const d = snap.data() || {};
    if (!d.apiKey) throw new Error("config/gemini chưa có apiKey.");
    const models = Array.isArray(d.models) && d.models.length ? d.models.map(String) : [d.activeModel || CASCADE[0]];
    config = {
      apiKey: String(d.apiKey),
      activeModel: String(d.activeModel || models[0]),
      models,
      temperature: num(d.temperature, 0.25),
      maxOutputTokens: num(d.maxOutputTokens, 2048),
      thinkingBudget: d.thinkingBudget == null || d.thinkingBudget === "" ? null : num(d.thinkingBudget, null)
    };
    lsSet(LS_CFG, JSON.stringify(config));
    return config;
  })();
  try { return await configPromise; } finally { configPromise = null; }
}

/** 5 mô hình chuẩn theo thứ tự ưu tiên, cộng thêm mô hình lạ nếu config/gemini có khai báo. */
function modelList() {
  const extra = (config?.models || []).filter(m => m !== "gemini-3-flash" && !CASCADE.includes(m));
  return [...CASCADE, ...extra];
}
function currentModel() {
  const list = modelList();
  if (selectedModel === "gemini-3-flash") selectedModel = "gemini-3-flash-preview";
  if (!selectedModel || !list.includes(selectedModel)) {
    selectedModel = config && list.includes(config.activeModel) ? config.activeModel : CASCADE[1];
  }
  return selectedModel;
}

/** "gemini-3.8-flash" → "3.8 Flash"; "gemini-3.5-flash-lite" → "3.5 Lite". */
function shortName(id) {
  const parts = String(id || "").replace(/^gemini-/, "").split("-");
  const ver = parts.shift() || "";
  const rest = parts.map(w => w ? w[0].toUpperCase() + w.slice(1) : w);
  if (rest.length === 2 && rest[0] === "Flash" && rest[1] === "Lite") return `${ver} Lite`;
  return [ver, ...rest].filter(Boolean).join(" ");
}

/* ------------------------------ Ngữ cảnh ------------------------------ */
const plain = t => String(t ?? "").replace(/\s+/g, " ").trim();

function ctxOptions() {
  const opts = [];
  const bt = calc.getContextText();
  if (bt) opts.push({ id: "bartender", group: "Pha chế", label: "Thông số hóa chất đang pha", text: `[Tab Pha chế]\n${bt}` });

  const raw = state.experiments.find(e => e.id === state.activeRun?.exp_id);
  if (raw) {
    const exp = normalizeExperiment(raw);
    exp.sections.forEach((sec, si) => {
      const secName = plain(sec.section_name) || (si === 0 ? "Chuẩn bị" : `Thí nghiệm ${si}`);
      sec.steps.forEach((step, ti) => {
        const label = `${si}.${ti + 1}`;
        const log = state.logs[step.id];
        const lines = [`[Bài: ${plain(exp.title)} · ${secTagSp(si)}: ${secName} · Bước ${label}]`];
        if (step.title) lines.push(`Tiêu đề: ${plain(step.title)}`);
        if (step.text) lines.push(`Nội dung: ${String(step.text).trim()}`);
        if (log) {
          if (log.input_data != null && log.input_data !== "") lines.push(`Số liệu đã ghi: ${log.input_data} ${log.input_unit || ""}`.trim());
          if (log.observation_text) lines.push(`Hiện tượng đã ghi: ${log.observation_text}`);
        }
        opts.push({
          id: "step:" + step.id,
          group: `${secTagSp(si)} · ${secName}`,
          label: `${label} ${step.title ? plain(step.title) : snippet(step.text, 50)}`,
          text: lines.join("\n"),
          si, ti, num: label, secTag: secTagSp(si), short: step.title ? plain(step.title) : snippet(step.text, 40),
          stepId: step.id
        });
      });
    });
  }
  return opts;
}

function effectiveSelection(opts) {
  if (ctxSel) return new Set([...ctxSel].filter(id => opts.some(o => o.id === id)));
  const auto = new Set();
  if (opts.some(o => o.id === "bartender")) auto.add("bartender");
  const cur = sop.isExperimentOpen() ? sop.getSelection().stepId : null;
  if (cur && opts.some(o => o.id === "step:" + cur)) auto.add("step:" + cur);
  return auto;
}

function buildSystemInstruction() {
  if (!ctxOn) return SYSTEM_BASE;
  const opts = ctxOptions();
  const sel = effectiveSelection(opts);
  let blocks = opts.filter(o => sel.has(o.id)).map(o => o.text);
  if (!blocks.length) return SYSTEM_BASE;
  let joined = blocks.join("\n\n");
  if (joined.length > CTX_CHAR_LIMIT) joined = joined.slice(0, CTX_CHAR_LIMIT) + "…";
  return `${SYSTEM_BASE}\n\nNGỮ CẢNH ĐANG LÀM TRÊN LABMANA (dùng để trả lời sát thực tế):\n${joined}`;
}

/* ------------------------------ Gọi Gemini ------------------------------ */
function buildContents(turns) {
  const ok = messages.filter(m => !m.error && !m.failed);
  let tail = ok.slice(-turns * 2);
  while (tail.length && tail[0].role !== "user") tail = tail.slice(1);
  return tail.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
}

/** Một lần gọi tới đúng một mô hình, với bộ thông số của mô hình đó. */
async function requestOnce(model) {
  const p = paramsFor(model);
  const generationConfig = { temperature: p.temperature, maxOutputTokens: p.maxOutputTokens };
  if (p.thinkingBudget != null) generationConfig.thinkingConfig = { thinkingBudget: p.thinkingBudget };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemInstruction() }] },
      contents: buildContents(p.turns),
      generationConfig
    })
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    const err = new Error(`Lỗi ${res.status}${detail ? ": " + detail : ""}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map(part => part.text || "").join("").trim();
  if (!text) {
    if (data.promptFeedback?.blockReason) throw new Error("Câu hỏi bị chặn bởi bộ lọc an toàn của Gemini.");
    throw new Error("AI không trả về nội dung. Thử hỏi lại ngắn gọn hơn.");
  }
  return cand.finishReason === "MAX_TOKENS" ? text + " …" : text;
}

/** Danh sách thử lần lượt: mô hình đang chọn rồi các mô hình thấp hơn trong CASCADE. */
function cascadeFrom(start) {
  const i = CASCADE.indexOf(start);
  return i < 0 ? [start, ...CASCADE] : CASCADE.slice(i);
}

/** Gọi Gemini; gặp 503/429/500 thì trượt xuống mô hình thấp hơn kế tiếp cho tới khi thành công. */
async function callGemini() {
  if (!config) await loadConfig();
  const order = cascadeFrom(currentModel());
  let firstFail = null, refreshed = false;
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    try {
      const text = await requestOnce(model);
      const note = firstFail
        ? `${shortName(firstFail.model)} ${firstFail.status === 429 ? "đã hết lượt gọi" : "đang quá tải"}, chuyển sang trả lời bởi ${shortName(model)}`
        : "";
      return { text, note };
    } catch (err) {
      // Khóa/mô hình trong cache có thể đã đổi: tải lại cấu hình từ Firestore đúng 1 lần rồi thử lại cùng mô hình.
      if (!refreshed && [400, 401, 403, 404].includes(err.status)) {
        refreshed = true;
        const before = JSON.stringify(config);
        try {
          await loadConfig(true);
          if (JSON.stringify(config) !== before) { i--; continue; }
        } catch { /* dùng lỗi gốc */ }
      }
      if (FALLBACK_STATUS.has(err.status) && i < order.length - 1) {
        firstFail = firstFail || { model, status: err.status };
        continue;
      }
      throw err;
    }
  }
}


/* ------------------------------ AI Compose cho Kế hoạch ------------------------------ */
const FORMAT_INSTRUCTION = [
  "ĐỊNH DẠNG BẮT BUỘC TƯƠNG THÍCH VỚI BỘ HIỂN THỊ LABMANA:",
  "Cấm tiêu đề Markdown bằng dấu thăng #, ##, ###, ####, ##### hoặc ###### ở đầu dòng. Thay tiêu đề bằng *Tiêu đề mục*.",
  "Không dùng **hai dấu sao**. Chỉ dùng một cặp dấu sao *in đậm*.",
  "Cú pháp hỗ trợ: *in đậm*; dòng danh sách bắt đầu bằng '- '; bảng Markdown chuẩn dạng | Cột 1 | Cột 2 | với hàng phân cách | --- | --- |; công thức hóa học trong $...$ hoặc $\\ce{H2SO4}$.",
  "Không dùng code fence, HTML, blockquote hoặc cú pháp Markdown khác. Giữ nguyên dấu $, dấu gạch đứng của bảng và dấu gạch đầu dòng.",
  "Không tự đặt tiêu đề tổng quát, tiêu đề dài dòng, lời dẫn nhập hoặc kết luận hình thức; đi thẳng vào nội dung cần thiết. Chỉ dùng tiêu đề mục ngắn khi thật sự giúp phân chia nội dung. Tập trung vào thông tin, thao tác và dữ liệu cụ thể.",
  "Chỉ xuất nội dung SOP hoàn chỉnh, không chào hỏi hoặc giải thích ngoài nội dung."
].join("\n");


export async function getPlannerComposeSettings(requestedModel = null) {
  if (!config) await loadConfig();
  const models = modelList();
  const model = requestedModel && models.includes(requestedModel) ? requestedModel : currentModel();
  const p = paramsFor(model);
  return { models, model, maxOutputTokens: p.maxOutputTokens, thinkingBudget: p.thinkingBudget ?? 256, temperature: p.temperature };
}
export function setPlannerComposeTuning(model, key, value) { setTuning(model, key, value); }
export function resetPlannerComposeTuning(model) { delete tuning[model]; saveTuning(); }

/** Gọi Gemini cho một tác vụ độc lập, vẫn dùng thứ tự Cascade chung của tab AI. */
export async function composeForPlanner({ prompt, context = "", systemInstruction = "", model, maxOutputTokens = 2048, thinkingBudget = 256, temperature = 0.25 }) {
  if (!config) await loadConfig();
  const startModel = model || currentModel();
  const order = cascadeFrom(startModel);
  let firstFail = null;
  for (let i = 0; i < order.length; i++) {
    const active = order[i];
    const generationConfig = {
      temperature: clamp(num(temperature, 0.25), 0, 1),
      maxOutputTokens: clamp(Math.round(num(maxOutputTokens, 2048)), 64, 32768)
    };
    const budget = clamp(Math.round(num(thinkingBudget, 256)), 0, 24576);
    if (budget > 0) generationConfig.thinkingConfig = { thinkingBudget: budget };
    const instruction = ["Bạn là trợ lý soạn thảo SOP thí nghiệm hóa học LabMana. Viết chính xác, thực tế, rõ ràng và bám sát ngữ cảnh được cung cấp.", FORMAT_INSTRUCTION, systemInstruction].filter(Boolean).join("\n\n");
    const userText = [context ? "NGỮ CẢNH BÀI THÍ NGHIỆM:\n" + context : "", "YÊU CẦU SOẠN THẢO:\n" + String(prompt || "").trim()].filter(Boolean).join("\n\n");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(active)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig
        })
      });
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
        const err = new Error(`Lỗi ${res.status}${detail ? ": " + detail : ""}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map(part => part.text || "").join("").trim();
      if (!text) {
        if (data.promptFeedback?.blockReason) throw new Error("Yêu cầu bị chặn bởi bộ lọc an toàn của Gemini.");
        throw new Error("AI không trả về nội dung. Hãy thử prompt ngắn và rõ hơn.");
      }
      const note = firstFail ? `${shortName(firstFail.model)} quá tải (HTTP ${firstFail.status}), đã chuyển sang ${shortName(active)}.` : "";
      return { text, note, model: active };
    } catch (err) {
      if ([429, 503, 500].includes(err.status) && i < order.length - 1) {
        firstFail = firstFail || { model: active, status: err.status };
        continue;
      }
      throw err;
    }
  }
  throw new Error("Không có mô hình Gemini nào khả dụng.");
}

/* ------------------------------ Hiển thị tin nhắn ------------------------------ */
/** Dùng chung bộ Markdown của Planner để bảng, tiêu đề và định dạng đồng nhất. */
function mdToHtml(text) {
  return richHtml(text);
}

function renderMessages() {
  const nearBottom = el.scroll.scrollHeight - el.scroll.scrollTop - el.scroll.clientHeight < 120;
  if (!messages.length && !busy) {
    el.list.innerHTML = `<div class="ai-empty"><b>Hỏi AI</b><span>Trợ lý hóa học tại bàn thí nghiệm. Bật “Chèn ngữ cảnh” để AI biết bạn đang làm bước nào.</span></div>`;
    return;
  }
  el.list.innerHTML = messages.map(m => {
    if (m.role === "user") return `<div class="ai-msg user"><div class="ai-bubble">${esc(m.text).replace(/\n/g, "<br>")}</div></div>`;
    if (m.error) return `<div class="ai-msg model error"><div class="ai-text">${esc(m.text)}</div></div>`;
    return `<div class="ai-msg model"><div class="ai-text">${mdToHtml(m.text)}${m.note ? `<div class="ai-note">${esc(m.note)}</div>` : ""}</div></div>`;
  }).join("") + (busy ? `<div class="ai-msg model"><div class="ai-typing" aria-label="Đang trả lời"><i></i><i></i><i></i></div></div>` : "");
  renderMath(el.list);
  if (nearBottom || busy || messages.at(-1)?.role === "user") el.scroll.scrollTop = el.scroll.scrollHeight;
}

/* ------------------------------ Thanh nhập & popover ------------------------------ */
function updateBar() {
  const model = currentModel();
  el.model.innerHTML = `<span class="ai-dot ${ctxOn ? "on" : ""}" title="${ctxOn ? "Đang chèn ngữ cảnh" : "Không chèn ngữ cảnh"}"></span><span>${esc(model ? shortName(model) : "AI")}</span><span class="chev" aria-hidden="true"></span>`;
  el.model.setAttribute("aria-expanded", String(popOpen));
  el.send.disabled = busy || !el.input.value.trim();
}

const chip = (key, val, label, on) =>
  `<button type="button" class="ai-chip ${on ? "on" : ""}" data-act="set" data-key="${key}" data-val="${val}" aria-pressed="${on}">${esc(label)}</button>`;

function advancedHtml(model) {
  const p = paramsFor(model);
  return `<div class="ai-adv">
    <div class="ai-adv-title">Tinh chỉnh cho <b>${esc(shortName(model))}</b></div>
    <div class="ai-field"><div class="ai-field-h"><span>Lượt hội thoại</span><em>${p.turns} lượt · ${p.turns * 2} tin</em></div>
      <div class="ai-chips">${TURN_CHOICES.map(n => chip("turns", n, String(n), p.turns === n)).join("")}</div></div>
    <div class="ai-field"><div class="ai-field-h"><span>maxOutputTokens</span>
      <input type="number" class="ai-num" data-act="tokens" min="64" max="32768" step="128" value="${p.maxOutputTokens}" aria-label="maxOutputTokens"></div>
      <div class="ai-chips">${TOKEN_CHOICES.map(n => chip("maxOutputTokens", n, String(n), p.maxOutputTokens === n)).join("")}</div></div>
    <div class="ai-field"><div class="ai-field-h"><span>Suy luận ngầm (thinkingBudget)</span><em>${p.thinkingBudget ?? "mặc định"}</em></div>
      <div class="ai-chips">${THINK_CHOICES.map(([n, l]) => chip("thinkingBudget", n, l, p.thinkingBudget === n)).join("")}</div></div>
    <div class="ai-field"><div class="ai-field-h"><span>Sáng tạo (temperature)</span><em class="ai-temp-val">${p.temperature.toFixed(2)}</em></div>
      <input type="range" class="ai-range" data-act="temp" min="0" max="1" step="0.05" value="${p.temperature}" aria-label="temperature"></div>
    <div class="ai-pop-foot"><button type="button" class="link-btn" data-act="reset">Mặc định</button><span class="ai-pop-note">Đưa mọi mô hình về thông số chuẩn</span></div>
  </div>`;
}

/** Dạng caro: mỗi phần (CB, TN1, TN2…) là một cột; các bước 0.1, 0.2… / 1.1, 1.2… xổ dọc xuống, mỗi ô có tick.
 *  Tiêu đề cột bấm để chọn/bỏ cả phần. Bên dưới là nội dung chữ của các bước đã tick. */
function ctxGridHtml(stepOpts, sel) {
  if (!stepOpts.length) return "";
  const cols = [];
  stepOpts.forEach(o => { (cols[o.si] ||= { si: o.si, tag: o.secTag, name: o.group.split(" · ").slice(1).join(" · "), items: [] }).items.push(o); });
  const live = cols.filter(Boolean);
  const grid = live.map(c => {
    const n = c.items.filter(o => sel.has(o.id)).length;
    return `<div class="ai-ctx-col"><button type="button" class="ai-ctx-colh ${n === c.items.length ? "all" : ""}" data-act="ctx-col" data-sec="${c.si}" title="${esc(c.name)} — bấm để chọn/bỏ cả cột">
      <b>${esc(c.tag)}</b><small>${n}/${c.items.length}</small></button>` +
      c.items.map(o => `<label class="ai-ctx-cell ${sel.has(o.id) ? "on" : ""}" title="${esc(o.num + " " + o.short)}"><input type="checkbox" data-act="ctx-item" data-id="${esc(o.id)}" ${sel.has(o.id) ? "checked" : ""}>
        <span class="ai-ctx-num">${esc(o.num)}</span><span class="ai-ctx-short">${esc(o.short)}</span></label>`).join("") + `</div>`;
  }).join("");
  const picked = stepOpts.filter(o => sel.has(o.id));
  const clip = t => { const s = String(t).replace(/^\[[^\]]*\]\n?/, "").trim(); return s.length > 320 ? s.slice(0, 320) + "…" : s; };
  const preview = picked.length
    ? `<div class="ai-ctx-prev-h">Nội dung gửi kèm (${picked.length} bước)</div><div class="ai-ctx-prev">${picked.map(o => `<div class="ai-ctx-prev-i"><b>${esc(o.num)}</b><span>${esc(clip(o.text))}</span></div>`).join("")}</div>`
    : `<div class="ai-ctx-prev-h">Chưa tick bước nào — bấm vào ô số bước để chèn nội dung bên dưới.</div>`;
  return `<div class="ai-ctx-gridwrap"><div class="ai-ctx-grid">${grid}</div></div>${preview}`;
}

function renderPop() {
  el.pop.hidden = !popOpen;
  el.backdrop.hidden = !popOpen;
  if (!popOpen) return;
  const keepPop = el.pop.scrollTop;
  const gw = el.pop.querySelector(".ai-ctx-gridwrap"), keepGrid = gw ? [gw.scrollTop, gw.scrollLeft] : [0, 0];
  const pv = el.pop.querySelector(".ai-ctx-prev"), keepPrev = pv?.scrollTop || 0;
  const models = modelList();
  const cur = currentModel();
  let html = `<div class="ai-pop-h">Mô hình</div>${models.map(m =>
    `<button type="button" class="ai-opt ${m === cur ? "on" : ""}" data-act="model" data-val="${esc(m)}" role="menuitemradio" aria-checked="${m === cur}"><span>${esc(shortName(m))}</span><i>${m === cur ? "✓" : ""}</i></button>`
  ).join("")}
    <div class="ai-pop-sep"></div>
    <div class="ai-switch-row"><span>Chèn ngữ cảnh</span>
      <button type="button" class="ai-switch ${ctxOn ? "on" : ""}" role="switch" aria-checked="${ctxOn}" data-act="ctx-toggle" aria-label="Chèn ngữ cảnh"><i></i></button></div>`;
  if (ctxOn) {
    const opts = ctxOptions();
    const sel = effectiveSelection(opts);
    if (!opts.length) {
      html += `<div class="ai-pop-note">Chưa có gì để đính kèm. Mở một bài ở tab Quy trình hoặc nhập thông số ở tab Pha chế.</div>`;
    } else {
      html += `<div class="ai-pop-h">Chọn mục gửi kèm <small>${sel.size}/${opts.length}</small></div>`;
      const bt = opts.find(o => o.id === "bartender");
      if (bt) html += `<div class="ai-ctx-list"><div class="ai-ctx-group">Pha chế</div><label class="ai-ctx-item"><input type="checkbox" data-act="ctx-item" data-id="${esc(bt.id)}" ${sel.has(bt.id) ? "checked" : ""}><span>${richHtml(bt.label)}</span></label></div>`;
      html += ctxGridHtml(opts.filter(o => o.stepId), sel);
      html += `<div class="ai-pop-foot"><button type="button" class="link-btn" data-act="ctx-auto">Tự động (bước đang xem)</button><button type="button" class="link-btn muted" data-act="ctx-none">Bỏ chọn hết</button></div>`;
    }
  } else {
    html += `<div class="ai-pop-note">Đang tắt: AI chỉ trả lời như trợ lý hóa học chung, không biết bạn đang làm bước nào.</div>`;
  }
  html += `<div class="ai-pop-sep"></div>
    <button type="button" class="ai-adv-btn" data-act="adv" aria-expanded="${advOpen}"><span>Tinh chỉnh sâu</span><span class="chev" aria-hidden="true"></span></button>
    ${advOpen ? advancedHtml(cur) : ""}`;
  el.pop.innerHTML = html;
  renderMath(el.pop);
  const gw2 = el.pop.querySelector(".ai-ctx-gridwrap"); if (gw2) { gw2.scrollTop = keepGrid[0]; gw2.scrollLeft = keepGrid[1]; }
  const pv2 = el.pop.querySelector(".ai-ctx-prev"); if (pv2) pv2.scrollTop = keepPrev;
  el.pop.scrollTop = keepPop;
}

function setPop(open) {
  popOpen = open;
  renderPop(); updateBar();
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 140) + "px";
}

async function send() {
  const text = el.input.value.trim();
  if (!text || busy) return;
  messages.push({ role: "user", text });
  el.input.value = ""; autoGrow();
  busy = true; popOpen = false;
  renderPop(); updateBar(); renderMessages();
  const asked = messages.at(-1);
  try {
    if (!config) await loadConfig();
    updateBar();
    const reply = await callGemini();
    messages.push({ role: "model", text: reply.text, note: reply.note });
  } catch (err) {
    console.error(err);
    asked.failed = true;   // không đưa câu hỏi lỗi vào lịch sử gửi đi
    messages.push({ role: "model", error: true, text: err.message || "Không gọi được AI." });
  } finally {
    busy = false;
    updateBar(); renderMessages();
  }
}

/* ------------------------------ Khởi tạo ------------------------------ */
export function init(host) {
  root = host;
  root.innerHTML = `<div class="ai-chat">
    <div class="ai-scroll" id="ai-scroll"><div class="ai-list" id="ai-list"></div></div>
    <div class="ai-dock">
      <div class="ai-backdrop" id="ai-backdrop" hidden></div>
      <div class="ai-pop" id="ai-pop" role="menu" hidden></div>
      <div class="ai-bar">
        <textarea id="ai-input" rows="1" placeholder="Hỏi AI..." autocomplete="off" enterkeyhint="send"></textarea>
        <div class="ai-bar-row">
          <button type="button" class="ai-model" id="ai-model" data-act="pop" aria-haspopup="menu" aria-expanded="false"></button>
          <button type="button" class="ai-send" id="ai-send" data-act="send" aria-label="Gửi" disabled>➤</button>
        </div>
      </div>
    </div>
  </div>`;
  el = {
    scroll: root.querySelector("#ai-scroll"), list: root.querySelector("#ai-list"),
    pop: root.querySelector("#ai-pop"), backdrop: root.querySelector("#ai-backdrop"),
    input: root.querySelector("#ai-input"), model: root.querySelector("#ai-model"), send: root.querySelector("#ai-send")
  };

  el.input.addEventListener("input", () => { autoGrow(); updateBar(); });
  el.input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); }
  });
  el.backdrop.addEventListener("click", () => setPop(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && popOpen) setPop(false); });

  root.addEventListener("click", e => {
    const t = e.target.closest("[data-act]");
    if (!t || t.tagName === "INPUT") return;
    switch (t.dataset.act) {
      case "send": return send();
      case "pop": return setPop(!popOpen);
      case "model":
        selectedModel = t.dataset.val; lsSet(LS_MODEL, selectedModel);
        renderPop(); updateBar(); break;
      case "ctx-toggle":
        ctxOn = !ctxOn; lsSet(LS_CTX, ctxOn ? "1" : "0");
        renderPop(); updateBar(); break;
      case "adv": advOpen = !advOpen; renderPop(); break;
      case "set": setTuning(currentModel(), t.dataset.key, Number(t.dataset.val)); renderPop(); break;
      case "reset":
        tuning = {}; saveTuning(); renderPop(); break;
      case "ctx-auto": ctxSel = null; renderPop(); break;
      case "ctx-none": ctxSel = new Set(); renderPop(); break;
      case "ctx-col": {   // chọn / bỏ cả một cột (CB, TN1…)
        const opts = ctxOptions(), ids = opts.filter(o => o.stepId && String(o.si) === t.dataset.sec).map(o => o.id);
        const sel = new Set(effectiveSelection(opts)), all = ids.every(id => sel.has(id));
        ids.forEach(id => all ? sel.delete(id) : sel.add(id));
        ctxSel = sel; renderPop(); break;
      }
    }
  });
  root.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset?.act !== "temp") return;
    const v = clamp(num(t.value, 0.3), 0, 1);
    setTuning(currentModel(), "temperature", v);
    const out = el.pop.querySelector(".ai-temp-val");
    if (out) out.textContent = v.toFixed(2);
  });
  root.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset?.act === "tokens") {
      setTuning(currentModel(), "maxOutputTokens", clamp(Math.round(num(t.value, baseParams(currentModel()).maxOutputTokens)), 64, 32768));
      return renderPop();
    }
    if (t.dataset?.act !== "ctx-item") return;
    const sel = new Set(effectiveSelection(ctxOptions()));
    t.checked ? sel.add(t.dataset.id) : sel.delete(t.dataset.id);
    ctxSel = sel;
    renderPop();
  });

  updateBar(); renderMessages();
  // Tải cấu hình ngầm (dùng cache nếu có) để tên mô hình hiện ngay
  loadConfig().then(() => { updateBar(); if (popOpen) renderPop(); }).catch(err => {
    console.warn("Không đọc được config/gemini:", err);
  });
}

export function onShow() {
  if (popOpen) renderPop();
  if (el.scroll) el.scroll.scrollTop = el.scroll.scrollHeight;
  if (!config) loadConfig().then(() => { updateBar(); }).catch(() => {});
}
