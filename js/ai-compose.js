// ============ AI Compose cho trang Kế hoạch ============
import { flatten } from "./plan-logic.js";
import { esc, openModal, richHtml, renderMath } from "./utils.js";
import * as ai from "./tabs/ai.js";

const DRAFT_PREFIX = "labmana_ai_draft_";
const DEFAULT_CHIPS = { markdown: true, latex: true, table: true, safety: false, reaction: false };

function cleanOutput(value) {
  let text = String(value || "").trim()
    .replace(/^\s*```(?:markdown|md|text)?\s*\r?\n?/i, "")
    .replace(/\r?\n?\s*```\s*$/i, "")
    .trim();
  text = text.replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, "*$1*");
  text = text.replace(/\*\*(.+?)\*\*/gs, "*$1*");
  return text.trim();
}

function contextFor(experiment, stepId, currentText) {
  const flat = flatten(experiment);
  const found = flat.find(item => item.step.id === stepId);
  if (!found) return "";
  const preparation = found.sec.steps[0];
  const lines = [
    `Tên bài: ${experiment.title || "(chưa đặt tên)"}`,
    `Thí nghiệm hiện tại: TN ${found.si + 1} — ${found.sec.section_name || "(chưa đặt tên)"}`,
    `Tiêu đề bước đang thao tác: ${found.label} ${found.step.title || "(chưa có tiêu đề)"}`,
    `Nội dung bước chuẩn bị (${found.si + 1}.1):\n${preparation?.text || "(trống)"}`,
    `Nội dung hiện có trong ô bước ${found.label}:\n${currentText || "(trống)"}`
  ];
  return lines.join("\n\n");
}
function constraintText(chips) {
  const out = [];
  if (chips.markdown) out.push("CHỈ TRẢ VỀ NỘI DUNG SOP THUẦN TÚY ở định dạng Markdown. Không chào hỏi, không giải thích ngoài SOP, không bọc trong code fence.");
  if (chips.latex) out.push("Mọi công thức hóa học, ion và phương trình hóa học phải được bọc trong cặp dấu $...$; ví dụ $MgCl_2$, $SO_4^{2-}$, $BaSO_4 \\downarrow$. Không để công thức hóa học trần ngoài dấu $.");
  if (chips.table) out.push("Trình bày danh mục dụng cụ và hóa chất bằng bảng Markdown chuẩn có hàng tiêu đề và hàng phân cách, dạng | Cột 1 | Cột 2 |.");
  if (chips.safety) out.push("Đặt cảnh báo an toàn hóa chất phù hợp ở đầu bước, nêu PPE, nguy cơ và xử lý chất thải khi cần.");
  if (chips.reaction) out.push("Kèm các phương trình phản ứng hóa học minh họa phù hợp, cân bằng chính xác và giải thích ngắn gọn điều kiện phản ứng.");
  return out.join("\n");
}

