// ============ Tab Cài đặt (thành viên + xuất báo cáo) ============
import { state, on } from "../store.js";
import { auth, db } from "../firebase.js";
import { doc, collection, query, where, getDocs, setDoc, arrayUnion, arrayRemove, deleteField, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, richHtml, toast, confirmBox, promptBox, statusCard, renderMath } from "../utils.js";
import { driveCreateReport, isDriveConfigured } from "../drive.js";
import { normalizeExperiment, flatten, secTagSp } from "../plan-logic.js";

let root;
const CFG = () => doc(db, "config", "lab");
// Ảnh dự phòng gửi kèm báo cáo: giới hạn ký tự của data URL (Firestore vốn giới hạn 1 MiB/tài liệu).
const INLINE_PHOTO_MAX_CHARS = 4_000_000;
const reportForm = {
  // peopleText / reportTitle tự lấy mặc định từ danh sách thành viên và tên bài; sau khi người dùng sửa
  // thì giữ nguyên bản sửa (peopleEdited / titleEdited), nút "Lấy lại từ danh sách" để về mặc định.
  peopleText: "", peopleEdited: false, reportTitle: "", titleEdited: false,
  group: "", date: localDate(), semester: "Học kỳ 1, năm học 2026-2027",
  includeMeasurement: true, includeObservation: true, includeExplanation: true, includePhotos: true
};
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
  const selectedExperiment = state.experiments.find(exp => exp.id === reportForm.experimentId);
  if (!reportForm.titleEdited) reportForm.reportTitle = selectedExperiment?.title || "";
  if (!reportForm.peopleEdited) reportForm.peopleText = defaultPeopleText();
  root.innerHTML = `
    <div class="page-head"><h2>Cài đặt</h2></div>
    <div class="section"><h3>Thành viên</h3>
      <div class="inline">
        <input class="inp" id="st-names" placeholder="Họ tên - MSSV (nhiều người: cách nhau dấu phẩy)" autocomplete="off">
        <button class="btn primary" data-act="add">Thêm</button>
      </div>
      <ul class="members">${team.length ? team.map(n => `<li><span class="nm">${esc(n)}</span>
        ${state.teamIds[n] ? `<span class="mssv">${esc(state.teamIds[n])}</span>` : '<span class="mssv none">Chưa có MSSV</span>'}
        <button class="link-btn" data-act="rename" data-name="${esc(n)}">Sửa</button>
        <button class="link-btn danger" data-act="del" data-name="${esc(n)}">Xóa</button></li>`).join("") : '<li class="muted">Chưa có thành viên.</li>'}</ul>
    </div>

    <div class="section report-card"><h3>Xuất báo cáo</h3>
      ${!isDriveConfigured ? '<p class="muted small">Chưa cấu hình Google Drive. Xem <code>js/drive.js</code>.</p>' : ""}
      <div class="report-form">
        <label class="lbl">Bài
          <select class="inp" data-report-field="experimentId">
            ${state.experiments.length ? state.experiments.map(exp => `<option value="${esc(exp.id)}" ${reportForm.experimentId === exp.id ? "selected" : ""}>${esc(exp.title || "(không tên)")}</option>`).join("") : '<option value="">Chưa có bài</option>'}
          </select>
        </label>
        <label class="lbl">Tên bài trong báo cáo
          <input class="inp" data-report-field="reportTitle" value="${esc(reportForm.reportTitle)}" autocomplete="off">
        </label>
        <label class="lbl report-people-label">Họ và tên - MSSV (mỗi người một dòng)
          <textarea class="inp" rows="4" data-report-field="peopleText" placeholder="Phan Văn A - 123456&#10;Nguyễn Văn B - 234567">${esc(reportForm.peopleText)}</textarea>
        </label>
        <div class="report-people-hint">
          <button type="button" class="link-btn" data-act="reset-report-defaults">Lấy lại từ danh sách thành viên</button>
        </div>
        <label class="lbl">Nhóm
          <input class="inp" data-report-field="group" value="${esc(reportForm.group)}" autocomplete="off">
        </label>
        <label class="lbl">Ngày
          <input class="inp" type="date" data-report-field="date" value="${esc(reportForm.date)}">
        </label>
        <label class="lbl">Học kỳ / năm học
          <input class="inp" data-report-field="semester" value="${esc(reportForm.semester)}">
        </label>
      </div>
      <div class="lbl-t">Nội dung</div>
      <div class="report-options">
        <label><input type="checkbox" data-report-field="includeMeasurement" ${reportForm.includeMeasurement ? "checked" : ""}> Số liệu</label>
        <label><input type="checkbox" data-report-field="includeObservation" ${reportForm.includeObservation ? "checked" : ""}> Hiện tượng</label>
        <label><input type="checkbox" data-report-field="includeExplanation" ${reportForm.includeExplanation ? "checked" : ""}> Giải thích / PTPƯ</label>
        <label><input type="checkbox" data-report-field="includePhotos" ${reportForm.includePhotos ? "checked" : ""}> Ảnh</label>
      </div>
      <button type="button" class="btn primary report-submit" data-act="export-report" ${reportBusy || !isDriveConfigured || !state.experiments.length ? "disabled" : ""}>
        ${reportBusy ? "Đang tạo tài liệu…" : "Tạo Google Docs"}
      </button>
      <button type="button" class="btn report-preview" data-act="preview-report" ${reportBusy || !state.experiments.length ? "disabled" : ""}>Xem trước</button>
      ${lastReport ? `<p class="report-result"><span>Đã tạo: ${esc(lastReport.name)}</span><a class="btn primary" href="${esc(lastReport.url)}" target="_blank" rel="noopener noreferrer">Xem báo cáo</a></p>` : ""}
    </div>

    <p class="tiny muted" style="margin-top:24px">LabMana v2.0 · Thiết bị <code>${esc((auth?.currentUser?.uid || "").slice(0, 6))}</code></p>`;
  root.querySelector("#st-names").value = keep;
}

