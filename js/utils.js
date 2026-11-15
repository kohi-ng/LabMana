// ============ Tiện ích dùng chung (không phụ thuộc store) ============
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

export const snippet = (t, n = 48) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (!s) return "(chưa có nội dung)";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

/** Văn bản người dùng → HTML an toàn; hỗ trợ *đậm*, danh sách gạch đầu dòng và bảng Markdown đơn giản. */
/** Markdown an toàn dùng chung cho Planner, AI Compose và Quy trình. Công thức để KaTeX auto-render xử lý sau khi dựng HTML. */
export function richHtml(t) {
  const lines=String(t??"").replace(/\r\n?/g,"\n").split("\n");
  const html=[];
  const inline=value=>esc(value)
    .replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g,"<strong>$1</strong>");
  const splitCells=line=>{
    const value=line.trim();
    if(!value.startsWith("|")||!value.endsWith("|"))return null;
    const cells=[];let cell="",escaped=false;
    for(const ch of value.slice(1,-1)){
      if(ch==="|"&&!escaped){cells.push(cell.trim());cell="";continue;}
      cell+=ch;
      escaped=ch==="\\"&&!escaped;
      if(ch!=="\\")escaped=false;
    }
    cells.push(cell.trim());return cells;
  };
  const isSep=row=>row.length>1&&row.every(cell=>/^:?-{3,}:?$/.test(cell));
  for(let i=0;i<lines.length;){
    const line=lines[i],trim=line.trim();
    const cells=splitCells(line);
    if(cells&&cells.length>1){
      const rows=[];
      while(i<lines.length){const row=splitCells(lines[i]);if(!row||row.length<2)break;rows.push(row);i++;}
      const header=rows.shift()||[];
      const align=isSep(rows[0]||[]) ? rows.shift() : null;
      const cellTag=(cell,index,tag)=>{const a=align?.[index]||"";const style=a.startsWith(":")&&a.endsWith(":")?"center":a.endsWith(":")?"right":a.startsWith(":")?"left":"";return `<${tag}${style?` style="text-align:${style}"`:""}>${inline(cell)}</${tag}>`;};
      html.push(`<div class="table-scroll"><table class="text-table"><thead><tr>${header.map((cell,j)=>cellTag(cell,j,"th")).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${header.map((_,j)=>cellTag(row[j]??"",j,"td")).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const heading=trim.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if(heading){const level=Math.min(4,heading[1].length+1);html.push(`<h${level} class="md-heading">${inline(heading[2])}</h${level}>`);i++;continue;}
    if(/^\s*[-*•]\s+/.test(line)){
      const items=[];while(i<lines.length&&/^\s*[-*•]\s+/.test(lines[i])){items.push(`<li>${inline(lines[i].replace(/^\s*[-*•]\s+/,""))}</li>`);i++;}
      html.push(`<ul class="md-list">${items.join("")}</ul>`);continue;
    }
    if(/^\s*\d+[.)]\s+/.test(line)){
      const items=[];while(i<lines.length&&/^\s*\d+[.)]\s+/.test(lines[i])){items.push(`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/,""))}</li>`);i++;}
      html.push(`<ol class="md-list">${items.join("")}</ol>`);continue;
    }
    if(!trim){i++;continue;}
    if(/^\s*(---|___|\*\*\*)\s*$/.test(line)){html.push("<hr>");i++;continue;}
    const paragraph=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!splitCells(lines[i])&&!/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|---\s*$)/.test(lines[i])){paragraph.push(lines[i]);i++;}
    html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
  }
  return html.join("");
}
export function renderMath(el, tries = 0) {
  if (!el) return;
  if (typeof window.renderMathInElement === "function") {
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false }
        ],
        throwOnError: false,
        trust: false,
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"]
      });
    } catch (e) { console.warn("KaTeX / mhchem:", e); }
  } else if (tries < 30) {
    setTimeout(() => renderMath(el, tries + 1), 200);
  }
}

export function toast(msg, type = "info", ms = 2800) {
  const root = $("#toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => el.classList.add("out"), ms);
  setTimeout(() => el.remove(), ms + 350);
}

export function fmtTime(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function downloadFile(name, text, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Blob → base64 (không kèm tiền tố data:...;base64,). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Đọc file thất bại"));
    r.readAsDataURL(blob);
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Đọc ảnh dự phòng thất bại"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Modal chung. buttons: [{label, kind, value | (body)=>value, validate?(body)=>bool}]
 * Trả về Promise<value>; bấm nền / nút có value=null → null.
 */
export function openModal({ title = "", html = "", node = null, buttons = [{ label: "Đóng", value: null }], onMount = null, dismissible = true }) {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">${esc(title)}</div><div class="modal-body"></div><div class="modal-foot"></div></div>`;
    const body = wrap.querySelector(".modal-body");
    const foot = wrap.querySelector(".modal-foot");
    if (node) body.appendChild(node); else body.innerHTML = html;
    const close = v => { wrap.classList.add("out"); setTimeout(() => wrap.remove(), 160); resolve(v); };
    const btns = buttons.map(b => {
      const el = document.createElement("button");
      el.className = "btn " + (b.kind || "");
      el.textContent = b.label;
      el.addEventListener("click", () => {
        if (b.validate && !b.validate(body)) return;
        close(typeof b.value === "function" ? b.value(body) : b.value);
      });
      foot.appendChild(el);
      return el;
    });
    if (dismissible) wrap.addEventListener("click", e => { if (e.target === wrap) close(null); });
    $("#modal-root").appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));
    onMount && onMount(body, { close, btns });
  });
}

