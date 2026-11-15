// ============ AI Compose cho trang Kế hoạch ============
import { flatten } from "./plan-logic.js";
import { esc, openModal, richHtml, renderMath } from "./utils.js";
import * as ai from "./tabs/ai.js";

const DRAFT_PREFIX = "labmana_ai_draft_";

function displayModel(model) {
  return String(model || "").replace(/^gemini-/,"").replace(/-flash-preview$/i," Flash Preview").replace(/-flash-lite$/i," Lite").replace(/-flash$/i," Flash").replace(/-/g," ");
}

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
  let popOpen = false;
  let advOpen = false;
  let busy = false;
  const node = document.createElement("div");
  node.className = "ai-compose-modal";
  node.innerHTML = `
<label class="lbl">Prompt<textarea class="inp ai-compose-prompt" data-role="prompt" rows="3" placeholder="Mô tả nội dung cần soạn..."></textarea></label>
<div class="ai-compose-modelbar"><button type="button" class="ai-compose-model-trigger" data-role="model-toggle" aria-haspopup="true" aria-expanded="false"><span data-role="model-current">${esc(displayModel(settings.model))}</span></button><button type="button" class="ai-compose-generate" data-role="generate">✦ Tạo nội dung</button></div>
<div class="ai-compose-popover" data-role="compose-popover" hidden></div><div class="ai-compose-status" data-role="status">${esc(configError)}</div>
<section class="ai-compose-preview" data-role="preview" ${draft?"":"hidden"}><div class="ai-compose-preview-head"><div class="ai-compose-preview-tabs"><button type="button" class="ai-compose-tab on" data-tab="rendered">Xem hiển thị</button><button type="button" class="ai-compose-tab" data-tab="source">Mã nguồn</button></div></div><div class="ai-compose-rendered" data-role="rendered"></div><textarea class="ai-compose-source" data-role="source" spellcheck="false" hidden></textarea><div class="ai-compose-preview-actions"><button type="button" data-role="regenerate">Tạo lại</button><button type="button" data-role="insert">Chèn vào con trỏ</button><button type="button" class="primary" data-role="replace">Xác nhận thay thế</button></div></section>`
  const status = node.querySelector('[data-role="status"]');
  const preview = node.querySelector('[data-role="preview"]');
  const rendered = node.querySelector('[data-role="rendered"]');
  const source = node.querySelector('[data-role="source"]');
  const generate = node.querySelector('[data-role="generate"]');
  const popover = node.querySelector('[data-role="compose-popover"]');
  const modelTrigger = node.querySelector('[data-role="model-toggle"]');
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
  const renderPopover=()=>{
    popover.hidden=!popOpen;modelTrigger.setAttribute("aria-expanded",String(popOpen));if(!popOpen)return;
    const models=settings.models||[],activeModel=settings.model;
    popover.innerHTML=`<div class="ai-pop-h">Mô hình</div>${models.map(model=>`<button type="button" class="ai-opt ${model===activeModel?"on":""}" data-role="model-option" data-val="${esc(model)}"><span>${esc(displayModel(model))}</span><i>${model===activeModel?"✓":""}</i></button>`).join("")}<div class="ai-pop-sep"></div><button type="button" class="ai-adv-btn" data-role="advanced-toggle" aria-expanded="${advOpen}"><span>Tinh chỉnh sâu</span></button>${advOpen?`<div class="ai-adv"><div class="ai-adv-title">Tinh chỉnh cho <b>${esc(displayModel(activeModel))}</b></div>
<div class="ai-field"><div class="ai-field-h"><span>maxOutputTokens</span><input type="number" class="ai-num" data-role="tokens" min="64" max="32768" step="128" value="${settings.maxOutputTokens}"></div><div class="ai-chips">${[1024,2048,3072,4096].map(n=>`<button type="button" class="ai-chip ${settings.maxOutputTokens===n?"on":""}" data-tune="maxOutputTokens" data-val="${n}">${n}</button>`).join("")}</div></div>
<div class="ai-field"><div class="ai-field-h"><span>Suy luận ngầm (thinkingBudget)</span><em>${settings.thinkingBudget}</em></div><div class="ai-chips">${[[0,"Tắt (0)"],[128,"Nhẹ (128)"],[256,"Vừa (256)"],[512,"Sâu (512)"]].map(([n,l])=>`<button type="button" class="ai-chip ${settings.thinkingBudget===n?"on":""}" data-tune="thinkingBudget" data-val="${n}">${l}</button>`).join("")}</div></div>
<div class="ai-field"><div class="ai-field-h"><span>Sáng tạo (temperature)</span><em data-role="temperature-label">${Number(settings.temperature).toFixed(2)}</em></div><input type="range" class="ai-range" data-role="temperature" min="0" max="1" step="0.05" value="${settings.temperature}"></div><div class="ai-pop-foot"><button type="button" class="link-btn" data-role="tuning-reset">Mặc định</button><span class="ai-pop-note">Lưu riêng theo từng mô hình.</span></div></div>`:""}`;
  };
  const refreshModelSettings=async nextModel=>{try{settings=await ai.getPlannerComposeSettings(nextModel);modelTrigger.querySelector('[data-role="model-current"]').textContent=displayModel(settings.model);renderPopover();}catch(err){setStatus(err.message,true);}};
  const setStatus = (text, error = false) => { status.textContent = text; status.classList.toggle("ai-compose-error", error); };
  const run = async () => {
    const promptText = prompt.value.trim();
    if (!promptText) { setStatus("Hãy nhập yêu cầu soạn thảo trước.", true); prompt.focus(); return; }
    if (busy) return;
    busy = true; generate.disabled = true; generate.textContent = "Đang soạn…";
    setStatus("Đang gửi yêu cầu đến Gemini…");
    try {
      const context = contextFor(experiment, stepId, textarea.value);
      const response = await ai.composeForPlanner({
        prompt: promptText, context,
        model: settings.model,
        maxOutputTokens: settings.maxOutputTokens,
        thinkingBudget: settings.thinkingBudget,
        temperature: settings.temperature
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
      node.addEventListener("click",event=>{const b=event.target.closest("button");if(!b)return;if(b.dataset.tab)return setPreviewTab(b.dataset.tab);if(b.dataset.role==="model-toggle"){popOpen=!popOpen;renderPopover();return;}if(b.dataset.role==="model-option"){advOpen=false;return refreshModelSettings(b.dataset.val);}if(b.dataset.role==="advanced-toggle"){advOpen=!advOpen;renderPopover();return;}if(b.dataset.tune){const key=b.dataset.tune,value=Number(b.dataset.val);settings[key]=value;ai.setPlannerComposeTuning(settings.model,key,value);renderPopover();return;}if(b.dataset.role==="tuning-reset"){ai.resetPlannerComposeTuning(settings.model);return refreshModelSettings(settings.model);}if(b.dataset.role==="generate"||b.dataset.role==="regenerate")return run();if(b.dataset.role==="insert")return apply("insert");if(b.dataset.role==="replace")return apply("replace");});
      node.addEventListener("change",event=>{if(event.target.matches('[data-role="tokens"]')){const value=Math.max(64,Math.min(32768,Math.round(Number(event.target.value)||2048)));settings.maxOutputTokens=value;ai.setPlannerComposeTuning(settings.model,"maxOutputTokens",value);renderPopover();}});
      node.addEventListener("input", event => {
        if (event.target.matches('[data-role="temperature"]')) {
          const value = Math.max(0, Math.min(1, Number(event.target.value) || 0));
          node.querySelector('[data-role="temperature-label"]').textContent = value.toFixed(2);
          settings.temperature=value;
          ai.setPlannerComposeTuning(settings.model, "temperature", value);
        }
        if (event.target.matches('[data-role="source"]')) {
          draft = event.target.value;
          saveDraft(draft);
        }
      });
      prompt.focus();
      renderPopover();
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