function onReportInput(event) {
  const field = event.target.dataset?.reportField;
  if (!field) return;
  reportForm[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  if (field === "peopleText") reportForm.peopleEdited = true;
  if (field === "reportTitle") reportForm.titleEdited = true;
  if (field === "experimentId") { reportForm.titleEdited = false; render(); } // đổi bài → tên bài mặc định đổi theo
}

/** Mặc định ô "Họ và tên - MSSV": mỗi thành viên một dòng; chưa có MSSV thì để sẵn "Tên - " cho người dùng điền tiếp. */
function defaultPeopleText() {
  return state.team.map(name => `${name} - ${state.teamIds[name] || ""}`).join("\n");
}

/** "Họ tên - MSSV" → { name, id }. Chấp nhận " - " có khoảng trắng (tên có dấu gạch như "Minh-Anh" vẫn đúng) hoặc "Tên-123456". */
function parsePersonLine(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.+?)\s+[-–—]\s+(.+)$/) || text.match(/^(.+?)\s*[-–—]\s*(\d[\w.]*)$/);
  return match ? { name: match[1].trim(), id: match[2].trim() } : { name: text.replace(/\s*[-–—]\s*$/, "").trim(), id: "" };
}

async function addNames() {
  const inp = root.querySelector("#st-names");
  // Mỗi mục có dạng "Họ tên" hoặc "Họ tên - MSSV"; gộp trùng theo tên, ưu tiên mục có MSSV.
  const byName = new Map();
  inp.value.split(/[,;\n]/).map(parsePersonLine).filter(person => person.name).forEach(person => {
    const key = person.name.toLowerCase();
    const current = byName.get(key);
    if (!current || (!current.id && person.id)) byName.set(key, person);
  });
  const people = [...byName.values()];
  if (!people.length) return;
  const exist = new Map(state.team.map(n => [n.toLowerCase(), n]));
  const fresh = people.filter(person => !exist.has(person.name.toLowerCase()));
  // Thành viên đã có nhưng nhập thêm / đổi MSSV → cập nhật MSSV.
  const idUpdates = people
    .filter(person => exist.has(person.name.toLowerCase()) && person.id && state.teamIds[exist.get(person.name.toLowerCase())] !== person.id)
    .map(person => ({ name: exist.get(person.name.toLowerCase()), id: person.id }));
  if (!fresh.length && !idUpdates.length) return toast("Tên đã có trong danh sách", "warn");
  const ids = {};
  [...fresh.filter(person => person.id), ...idUpdates].forEach(person => { ids[person.name] = person.id; });
  const update = {};
  if (fresh.length) update.team_members = arrayUnion(...fresh.map(person => person.name));
  if (Object.keys(ids).length) update.team_ids = ids;
  try {
    await Promise.race([setDoc(CFG(), update, { merge: true }), new Promise(r => setTimeout(r, 6000))]);
    inp.value = "";
    const parts = [];
    if (fresh.length) parts.push(`Đã thêm ${fresh.length} thành viên`);
    if (idUpdates.length) parts.push(`cập nhật MSSV cho ${idUpdates.length} người`);
    toast(parts.join(", "), "success");
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
    try {
      await setDoc(CFG(), { team_members: arrayRemove(name), team_ids: { [name]: deleteField() } }, { merge: true });
      toast("Đã xóa", "success");
    }
    catch (err) { toast("Lỗi: " + (err.code || err.message), "error"); }
  }
  if (btn.dataset.act === "reset-report-defaults") {
    reportForm.peopleEdited = false;
    reportForm.titleEdited = false;
    render();
    return toast("Đã lấy lại từ danh sách thành viên", "success");
  }
  if (btn.dataset.act === "rename") {
    const currentId = state.teamIds[name] || "";
    const input = await promptBox({
      title: "Sửa thành viên", label: "Họ tên - MSSV",
      value: currentId ? `${name} - ${currentId}` : name, placeholder: "Phan Văn A - 123456"
    });
    if (!input) return;
    const next = parsePersonLine(input);
    if (!next.name || (next.name === name && next.id === currentId)) return;
    try {
      await runTransaction(db, async tx => {
        const s = await tx.get(CFG());
        const data = s.data() || {};
        const arr = (data.team_members || []).slice();
        const ids = { ...(data.team_ids || {}) };
        const i = arr.indexOf(name);
        if (i < 0) throw new Error("Tên này không còn trong danh sách");
        if (arr.some((n, j) => j !== i && n.toLowerCase() === next.name.toLowerCase())) throw new Error("Tên bị trùng");
        delete ids[name];
        arr[i] = next.name;
        if (next.id) ids[next.name] = next.id;
        tx.update(CFG(), { team_members: arr, team_ids: ids });
      });
      toast("Đã cập nhật", "success");
    } catch (err) { toast("Lỗi: " + (err.message || err.code), "error"); }
  }
}