export async function openAICompose({ experiment, stepId, textarea, onApply }) {
  if (!experiment || !stepId || !textarea) return;
  const storageKey = DRAFT_PREFIX + stepId;
  let settings = { models: ["gemini-3.8-flash","gemini-3.6-flash","gemini-3-flash-preview","gemini-3.1-flash-lite","gemini-3.5-flash-lite"], model:"gemini-3.6-flash", maxOutputTokens:2048, thinkingBudget:256, temperature:0.25 };
  let configError = "";
  try { settings = { ...settings, ...await ai.getPlannerComposeSettings() }; }
  catch (err) { configError = err.message || "Không đọc được config/gemini."; }

  const selectionStart = textarea.selectionStart ?? textarea.value.length;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  let draft = "";
  try { draft = sessionStorage.getItem(storageKey) || ""; } catch { /* storage disabled */ }
  let chipState = { ...DEFAULT_CHIPS };
  let busy = false;
  const node = document.createElement("div");
  node.className = "ai-compose-modal";
  node.innerHTML = `
    <label class="lbl">Prompt
      <textarea class="inp ai-compose-prompt" data-role="prompt" rows="3" placeholder="VD: Soạn các bước thực hiện và bảng hóa chất cho lượt thử này"></textarea>
    </label>
    <div class="lbl-t" style="margin-top:12px">Ràng buộc & công thức</div>
    <div class="ai-compose-chips">
      <button type="button" class="ai-compose-chip on" data-chip="markdown" aria-pressed="true">Markdown thô</button>
      <button type="button" class="ai-compose-chip on" data-chip="latex" aria-pressed="true">Công thức LaTeX ($...$)</button>
      <button type="button" class="ai-compose-chip on" data-chip="table" aria-pressed="true">Kẻ bảng hóa chất</button>
      <button type="button" class="ai-compose-chip" data-chip="safety" aria-pressed="false">Cảnh báo an toàn</button>
      <button type="button" class="ai-compose-chip" data-chip="reaction" aria-pressed="false">Kèm PTPƯ</button>
    </div>
    <div class="ai-compose-model-row">
      <label class="lbl">Mô hình Gemini<select class="inp" data-role="model">${settings.models.map(m => `<option value="${esc(m)}" ${m===settings.model?"selected":""}>${esc(m.replace(/^gemini-/,""))}</option>`).join("")}</select></label>
      <button type="button" class="ai-compose-tune-trigger" data-role="tuning-toggle" aria-expanded="false">Tinh chỉnh sâu <span class="chev">⌄</span></button>
    </div>
    <div class="ai-compose-tuning-pop" data-role="tuning-pop" hidden>
      <div class="ai-adv-title">Tinh chỉnh cho <b data-role="model-name">${esc(settings.model.replace(/^gemini-/,""))}</b></div>
      <div class="ai-field"><div class="ai-field-h"><span>maxOutputTokens</span><input type="number" class="ai-num" data-role="tokens" min="64" max="32768" step="128" value="${settings.maxOutputTokens}"></div>
        <div class="ai-chips">${[1024,2048,3072,4096].map(n=>`<button type="button" class="ai-chip ${settings.maxOutputTokens===n?"on":""}" data-tune="maxOutputTokens" data-val="${n}">${n}</button>`).join("")}</div></div>
      <div class="ai-field"><div class="ai-field-h"><span>Suy luận ngầm (thinkingBudget)</span><em data-role="thinking-label">${settings.thinkingBudget}</em></div>
        <div class="ai-chips">${[[0,"Tắt (0)"],[128,"Nhẹ (128)"],[256,"Vừa (256)"],[512,"Sâu (512)"]].map(([n,l])=>`<button type="button" class="ai-chip ${settings.thinkingBudget===n?"on":""}" data-tune="thinkingBudget" data-val="${n}">${l}</button>`).join("")}</div></div>
      <div class="ai-field"><div class="ai-field-h"><span>Sáng tạo (temperature)</span><em data-role="temperature-label">${Number(settings.temperature).toFixed(2)}</em></div>
        <input type="range" class="ai-range" data-role="temperature" min="0" max="1" step="0.05" value="${settings.temperature}"></div>
      <div class="ai-pop-foot"><button type="button" class="link-btn" data-role="tuning-reset">Mặc định</button><span class="ai-pop-note">Lưu riêng theo từng mô hình.</span></div>
    </div>
    <button type="button" class="ai-compose-generate" data-role="generate">✦ Tạo nội dung</button>
    <div class="ai-compose-status" data-role="status">${esc(configError)}</div>
    <section class="ai-compose-preview" data-role="preview" ${draft ? "" : "hidden"}>
      <div class="ai-compose-preview-head"><div class="ai-compose-preview-tabs">
        <button type="button" class="ai-compose-tab on" data-tab="rendered">Xem hiển thị</button>
        <button type="button" class="ai-compose-tab" data-tab="source">Mã nguồn</button>
      </div></div>
      <div class="ai-compose-rendered" data-role="rendered"></div>
      <textarea class="ai-compose-source" data-role="source" spellcheck="false" hidden></textarea>
      <div class="ai-compose-preview-actions">
        <button type="button" data-role="regenerate">Tạo lại</button>
        <button type="button" data-role="insert">Chèn vào con trỏ</button>
        <button type="button" class="primary" data-role="replace">Xác nhận thay thế</button>
      </div>
    </section>`;
  const status = node.querySelector('[data-role="status"]');
  const preview = node.querySelector('[data-role="preview"]');
  const rendered = node.querySelector('[data-role="rendered"]');
  const source = node.querySelector('[data-role="source"]');
  const generate = node.querySelector('[data-role="generate"]');
  const prompt = node.querySelector('[data-role="prompt"]');
  let previewTab = "rendered";
  source.value = draft;
  const renderDraft = () => {
    rendered.innerHTML = richHtml(draft) || '<span class="muted">(chưa có nội dung)</span>';
    renderMath(rendered);
    source.value = draft;
  };
  const setPreviewTab = tab => {
    previewTab = tab;
    node.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    rendered.hidden = tab !== "rendered";
    source.hidden = tab !== "source";
    if (tab === "rendered") renderDraft(); else source.focus();
  };
  if (draft) renderDraft();

  const saveDraft = text => { try { sessionStorage.setItem(storageKey, text); } catch { /* sessionStorage unavailable */ } };
  const refreshModelSettings = async nextModel => {
    try {
      settings = await ai.getPlannerComposeSettings(nextModel);
      node.querySelector('[data-role="model-name"]').textContent = settings.model.replace(/^gemini-/,"");
      node.querySelector('[data-role="tokens"]').value = settings.maxOutputTokens;
      node.querySelector('[data-role="thinking-label"]').textContent = settings.thinkingBudget;
      node.querySelector('[data-role="temperature"]').value = settings.temperature;
      node.querySelector('[data-role="temperature-label"]').textContent = Number(settings.temperature).toFixed(2);
      node.querySelectorAll('[data-tune="maxOutputTokens"]').forEach(b => b.classList.toggle("on", Number(b.dataset.val) === settings.maxOutputTokens));
      node.querySelectorAll('[data-tune="thinkingBudget"]').forEach(b => b.classList.toggle("on", Number(b.dataset.val) === settings.thinkingBudget));
    } catch (err) { setStatus(err.message, true); }
  };
  const setStatus = (text, error = false) => { status.textContent = text; status.classList.toggle("ai-compose-error", error); };
  const run = async () => {
    const promptText = prompt.value.trim();
    if (!promptText) { setStatus("Hãy nhập yêu cầu soạn thảo trước.", true); prompt.focus(); return; }
    if (busy) return;
    busy = true; generate.disabled = true; generate.textContent = "Đang soạn…";
    setStatus("Đang gửi yêu cầu đến Gemini…");
    try {
      const context = contextFor(experiment, stepId, textarea.value);
      const constraints = constraintText(chipState);
      const response = await ai.composeForPlanner({
        prompt: promptText, context, systemInstruction: constraints,
        model: node.querySelector('[data-role="model"]').value,
        maxOutputTokens: node.querySelector('[data-role="tokens"]').value,
        thinkingBudget: settings.thinkingBudget,
        temperature: node.querySelector('[data-role="temperature"]').value
      });
      draft = cleanOutput(response.text);
      saveDraft(draft);
      renderDraft();
      preview.hidden = !draft;
      setPreviewTab("rendered");
      setStatus(response.note || `Đã tạo bằng ${response.model.replace(/^gemini-/,"")} · Bản nháp được giữ trong phiên.`);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Không gọi được Gemini.", true);
    } finally {
      busy = false; generate.disabled = false; generate.textContent = "✦ Tạo nội dung";
    }
  };
  const apply = mode => {
    if (!draft) return;
    let next = draft;
    if (mode === "insert") {
      const value = textarea.value;
      const start = Math.min(selectionStart, value.length);
      const end = Math.min(selectionEnd, value.length);
      const before = value.slice(0, start), after = value.slice(end);
      next = before + (before && !before.endsWith("\n") ? "\n" : "") + draft + (after && !after.startsWith("\n") ? "\n" : "") + after;
    }
    onApply(next, mode);
    saveDraft(draft);
    node.__closeModal?.("applied");
  };

  openModal({
    title: "✦ AI Compose",
    node,
    buttons: [{ label: "Đóng", value: null }],
    onMount(body, controls) {
      const close = controls.close;
      node.addEventListener("click", event => {
        const button = event.target.closest("[data-role]");
        if (!button) return;
        if (button.dataset.chip) {
          const key = button.dataset.chip;
          chipState[key] = !chipState[key];
          button.classList.toggle("on", chipState[key]);
          button.setAttribute("aria-pressed", String(chipState[key]));
          return;
        }
        if (button.dataset.tab) return setPreviewTab(button.dataset.tab);
        if (button.dataset.role === "tuning-toggle") {
          const pop = node.querySelector('[data-role="tuning-pop"]');
          pop.hidden = !pop.hidden;
          button.setAttribute("aria-expanded", String(!pop.hidden));
          return;
        }
        if (button.dataset.tune) {
          const key = button.dataset.tune, value = Number(button.dataset.val);
          const activeModel = node.querySelector('[data-role="model"]').value;
          ai.setPlannerComposeTuning(activeModel, key, value);
          if (key === "maxOutputTokens") node.querySelector('[data-role="tokens"]').value = value;
          if (key === "thinkingBudget") {
            settings.thinkingBudget = value;
            node.querySelector('[data-role="thinking-label"]').textContent = value;
          }
          button.parentElement.querySelectorAll("[data-tune]").forEach(b => b.classList.toggle("on", b === button));
          return;
        }
        if (button.dataset.role === "tuning-reset") {
          const activeModel = node.querySelector('[data-role="model"]').value;
          ai.resetPlannerComposeTuning(activeModel);
          return refreshModelSettings(activeModel);
        }
        if (button.dataset.role === "generate" || button.dataset.role === "regenerate") return run();
        if (button.dataset.role === "insert") return apply("insert");
        if (button.dataset.role === "replace") return apply("replace");
      });
      node.addEventListener("change", event => {
        if (event.target.matches('[data-role="model"]')) refreshModelSettings(event.target.value);
        if (event.target.matches('[data-role="tokens"]')) {
          const value = Math.max(64, Math.min(32768, Math.round(Number(event.target.value) || 2048)));
          event.target.value = value;
          ai.setPlannerComposeTuning(node.querySelector('[data-role="model"]').value, "maxOutputTokens", value);
          node.querySelectorAll('[data-tune="maxOutputTokens"]').forEach(b => b.classList.toggle("on", Number(b.dataset.val) === value));
        }
      });
      node.addEventListener("input", event => {
        if (event.target.matches('[data-role="temperature"]')) {
          const value = Math.max(0, Math.min(1, Number(event.target.value) || 0));
          node.querySelector('[data-role="temperature-label"]').textContent = value.toFixed(2);
          ai.setPlannerComposeTuning(node.querySelector('[data-role="model"]').value, "temperature", value);
        }
        if (event.target.matches('[data-role="source"]')) {
          draft = event.target.value;
          saveDraft(draft);
        }
      });
      prompt.focus();
      if (draft) { preview.hidden = false; setPreviewTab("rendered"); setStatus("Đã khôi phục bản nháp AI của bước này từ sessionStorage."); }
      if (configError) setStatus(configError, true);
      // close được giữ trong closure để áp dụng xong tự đóng modal.
      node.dataset.ready = "1";
      node.__closeModal = close;
    }
  }).catch?.(() => {});
  // openModal trả Promise; callback onMount gán close trước khi người dùng có thể áp dụng.
  // Dùng close trực tiếp từ node để không phụ thuộc nút footer.
}
