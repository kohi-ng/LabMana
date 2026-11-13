// ============ Tab Cài đặt (danh sách thành viên dùng chung) ============
import { state, on } from "../store.js";
import { auth, db } from "../firebase.js";
import { doc, setDoc, arrayUnion, arrayRemove, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, toast, confirmBox, promptBox, statusCard } from "../utils.js";
import { isDriveConfigured } from "../drive.js";

let root;
const CFG = () => doc(db, "config", "lab");

export function init(el) {
  root = el;
  on("config", render); on("status", render);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "st-names") { e.preventDefault(); addNames(); } });
  render();
}
export function onShow() { render(); }

function render() {
  if (!state.ready) { root.innerHTML = statusCard(state); return; }
  const keep = root.querySelector("#st-names")?.value || "";
  const team = state.team;
  root.innerHTML = `
    <div class="page-head"><h2>Cài đặt</h2></div>
    <div class="card"><h3>👥 Thành viên nhóm</h3>
      <p class="muted small">Danh sách dùng chung cho mọi thiết bị. Dùng tên thành viên này để ủy quyền từng bước trong Kế hoạch; bước đã được giao sẽ ghi nhận đúng người phụ trách.</p>
      <div class="inline">
        <input class="inp" id="st-names" placeholder="Nhập tên (nhiều tên: cách nhau bằng dấu phẩy)" autocomplete="off">
        <button class="btn primary" data-act="add">Thêm</button>
      </div>
      <ul class="members">${team.length ? team.map(n => `<li><span class="nm">${esc(n)}</span>
        <button class="icon-btn" data-act="rename" data-name="${esc(n)}" title="Sửa">✎</button>
        <button class="icon-btn danger" data-act="del" data-name="${esc(n)}" title="Xóa">🗑</button></li>`).join("") : '<li class="muted">Chưa có thành viên.</li>'}</ul>
      <p class="muted small">Đổi tên không làm thay đổi tên đã ghi trong lịch sử các bước đã lưu.</p></div>

    <div class="card"><h3>☁️ Lưu trữ</h3>
      <div class="kv"><span>Dữ liệu chữ/số/trạng thái</span><b>Firestore</b></div>
      <div class="kv"><span>Ảnh minh họa & ảnh chụp</span><b>${isDriveConfigured ? "Google Drive ✔" : "⚠️ Chưa cấu hình"}</b></div>
      ${!isDriveConfigured ? `<p class="muted small" style="margin-top:8px">Mở <code>js/drive.js</code> và dán URL Web App; xem hướng dẫn triển khai ở đầu file <code>code.gs</code>.</p>` : ""}
    </div>

    <div class="card"><h3>ℹ️ Về ứng dụng</h3>
      <p class="small muted">LabMana v2.0 · Đăng nhập ẩn danh (mã thiết bị: <code>${esc((auth?.currentUser?.uid || "").slice(0, 6))}</code>)<br>
      Thí nghiệm đang mở được lưu trên thiết bị; dữ liệu ghi nhận đồng bộ qua Firestore.</p></div>`;
  root.querySelector("#st-names").value = keep;
}

async function addNames() {
  const inp = root.querySelector("#st-names");
  const names = [...new Set(inp.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean))];
  if (!names.length) return;
  const exist = new Set(state.team.map(n => n.toLowerCase()));
  const fresh = names.filter(n => !exist.has(n.toLowerCase()));
  if (!fresh.length) return toast("Tên đã có trong danh sách", "warn");
  try {
    await Promise.race([setDoc(CFG(), { team_members: arrayUnion(...fresh) }, { merge: true }), new Promise(r => setTimeout(r, 6000))]);
    inp.value = "";
    toast(`Đã thêm ${fresh.length} thành viên`, "success");
  } catch (err) { toast("Lỗi: " + (err.code || err.message), "error"); }
}

async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const name = btn.dataset.name;
  if (btn.dataset.act === "add") return addNames();
  if (btn.dataset.act === "del") {
    if (!(await confirmBox(`Xóa "${name}" khỏi danh sách?`, "Xóa"))) return;
    try { await setDoc(CFG(), { team_members: arrayRemove(name) }, { merge: true }); toast("Đã xóa", "success"); }
    catch (err) { toast("Lỗi: " + (err.code || err.message), "error"); }
  }
  if (btn.dataset.act === "rename") {
    const nn = await promptBox({ title: "Sửa tên", label: "Tên mới", value: name });
    if (!nn || nn === name) return;
    try {
      await runTransaction(db, async tx => {
        const s = await tx.get(CFG());
        const arr = (s.data()?.team_members || []).slice();
        const i = arr.indexOf(name);
        if (i < 0) throw new Error("Tên này không còn trong danh sách");
        if (arr.some((n, j) => j !== i && n.toLowerCase() === nn.toLowerCase())) throw new Error("Tên bị trùng");
        arr[i] = nn;
        tx.set(CFG(), { team_members: arr }, { merge: true });
      });
      toast("Đã đổi tên", "success");
    } catch (err) { toast("Lỗi: " + (err.message || err.code), "error"); }
  }
}