async function exportReport() {
  if (reportBusy) return;
  if (!parseReportPeople(reportForm.peopleText).length) return toast("Hãy nhập ít nhất một dòng theo dạng Họ tên - MSSV.", "warn");
  const raw = state.experiments.find(exp => exp.id === reportForm.experimentId);
  if (!raw) return toast("Hãy chọn bài thí nghiệm.", "warn");

  reportBusy = true;
  lastReport = null;
  render();
  try {
    const report = await collectReportData();
    const result = await driveCreateReport(report);
    lastReport = { url: result.url, name: result.name };
    console.info("[LabMana] kết quả tạo báo cáo:", result, "| dữ liệu gửi đi:", report);
    const imageCount = report.steps.reduce((total, step) => total + step.photos.length, 0);
    const outdated = result.build ? "" : " Apps Script đang chạy bản CŨ (chưa có report.gs mới) — hãy Deploy → Manage deployments → New version.";
    const detail = result.build
      ? ` Lượt: ${report.runName}. Gửi ${result.photos_received} ảnh, nhúng ${result.photos_embedded}.`
      : "";
    const reasons = result.skip_reasons?.length ? ` Lý do: ${result.skip_reasons[0]}` : "";
    const notOnDrive = (report.inlinePhotos ? ` ${report.inlinePhotos} ảnh chưa lên Drive nhưng được nhúng từ bản lưu trong nhật ký.` : "")
      + (result.images_skipped_client ? ` ${result.images_skipped_client} ảnh quá lớn/không đọc được nên bị bỏ.` : "");
    const embedFailed = result.images_skipped_server ? ` ${result.images_skipped_server} ảnh không nhúng được (link Drive vẫn có trong tài liệu).` : "";
    const noPhotos = reportForm.includePhotos && !imageCount && !result.images_skipped_client;
    const message = noPhotos
      ? `Đã tạo Google Docs nhưng lượt "${report.runName}" chưa có ảnh Drive để chèn.${outdated}`
      : `Đã tạo báo cáo.${detail}${notOnDrive}${embedFailed}${reasons}${outdated}`;
    const warn = noPhotos || result.images_skipped || !result.build;
    toast(message, warn ? "warn" : "success", warn ? 15000 : 6000);
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
  const people = parseReportPeople(reportForm.peopleText);
  if (!people.length) throw new Error("Hãy nhập ít nhất một dòng theo dạng Họ tên - MSSV.");
  const incomplete = String(reportForm.peopleText || "").split(/\r?\n/).map(line => line.trim()).filter(line => line && !parsePersonLine(line).id);
  if (incomplete.length) throw new Error(`Còn ${incomplete.length} dòng chưa có MSSV (“${incomplete[0]}”). Hãy điền MSSV hoặc xóa dòng đó trong ô Họ và tên - MSSV.`);

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
  let droppedPhotos = 0;
  const steps = flatten(experiment).filter(item => item.si > 0).map(item => {   // báo cáo chỉ nạp từ TN1, bỏ phần CB
    const log = logs[item.step.id] || {};
    const photos = Array.isArray(log.photos) && log.photos.length
      ? log.photos
      : (log.photo_file_id || log.photo_url ? [{ file_id: log.photo_file_id || "", url: log.photo_url || "", name: log.photo_name || "" }] : []);
    const reportPhotos = reportForm.includePhotos ? photos.map((photo, index) => {
      const fileId = photo?.file_id || driveIdFromUrl(photo?.url);
      const url = String(photo?.url || "");
      const name = photo?.name || `TN${item.si}_${item.label}_Anh${index + 1}`;
      const code = photoCode(name, item.label, index);
      if (fileId) return { file_id: fileId, name, code };
      // Ảnh dự phòng (Drive chưa xác nhận lúc tải): gửi kèm nội dung để Apps Script vẫn nhúng được vào Docs.
      if (url.startsWith("data:image/")) {
        if (url.length <= INLINE_PHOTO_MAX_CHARS) return { file_id: "", name, code, data_url: url };
        droppedPhotos++;
      }
      return null;
    }).filter(Boolean) : [];
    const observation = reportForm.includeObservation ? log.observation_text || "" : "";
    return {
      section: `${item.si}. ${item.sec.section_name || "Thí nghiệm"}`,
      label: item.label,
      // Cột "Các bước tiến hành": tiêu đề + hướng dẫn thao tác (số bước được in đậm riêng ở đầu ô).
      action: `${item.step.title || ""}\n${item.step.text || ""}`.replace(/\n{3,}/g, "\n\n").trim(),
      measurement: reportForm.includeMeasurement && log.input_data != null ? `${log.input_data}${log.input_unit ? ` ${log.input_unit}` : ""}` : "",
      observation: placePhotoMarkers(observation, reportPhotos),
      explanation: reportForm.includeExplanation ? log.explanation_text || "" : "",
      photos: reportPhotos
    };
  });
  if (!steps.length) throw new Error("Báo cáo chỉ nạp từ TN1 trở đi, nhưng bài này chưa có thí nghiệm nào ngoài phần Chuẩn bị.");
  const imagesSkipped = droppedPhotos;
  const inlinePhotos = steps.reduce((total, step) => total + step.photos.filter(photo => photo.data_url).length, 0);
  return {
    experimentTitle: experiment.title || "Bài thí nghiệm",
    reportTitle: reportForm.reportTitle.trim() || experiment.title || "Bài thí nghiệm",
    runName: run.name || run.id,
    people,
    group: reportForm.group.trim(),
    date: reportForm.date || localDate(),
    semester: reportForm.semester.trim(),
    imagesSkipped,
    inlinePhotos,
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
      const photosByCode = new Map(step.photos.map(photo => {
        if (!photo.file_id) {
          // Ảnh lưu dự phòng trong nhật ký: hiển thị trực tiếp, chưa có link Drive.
          return [photo.code, `<div class="report-photo"><img src="${photo.data_url}" alt="${esc(photo.name || "Ảnh hiện tượng")}"><span>${esc(photo.name || "Ảnh lưu kèm nhật ký")}</span></div>`];
        }
        const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(photo.file_id)}&sz=w800`;
        const link = `https://drive.google.com/file/d/${encodeURIComponent(photo.file_id)}/view`;
        const html = `<div class="report-photo"><a href="${link}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="${esc(photo.name || "Ảnh hiện tượng")}"></a><a href="${link}" target="_blank" rel="noopener noreferrer">${esc(photo.name || "Mở ảnh trên Drive")}</a></div>`;
        return [photo.code, html];
      }));
      const observed = [step.measurement ? `Số liệu: ${step.measurement}` : "", step.observation].filter(Boolean).join("\n");
      // Dùng chung bộ chuyển Markdown/LaTeX với SOP: hỗ trợ bảng viết bằng |...|.
      let observationHtml = richHtml(observed);
      const photoEntries = [...photosByCode.entries()].sort((a, b) => b[0].length - a[0].length);
      for (const [code, html] of photoEntries) observationHtml = observationHtml.split(esc(code)).join(html);
      if (!observed.trim() && !step.photos.length) observationHtml = "Chưa ghi nhận hiện tượng.";
      const actionHtml = richHtml(step.action) || "Chưa có nội dung thao tác.";
      const explanationHtml = String(step.explanation || "").trim() ? richHtml(step.explanation) : "Chưa ghi nhận giải thích.";
      return `<tr><td>${esc(step.section)}</td><td><strong>${esc(step.label)}</strong><br>${actionHtml}</td><td>${observationHtml}</td><td>${explanationHtml}</td></tr>`;
    }).join("");
    const peopleHtml = report.people.map(person => `<div>${esc(person.name)} - ${esc(person.studentId)}</div>`).join("");
    const values = {
      "{{PEOPLE}}": peopleHtml,
      "{{GROUP}}": esc(report.group || "________________"),
      "{{EXPERIMENT}}": esc(report.reportTitle),
      "{{REPORT_DATE}}": esc(formatReportDate(report.date)),
      "{{SEMESTER}}": esc(report.semester || "HỌC KỲ / NĂM HỌC"),
      "{{REPORT_ROWS}}": rows
    };
    for (const [token, value] of Object.entries(values)) template = template.split(token).join(value);
    previewWindow.document.open();
    previewWindow.document.write(template);
    previewWindow.document.close();
    // Render công thức hóa học giống tab SOP trong cửa sổ xem trước.
    renderMath(previewWindow.document.body);
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

