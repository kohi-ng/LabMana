// ============ Tab Cài đặt (thành viên + xuất báo cáo) ============
import { state, on } from "../store.js";
import { auth, db } from "../firebase.js";
import { doc, collection, query, where, getDocs, setDoc, arrayUnion, arrayRemove, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, toast, confirmBox, promptBox, statusCard } from "../utils.js";
import { driveCreateReport, isDriveConfigured } from "../drive.js";
import { normalizeExperiment, flatten } from "../plan-logic.js";

let root;
const CFG = () => doc(db, "config", "lab");
const reportForm = { name: "", studentId: "", group: "", date: localDate(), semester: "Học kỳ 1, năm học 2026-2027" };
let reportBusy = false, lastReport = null;

export function init(el) {
  root = el;
  ["config", "status", "experiments", "runs"].forEach(event => on(event, render));
  root.addEventListener("click", onClick);
  root.addEventListener("input", onReportInput);
  root.addEventListener("change", onReportInput);
  root.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "st-names") { e.preventDefault(); addNames(); } });
  render();
}
export function onShow() { render(); }

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function render() {
  if (!state.ready) { root.innerHTML = statusCard(state); return; }
  const keep = root.querySelector("#st-names")?.value || "";
  const team = state.team;
  if (!reportForm.experimentId && state.experiments.length) reportForm.experimentId = state.experiments[0].id;
  root.innerHTML = `
    <div class="page-head"><h2>Cài đặt</h2></div>
    <div class="card"><h3>👥 Thành viên nhóm</h3>
      <div class="inline">
        <input class="inp" id="st-names" placeholder="Nhập tên (nhiều tên: cách nhau bằng dấu phẩy)" autocomplete="off">
        <button class="btn primary" data-act="add">Thêm</button>
      </div>
      <ul class="members">${team.length ? team.map(n => `<li><span class="nm">${esc(n)}</span>
        <button class="icon-btn" data-act="rename" data-name="${esc(n)}" title="Sửa">✎</button>
        <button class="icon-btn danger" data-act="del" data-name="${esc(n)}" title="Xóa">🗑</button></li>`).join("") : '<li class="muted">Chưa có thành viên.</li>'}</ul>
    </div>

    <div class="card"><h3>☁️ Lưu trữ</h3>
      <div class="kv"><span>Dữ liệu chữ/số/trạng thái</span><b>Firestore</b></div>
      <div class="kv"><span>Ảnh minh họa & ảnh chụp</span><b>${isDriveConfigured ? "Google Drive ✔" : "⚠️ Chưa cấu hình"}</b></div>
      ${!isDriveConfigured ? `<p class="muted small" style="margin-top:8px">Mở <code>js/drive.js</code> và dán URL Web App; xem hướng dẫn triển khai ở đầu file <code>code.gs</code>.</p>` : ""}
    </div>

    <div class="card report-card"><h3>📄 Xuất báo cáo</h3>
      <p class="muted small">Tạo Google Docs theo mẫu báo cáo; nội dung, hiện tượng, giải thích và ảnh được lấy từ nhật ký của bài đã chọn.</p>
      ${!isDriveConfigured ? '<p class="muted small">Cần cấu hình Google Drive trước khi xuất.</p>' : ""}
      <div class="report-form">
        <label class="lbl">Chọn bài
          <select class="inp" data-report-field="experimentId">
            ${state.experiments.length ? state.experiments.map(exp => `<option value="${esc(exp.id)}" ${reportForm.experimentId === exp.id ? "selected" : ""}>${esc(exp.title || "(không tên)")}</option>`).join("") : '<option value="">Chưa có bài đã lên kế hoạch</option>'}
          </select>
        </label>
        <label class="lbl">Họ và tên
          <input class="inp" data-report-field="name" value="${esc(reportForm.name)}" autocomplete="name" placeholder="Nhập họ và tên">
        </label>
        <label class="lbl">MSSV
          <input class="inp" data-report-field="studentId" value="${esc(reportForm.studentId)}" autocomplete="off" placeholder="Nhập mã số sinh viên">
        </label>
        <label class="lbl">Nhóm
          <input class="inp" data-report-field="group" value="${esc(reportForm.group)}" autocomplete="off" placeholder="Không bắt buộc">
        </label>
        <label class="lbl">Ngày báo cáo
          <input class="inp" type="date" data-report-field="date" value="${esc(reportForm.date)}">
        </label>
        <label class="lbl">Học kỳ / năm học
          <input class="inp" data-report-field="semester" value="${esc(reportForm.semester)}" placeholder="Ví dụ: Học kỳ 1, năm học 2026-2027">
        </label>
      </div>
      <button type="button" class="btn primary report-submit" data-act="export-report" ${reportBusy || !isDriveConfigured || !state.experiments.length ? "disabled" : ""}>
        ${reportBusy ? "Đang tạo tài liệu…" : "Tạo Google Docs"}
      </button>
      <button type="button" class="btn report-preview" data-act="preview-report" ${reportBusy || !state.experiments.length ? "disabled" : ""}>Xem trước biểu mẫu</button>
      ${lastReport ? `<p class="report-result"><a href="${esc(lastReport.url)}" target="_blank" rel="noopener noreferrer">Mở báo cáo: ${esc(lastReport.name)} ↗</a></p>` : ""}
    </div>

    <div class="card"><h3>ℹ️ Về ứng dụng</h3>
      <p class="small muted">LabMana v2.0 · Đăng nhập ẩn danh (mã thiết bị: <code>${esc((auth?.currentUser?.uid || "").slice(0, 6))}</code>)<br>
      Thí nghiệm đang mở được lưu trên thiết bị; dữ liệu ghi nhận đồng bộ qua Firestore.</p></div>`;
  root.querySelector("#st-names").value = keep;
}