export const confirmBox = (msg, ok = "Đồng ý", kind = "danger") =>
  openModal({
    title: "Xác nhận", html: `<p>${esc(msg)}</p>`,
    buttons: [{ label: "Hủy", value: false }, { label: ok, kind, value: true }]
  }).then(v => v === true);

export function promptBox({ title, label, value = "", placeholder = "" }) {
  const node = document.createElement("div");
  node.innerHTML = `<label class="lbl">${esc(label)}<input class="inp" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
  return openModal({
    title, node,
    buttons: [{ label: "Hủy", value: null }, { label: "OK", kind: "primary", value: () => node.querySelector("input").value.trim() }],
    onMount: body => { const i = body.querySelector("input"); i.focus(); i.select(); }
  });
}

/** Modal chọn TÊN người thực hiện (luồng Shared-Device). Trả về tên hoặc null. */
export function pickName(team) {
  if (!team.length) {
    openModal({
      title: "Chưa có danh sách thành viên",
      html: "<p>Thêm thành viên ở tab <b>Cài đặt</b>, rồi quay lại bấm Lưu.</p>",
      buttons: [{ label: "Để sau", value: null }, { label: "Mở Cài đặt", kind: "primary", value: "go" }]
    }).then(v => { if (v === "go") $('[data-tab="settings"]')?.click(); });
    return Promise.resolve(null);
  }
  const node = document.createElement("div");
  node.innerHTML = `<div class="tiles"></div>`;
  const tiles = node.querySelector(".tiles");
  let selected = "";
  team.forEach(name => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tile"; b.textContent = name;
    b.addEventListener("click", () => {
      selected = name;
      tiles.querySelectorAll(".tile").forEach(t => t.classList.toggle("sel", t === b));
      node.dispatchEvent(new CustomEvent("picked"));
    });
    tiles.appendChild(b);
  });
  return openModal({
    title: "Chọn tên người thực hiện", node,
    buttons: [
      { label: "Hủy", value: null },
      { label: "Xác nhận & Lưu", kind: "primary", value: () => selected, validate: () => { if (!selected) { toast("Hãy chọn một tên", "warn"); return false; } return true; } }
    ]
  });
}

/** Thẻ thông báo khi Firebase chưa sẵn sàng. */
export function statusCard(st) {
  const e = st.error;
  if (!e) return `<div class="empty">Đang kết nối…</div>`;
  if (e === "NOT_CONFIGURED") return `<div class="notice"><h3>Chưa cấu hình Firebase</h3>
    <p>Mở <code>js/firebase.js</code> và dán <code>firebaseConfig</code> của dự án. Xem README.md.</p></div>`;
  if (/operation-not-allowed|admin-restricted/.test(e)) return `<div class="notice"><h3>Chưa bật đăng nhập ẩn danh</h3>
    <p>Firebase Console → Authentication → Sign-in method → bật <b>Anonymous</b>.</p></div>`;
  if (/permission-denied/.test(e)) return `<div class="notice"><h3>Bị từ chối quyền</h3>
    <p>Kiểm tra Rules của Firestore (<code>firestore.rules</code>) và Anonymous Auth.</p></div>`;
  return `<div class="notice"><h3>Lỗi kết nối</h3><p><code>${esc(e)}</code></p><p class="muted small">Thử tải lại trang.</p></div>`;
}