function parseReportPeople(value) {
  return String(value || "").split(/\r?\n/).map(line => {
    const person = parsePersonLine(line);
    return { name: person.name, studentId: person.id };
  }).filter(person => person.name && person.studentId);
}

function photoCode(name, stepLabel, index) {
  const base = String(name || "").replace(/\.[^.]+$/, "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `[[IMG_${base || `STEP_${stepLabel.replace(".", "_")}`}_${index + 1}]]`;
}

/** Khi số ảnh khớp số đoạn (hoặc số dòng), gắn ảnh ngay dưới hiện tượng đó. Không khớp thì để cuối ô. */
function placePhotoMarkers(observation, photos) {
  const text = String(observation || "").replace(/\s+$/, "");
  if (!photos.length) return text;
  if (isMarkdownTable(text)) return joinPhotoMarkers(text, photos);
  const paragraphs = text.split(/\n[ \t]*\n/).map(block => block.replace(/^\n+|\n+$/g, "")).filter(block => block.trim());
  const lines = text.split(/\n/).filter(line => line.trim());
  const useParagraphs = paragraphs.length > 1 && paragraphs.length === photos.length;
  const useLines = !useParagraphs && lines.length > 1 && lines.length === photos.length;
  if (useParagraphs) return zipPhotoBlocks(paragraphs, photos, "\n\n");
  if (useLines) return zipPhotoLines(text, photos);
  return joinPhotoMarkers(text, photos);
}

function joinPhotoMarkers(text, photos) {
  return [text, ...photos.map(photo => photo.code)].filter(Boolean).join("\n");
}

function zipPhotoBlocks(blocks, photos, separator) {
  const pairCount = Math.min(blocks.length, photos.length);
  const parts = [];
  for (let i = 0; i < blocks.length; i++) {
    parts.push(blocks[i]);
    if (i < pairCount) parts.push(photos[i].code);
  }
  for (let i = pairCount; i < photos.length; i++) parts.push(photos[i].code);
  return parts.join(separator);
}

function zipPhotoLines(text, photos) {
  const lines = text.split(/\n/);
  const contentIndexes = [];
  lines.forEach((line, index) => { if (line.trim()) contentIndexes.push(index); });
  const pairCount = Math.min(contentIndexes.length, photos.length);
  const after = new Map();
  for (let i = 0; i < pairCount; i++) after.set(contentIndexes[i], photos[i].code);
  const out = [];
  lines.forEach((line, index) => {
    out.push(line);
    if (after.has(index)) out.push(after.get(index));
  });
  for (let i = pairCount; i < photos.length; i++) out.push(photos[i].code);
  return out.join("\n");
}

function isMarkdownTable(text) {
  return String(text || "").split(/\n/).some(line => {
    const value = line.trim();
    return value.startsWith("|") && value.endsWith("|") && value.length > 2 && value.slice(1, -1).includes("|");
  });
}