function onReportInput(event) {
  const field = event.target.dataset?.reportField;
  if (!field) return;
  reportForm[field] = event.target.value;
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
  if (btn.dataset.act === "export-report") return exportReport();
  if (btn.dataset.act === "preview-report") return previewReport();
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

async function exportReport() {
  if (reportBusy) return;
  if (!reportForm.name.trim()) return toast("Hãy nhập họ và tên.", "warn");
  if (!reportForm.studentId.trim()) return toast("Hãy nhập MSSV.", "warn");
  const raw = state.experiments.find(exp => exp.id === reportForm.experimentId);
  if (!raw) return toast("Hãy chọn bài thí nghiệm.", "warn");

  reportBusy = true;
  lastReport = null;
  render();
  try {
    const report = await collectReportData();
    const result = await driveCreateReport(report);
    lastReport = { url: result.url, name: result.name };
    toast("Đã tạo Google Docs ✔", "success");
  } catch (err) {
    console.error(err);
    toast("Không xuất được báo cáo: " + (err.code || err.message), "error", 6000);
  } finally {
    reportBusy = false;
    render();
  }
}

async function collectReportData() {
  const raw = state.experiments.find(exp => exp.id === reportForm.experimentId);
  if (!raw) throw new Error("Hãy chọn bài thí nghiệm.");
  if (!reportForm.name.trim()) throw new Error("Hãy nhập họ và tên.");
  if (!reportForm.studentId.trim()) throw new Error("Hãy nhập MSSV.");

  const runsSnapshot = await getDocs(query(collection(db, "runs"), where("exp_id", "==", raw.id)));
  const runs = runsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
  const run = runs[0];
  if (!run) throw new Error("Bài này chưa có lượt thực hiện hoặc nhật ký nào.");

  const logsSnapshot = await getDocs(query(collection(db, "execution_logs"), where("run_id", "==", run.id)));
  const logs = {};
  logsSnapshot.forEach(item => {
    const log = item.data();
    logs[log.step_id] = log;
  });
  if (!Object.keys(logs).length) throw new Error("Bài này chưa có nội dung báo cáo để xuất.");

  const experiment = normalizeExperiment(raw);
  const steps = flatten(experiment).map(item => {
    const log = logs[item.step.id] || {};
    const photos = Array.isArray(log.photos) && log.photos.length
      ? log.photos
      : (log.photo_file_id || log.photo_url ? [{ file_id: log.photo_file_id || "", url: log.photo_url || "", name: log.photo_name || "" }] : []);
    return {
      section: `${item.si + 1}. ${item.sec.section_name || "Thí nghiệm"}`,
      label: item.label,
      action: [item.step.title, item.step.text].filter(Boolean).join("\n"),
      measurement: log.input_data == null ? "" : `${log.input_data}${log.input_unit ? ` ${log.input_unit}` : ""}`,
      observation: log.observation_text || "",
      explanation: log.explanation_text || "",
      photos: photos.map(photo => ({
        file_id: photo?.file_id || driveIdFromUrl(photo?.url),
        name: photo?.name || ""
      })).filter(photo => photo.file_id)
    };
  });
  return {
    experimentTitle: experiment.title || "Bài thí nghiệm",
    studentName: reportForm.name.trim(),
    studentId: reportForm.studentId.trim(),
    group: reportForm.group.trim(),
    date: reportForm.date || localDate(),
    semester: reportForm.semester.trim(),
    steps
  };
}

async function previewReport() {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) return toast("Trình duyệt đã chặn cửa sổ xem trước.", "warn");
  try {
    const report = await collectReportData();
    const response = await fetch("./formbaocao.html");
    if (!response.ok) throw new Error("Không tải được mẫu formbaocao.html.");
    let template = await response.text();
    const rows = report.steps.map(step => {
      const photos = step.photos.map(photo => {
        const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(photo.file_id)}&sz=w800`;
        const link = `https://drive.google.com/file/d/${encodeURIComponent(photo.file_id)}/view`;
        return `<div class="report-photo"><a href="${link}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="${esc(photo.name || "Ảnh hiện tượng")}"></a><a href="${link}" target="_blank" rel="noopener noreferrer">${esc(photo.name || "Mở ảnh trên Drive")} ↗</a></div>`;
      }).join("");
      const observed = [step.measurement ? `Số liệu: ${step.measurement}` : "", step.observation].filter(Boolean).join("\n");
      return `<tr><td>${esc(step.section)}</td><td><strong>${esc(step.label)}</strong><br>${esc(step.action).replace(/\n/g, "<br>")}</td><td>${esc(observed).replace(/\n/g, "<br>")}${photos}</td><td>${esc(step.explanation).replace(/\n/g, "<br>")}</td></tr>`;
    }).join("");
    const values = {
      "{{STUDENT_NAME}}": esc(report.studentName),
      "{{STUDENT_ID}}": esc(report.studentId),
      "{{GROUP}}": esc(report.group || "________________"),
      "{{EXPERIMENT}}": esc(report.experimentTitle),
      "{{REPORT_DATE}}": esc(formatReportDate(report.date)),
      "{{SEMESTER}}": esc(report.semester || "HỌC KỲ / NĂM HỌC"),
      "{{REPORT_ROWS}}": rows
    };
    for (const [token, value] of Object.entries(values)) template = template.split(token).join(value);
    previewWindow.document.open();
    previewWindow.document.write(template);
    previewWindow.document.close();
  } catch (err) {
    previewWindow.close();
    toast("Không tạo được bản xem trước: " + err.message, "error", 5000);
  }
}

function formatReportDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function driveIdFromUrl(value) {
  const url = String(value || "");
  return url.match(/[?&]id=([^&]+)/)?.[1] || url.match(/\/file\/d\/([^/]+)/)?.[1] || "";
}