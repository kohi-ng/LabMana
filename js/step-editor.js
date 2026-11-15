// ============ Step Editor — Markdown + LaTeX authoring ============ 
import { esc, openModal, richHtml, renderMath } from "./utils.js";

const CHEMICALS = [
  ["H2SO4","Axit sulfuric"],["NaOH","Natri hydroxit"],["NaHCO3","Natri bicarbonat"],
  ["Na2SO4","Natri sulfat"],["HCl","Axit clohidric"],["CH3COOH","Axit axetic"],
  ["HNO3","Axit nitric"],["CaCO3","Canxi carbonat"],["KMnO4","Kali pemanganat"],
  ["CuSO4","Đồng(II) sulfat"],["AgNO3","Bạc nitrat"],["NH3","Amoniac"],
  ["H2O","Nước"],["O2","Oxi"],["CO2","Carbon dioxide"]
];
const MATH = [
  ["+","+"],["−","−"],["×","×"],["÷","÷"],["=","="],["≈","≈"],["±","±"],
  ["°C","°C"],["Δ","Δ"],["µ","µ"],["Phân số","$\\frac{}{ }$"],
  ["x²","x²"],["x³","x³"],["xₙ","xₙ"]
];
const CHEM = [
  ["$ ... $","$  $"],["$\\ce{...}$","$\\ce{}$"],["→","$\\rightarrow$"],
  ["⇌","$\\rightleftharpoons$"],["↓","$\\downarrow$"],["↑","$\\uparrow$"],
  ["⁺","⁺"],["⁻","⁻"],["²⁺","²⁺"],["₂","₂"],["₃","₃"],["₄","₄"]
];

export async function openStepEditor({ value = "", title = "Biên soạn thao tác" } = {}) {
  const node=document.createElement("div");
  node.className="step-editor";
  node.innerHTML=`
    <div class="se-toolbar">
      <div class="se-toolgroup">
        <button type="button" class="se-tool" data-menu="math">📐 Phép toán <span>⌄</span></button>
        <div class="se-menu" data-menu-panel="math" hidden>${MATH.map(([label,insert])=>`<button type="button" data-insert="${esc(insert)}" data-back="${label==="Phân số"?3:0}">${esc(label)}</button>`).join("")}</div>
      </div>
      <div class="se-toolgroup">
        <button type="button" class="se-tool" data-menu="chem">🧪 Hóa học <span>⌄</span></button>
        <div class="se-menu se-chem-menu" data-menu-panel="chem" hidden>
          <div class="se-chem-quick">${CHEM.map(([label,insert])=>`<button type="button" data-insert="${esc(insert)}" data-back="${label==="$\\\\ce{...}$"?2:0}">${esc(label)}</button>`).join("")}</div>
          <div class="se-chem-compose">
            <label>Nồng độ / hàm lượng<input type="text" data-concentration placeholder="VD: 0,1 M hoặc 5%"></label>
            <label>Hóa chất<select data-chemical>${CHEMICALS.map(([formula,name])=>`<option value="${esc(formula)}">${esc(formula)} — ${esc(name)}</option>`).join("")}</select></label>
            <div class="se-chem-actions"><button type="button" data-chem-action="concentration-first">Nồng độ + hóa chất</button><button type="button" data-chem-action="chemical-first">Hóa chất + nồng độ</button><button type="button" data-insert="$C_{M}$ ">C_M</button></div>
          </div>
        </div>
      </div>
      <div class="se-toolgroup">
        <button type="button" class="se-tool" data-menu="table">📊 Bảng <span>⌄</span></button>
        <div class="se-menu se-table-menu" data-menu-panel="table" hidden>
          <div class="se-table-controls"><label>Hàng<input type="number" min="1" max="20" value="3" data-grid-rows></label><label>Cột<input type="number" min="1" max="10" value="3" data-grid-cols></label></div>
          <div class="se-grid-wrap" data-grid-wrap></div>
          <div class="se-table-actions"><button type="button" data-grid="add-row">+ Hàng</button><button type="button" data-grid="del-row">− Hàng</button><button type="button" data-grid="add-col">+ Cột</button><button type="button" data-grid="del-col">− Cột</button><button type="button" class="primary" data-grid="insert">Chèn bảng</button></div>
          <p class="se-hint">Chọn một ô rồi dùng Phép toán / Hóa học để chèn công thức vào ô đó.</p>
        </div>
      </div>
    </div>
    <div class="se-tabs"><button type="button" class="on" data-tab="edit">Soạn thảo</button><button type="button" data-tab="preview">Xem trước thực tế</button></div>
    <textarea class="se-source" data-source spellcheck="false" placeholder="Nhập nội dung thao tác; công thức toán/hóa học đặt trong $...$"></textarea>
    <div class="se-preview" data-preview hidden></div>`;
  const source=node.querySelector("[data-source]"),preview=node.querySelector("[data-preview]");
  source.value=String(value??"");
  let activeTarget=source,lastStart=0,lastEnd=0,rows=3,cols=3;
  const remember=el=>{if(el && (el===source||el.matches("[data-grid-cell]"))){activeTarget=el;lastStart=el.selectionStart??el.value.length;lastEnd=el.selectionEnd??lastStart;}};
  source.addEventListener("select",()=>remember(source));
  source.addEventListener("input",()=>remember(source));
  source.addEventListener("keyup",()=>remember(source));
  source.addEventListener("click",()=>remember(source));
  const insert=(text,back=0)=>{
    const target=activeTarget?.isConnected?activeTarget:source;
    const start=Math.min(lastStart,target.value.length),end=Math.min(lastEnd,target.value.length);
    target.value=target.value.slice(0,start)+text+target.value.slice(end);
    const pos=start+text.length-back;
    target.focus();target.setSelectionRange(pos,pos);lastStart=lastEnd=pos;
  };
  const drawGrid=()=>{
    const wrap=node.querySelector("[data-grid-wrap]");
    wrap.style.setProperty("--se-cols",cols);
    wrap.innerHTML=Array.from({length:rows},(_,r)=>`<div class="se-grid-row">${Array.from({length:cols},(_,c)=>`<input data-grid-cell data-r="${r}" data-c="${c}" aria-label="Hàng ${r+1}, cột ${c+1}" placeholder="${r===0?"Tiêu đề":""}">`).join("")}</div>`).join("");
    wrap.querySelectorAll("[data-grid-cell]").forEach(el=>{el.addEventListener("focus",()=>remember(el));el.addEventListener("click",()=>remember(el));el.addEventListener("keyup",()=>remember(el));});
  };
  const updateDims=()=>{
    rows=Math.max(1,Math.min(20,Number(node.querySelector("[data-grid-rows]").value)||1));
    cols=Math.max(1,Math.min(10,Number(node.querySelector("[data-grid-cols]").value)||1));
    node.querySelector("[data-grid-rows]").value=rows;node.querySelector("[data-grid-cols]").value=cols;drawGrid();
  };
  drawGrid();
  node.addEventListener("change",e=>{if(e.target.matches("[data-grid-rows],[data-grid-cols]"))updateDims();});
  const previewNow=()=>{
    preview.innerHTML=richHtml(source.value)||'<span class="muted">(chưa có nội dung)</span>';
    renderMath(preview);
  };
  node.addEventListener("click",e=>{
    const b=e.target.closest("button");if(!b)return;
    if(b.dataset.menu){
      const key=b.dataset.menu,panel=node.querySelector(`[data-menu-panel="${key}"]`);
      const wasOpen=!panel.hidden;
      node.querySelectorAll("[data-menu-panel]").forEach(x=>x.hidden=true);
      panel.hidden=wasOpen;return;
    }
    if(b.dataset.tab){
      const isPreview=b.dataset.tab==="preview";
      node.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("on",x===b));
      source.hidden=isPreview;preview.hidden=!isPreview;
      if(isPreview)previewNow();else source.focus();return;
    }
    if(b.dataset.insert!==undefined){insert(b.dataset.insert,Number(b.dataset.back)||0);return;}
    if(b.dataset.chemAction){
      const concentration=node.querySelector("[data-concentration]").value.trim();
      const formula=node.querySelector("[data-chemical]").value;
      const chem="$\\ce{"+formula+"}$";
      const snippet=b.dataset.chemAction==="concentration-first"
        ? (concentration?concentration+" "+chem:chem)
        : (concentration?chem+" "+concentration:chem);
      insert(snippet+" ");return;
    }
    if(b.dataset.grid){
      const action=b.dataset.grid;
      if(action==="add-row")rows=Math.min(20,rows+1);
      if(action==="del-row")rows=Math.max(1,rows-1);
      if(action==="add-col")cols=Math.min(10,cols+1);
      if(action==="del-col")cols=Math.max(1,cols-1);
      if(action==="insert"){
        const cells=[...node.querySelectorAll("[data-grid-cell]")];
        const matrix=Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>cells.find(x=>+x.dataset.r===r&&+x.dataset.c===c)?.value||""));
        const lines=matrix.map(row=>"| "+row.map(v=>v.replace(/\|/g,"\\|").replace(/\n/g," ")).join(" | ")+" |");
        lines.splice(1,0,"| "+Array(cols).fill("---").join(" | ")+" |");
        if(rows===1)lines.push("| "+Array(cols).fill("").join(" | ")+" |");
        insert("\n"+lines.join("\n")+"\n");return;
      }
      node.querySelector("[data-grid-rows]").value=rows;node.querySelector("[data-grid-cols]").value=cols;drawGrid();return;
    }
  });
  node.addEventListener("input",e=>{
    if(e.target.matches("[data-grid-cell]"))remember(e.target);
    if(e.target===source && !preview.hidden)previewNow();
  });
  const result=await openModal({
    title, node,
    buttons:[{label:"Đóng",value:null},{label:"Áp dụng & Đóng",kind:"primary",value:()=>source.value}],
    onMount(body){
      const modal=body.closest(".modal");if(modal)modal.classList.add("step-editor-modal");
      source.focus();
    }
  });
  return result;
}
