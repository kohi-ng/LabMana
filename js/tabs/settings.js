// ============ Tab Cài đặt (thành viên + xuất báo cáo) ============
import { state, on } from "../store.js";
import { auth, db } from "../firebase.js";
import { doc, collection, query, where, getDocs, setDoc, arrayUnion, arrayRemove, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, richHtml, toast, confirmBox, promptBox, statusCard, renderMath } from "../utils.js";
import { driveCreateReport, driveDelete, driveCheck, driveImageUrl, driveFileUrl, driveDownloadUrl, isDriveConfigured } from "../drive.js";
import { normalizeExperiment, flatten } from "../plan-logic.js";

let root;
const CFG = () => doc(db, "config", "lab");
const reportForm = {
  peopleText: "", group: "", date: localDate(), semester: "Học kỳ 1, năm học 2026-2027",
  actionTemplate: "{title}\n{text}",
  includeMeasurement: true, includeObservation: true, includeExplanation: true, includePhotos: true
};
let reportBusy = false, lastReport = null;
let gallery = { experimentId: "", status: "idle", items: [], error: "", busyId: "" };

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
  ensureGallery();
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
      ${!isDriveConfigured ? `<p class="muted small" style="margin-top:8px">Mở <code>js/drive.js</code> và dán URL Web App; xem hướng dẫn triển khai ở đầu file <code>GAS/code.gs</code>.</p>` : ""}
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
        <label class="lbl report-people-label">Họ và tên - MSSV (mỗi người một dòng)
          <textarea class="inp" rows="4" data-report-field="peopleText" placeholder="Phan Văn A - 123&#10;Nguyễn Văn B - 456">${esc(reportForm.peopleText)}</textarea>
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
      <details class="report-content-settings" open>
        <summary>Nội dung ghép vào báo cáo</summary>
        <p class="muted small">Chọn dữ liệu cần xuất. Có thể tự ghép cột “Các bước tiến hành” bằng các biến bên dưới. Số bước luôn in đậm ở đầu ô, không cần chèn lại trong mẫu. Ảnh nằm trong ô hiện tượng của đúng bước. Khi số ảnh bằng số dòng hiện tượng, hoặc bằng số đoạn cách nhau bởi một dòng trống, mỗi ảnh được gắn ngay dưới hiện tượng tương ứng. Ảnh mới được thu về JPEG/PNG/GIF dưới 2 MB để Docs nhúng được; ảnh cũ không đúng định dạng đó chỉ còn link Drive.</p>
        <div class="report-options">
          <label><input type="checkbox" data-report-field="includeMeasurement" ${reportForm.includeMeasurement ? "checked" : ""}> Số liệu đã nhập</label>
          <label><input type="checkbox" data-report-field="includeObservation" ${reportForm.includeObservation ? "checked" : ""}> Hiện tượng quan sát</label>
          <label><input type="checkbox" data-report-field="includeExplanation" ${reportForm.includeExplanation ? "checked" : ""}> Giải thích / PTPƯ</label>
          <label><input type="checkbox" data-report-field="includePhotos" ${reportForm.includePhotos ? "checked" : ""}> Ảnh Drive trong cột hiện tượng</label>
        </div>
        <label class="lbl">Mẫu ghép “Các bước tiến hành”
          <textarea class="inp" rows="3" data-report-field="actionTemplate" placeholder="{title}\\n{text}">${esc(reportForm.actionTemplate)}</textarea>
        </label>
        <p class="muted small">Biến dùng được: <code>{title}</code> tiêu đề, <code>{text}</code> hướng dẫn thao tác, <code>{value}</code> số liệu, <code>{unit}</code> đơn vị. Số bước luôn được ghép ở đầu ô.</p>
      </details>
      <button type="button" class="btn primary report-submit" data-act="export-report" ${reportBusy || !isDriveConfigured || !state.experiments.length ? "disabled" : ""}>
        ${reportBusy ? "Đang tạo tài liệu…" : "Tạo Google Docs"}
      </button>
      <button type="button" class="btn report-preview" data-act="preview-report" ${reportBusy || !state.experiments.length ? "disabled" : ""}>Xem trước biểu mẫu</button>
      ${galleryHtml()}
      ${lastReport ? `<p class="report-result"><span>Đã tạo: ${esc(lastReport.name)}</span><a class="btn primary" href="${esc(lastReport.url)}" target="_blank" rel="noopener noreferrer">Xem báo cáo ↗</a></p>` : ""}
    </div>

    <div class="card"><h3>ℹ️ Về ứng dụng</h3>
      <p class="small muted">LabMana v2.0 · Đăng nhập ẩn danh (mã thiết bị: <code>${esc((auth?.currentUser?.uid || "").slice(0, 6))}</code>)<br>
      Thí nghiệm đang mở được lưu trên thiết bị; dữ liệu ghi nhận đồng bộ qua Firestore.</p></div>`;
  root.querySelector("#st-names").value = keep;
}

function onReportInput(event) {
  const field = event.target.dataset?.reportField;
  if (!field) return;
  reportForm[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  if (field === "experimentId") {
    gallery.status = "idle";
    render();
  }
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
  if (btn.dataset.act === "refresh-gallery") { gallery.status = "idle"; render(); return; }
  if (btn.dataset.act === "sync-gallery") return syncMissingImages();
  if (btn.dataset.act === "del-gallery") return deleteGalleryItem(btn.dataset.key);
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
    const outdated = result.build ? "" : " ⚠ Apps Script đang chạy bản CŨ (chưa có report.gs mới) — hãy Deploy → Manage deployments → New version.";
    const detail = result.build
      ? ` Lượt: ${report.runName}. Gửi ${result.photos_received} ảnh, nhúng ${result.photos_embedded}.`
      : "";
    const reasons = result.skip_reasons?.length ? ` Lý do: ${result.skip_reasons[0]}` : "";
    const notOnDrive = result.images_skipped_client
      ? ` ${result.images_skipped_client} ảnh CHƯA nằm trên Drive (chỉ lưu dự phòng trong nhật ký) nên không vào báo cáo.`
      : "";
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


function ensureGallery() {
  const id = reportForm.experimentId || "";
  if (!id) {
    gallery = { experimentId: "", status: "ready", items: [], error: "", busyId: "" };
    return;
  }
  if (gallery.experimentId === id && gallery.status !== "idle") return;
  gallery = { experimentId: id, status: "loading", items: [], error: "", busyId: "" };
  loadGallery(id);
}

async function loadGallery(id) {
  try {
    const raw = state.experiments.find(exp => exp.id === id);
    if (!raw) throw new Error("Không thấy bài thí nghiệm.");
    const experiment = normalizeExperiment(raw);
    const items = [];
    experiment.sections.forEach((sec, si) => {
      sec.steps.forEach((step, sti) => {
        (step.images || []).forEach((im, index) => {
          const fileId = im.file_id || driveIdFromUrl(im.url);
          items.push({
            key: `plan:${step.id}:${index}:${fileId || im.url || ""}`,
            source: "plan",
            section: sec.section_name || `Thí nghiệm ${si + 1}`,
            stepLabel: step.title || `Thao tác ${sti + 1}`,
            name: im.name || "Ảnh kế hoạch",
            fileId,
            url: im.url || "",
            stepId: step.id
          });
        });
      });
    });
    const runsSnapshot = await getDocs(query(collection(db, "runs"), where("exp_id", "==", id)));
    for (const runDoc of runsSnapshot.docs) {
      const run = { id: runDoc.id, ...runDoc.data() };
      const logsSnapshot = await getDocs(query(collection(db, "execution_logs"), where("run_id", "==", run.id)));
      logsSnapshot.forEach(logDoc => {
        const log = logDoc.data();
        const photos = Array.isArray(log.photos) && log.photos.length
          ? log.photos
          : (log.photo_file_id || log.photo_url ? [{ file_id: log.photo_file_id || "", url: log.photo_url || "", name: "" }] : []);
        photos.forEach((photo, index) => {
          const fileId = photo?.file_id || driveIdFromUrl(photo?.url);
          items.push({
            key: `log:${logDoc.id}:${index}:${fileId || photo?.url || ""}`,
            source: "log",
            section: "Nhật ký thực hiện",
            stepLabel: log.step_label || log.step_id || "",
            name: photo?.name || "Ảnh thực hiện",
            fileId,
            url: photo?.url || "",
            logId: logDoc.id,
            runName: run.name || run.id
          });
        });
      });
    }
    if (gallery.experimentId !== id) return;
    gallery.status = "ready";
    gallery.items = items;
    gallery.error = "";
    render();
  } catch (err) {
    console.error(err);
    if (gallery.experimentId !== id) return;
    gallery.status = "error";
    gallery.error = err.message || String(err);
    render();
  }
}

function galleryHtml() {
  if (!reportForm.experimentId) return "";
  const head = `<div class="report-gallery"><h4>Ảnh của bài này</h4>
    <p class="muted small">Danh sách ảnh kế hoạch và ảnh nhật ký đang gắn với bài. Tải về hoặc xóa. Nếu file đã bị xóa tay trên Drive, bấm Xóa vẫn gỡ id trên Firebase để hết lệch dữ liệu.</p>
    <div class="report-gallery-actions">
      <button type="button" class="btn sm" data-act="refresh-gallery">Tải lại danh sách</button>
      <button type="button" class="btn sm" data-act="sync-gallery" ${gallery.busyId ? "disabled" : ""}>Gỡ ảnh Drive đã mất</button>
    </div>`;
  if (gallery.status === "loading") return `${head}<p class="muted small">Đang đọc ảnh…</p></div>`;
  if (gallery.status === "error") return `${head}<p class="muted small">Không đọc được ảnh: ${esc(gallery.error)}</p></div>`;
  if (!gallery.items.length) return `${head}<p class="muted small">Bài này chưa có ảnh.</p></div>`;
  const rows = gallery.items.map(item => {
    const src = item.fileId ? driveImageUrl(item.fileId) : item.url;
    const view = item.fileId ? driveFileUrl(item.fileId) : item.url;
    const down = item.fileId ? driveDownloadUrl(item.fileId) : item.url;
    const where = [item.section, item.stepLabel, item.runName].filter(Boolean).join(" · ");
    return `<article class="report-gallery-item">
      ${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<div class="report-gallery-missing">Không xem được</div>`}
      <div>
        <b>${esc(item.name || "Ảnh")}</b>
        <div class="muted small">${esc(where)}${item.fileId ? "" : " · không có file Drive"}</div>
        <div class="report-gallery-actions">
          ${down ? `<a class="btn sm" href="${esc(down)}" target="_blank" rel="noopener noreferrer">Tải</a>` : ""}
          ${view ? `<a class="btn sm" href="${esc(view)}" target="_blank" rel="noopener noreferrer">Mở</a>` : ""}
          <button type="button" class="btn sm danger" data-act="del-gallery" data-key="${esc(item.key)}" ${gallery.busyId === item.key ? "disabled" : ""}>${gallery.busyId === item.key ? "Đang xóa…" : "Xóa"}</button>
        </div>
      </div>
    </article>`;
  }).join("");
  return `${head}${rows}</div>`;
}

async function deleteGalleryItem(key) {
  const item = gallery.items.find(entry => entry.key === key);
  if (!item || gallery.busyId) return;
  if (!(await confirmBox(`Xóa "${item.name || "ảnh"}"? Bản ghi Firebase sẽ được gỡ dù file Drive đã mất.`, "Xóa ảnh"))) return;
  gallery.busyId = key;
  render();
  try {
    let missing = false;
    if (item.fileId) {
      const result = await driveDelete(item.fileId);
      missing = !!result?.missing;
    }
    if (item.source === "plan") await removePlanImage(item);
    else await removeLogImage(item);
    toast(missing ? "Drive không còn file. Đã gỡ id trên Firebase." : "Đã xóa ảnh.", "success", 5000);
    gallery.status = "idle";
    gallery.busyId = "";
    render();
  } catch (err) {
    console.error(err);
    gallery.busyId = "";
    render();
    toast("Không xóa được: " + (err.message || err.code || err), "error", 6000);
  }
}

async function syncMissingImages() {
  if (gallery.busyId || gallery.status !== "ready") return;
  const targets = gallery.items.filter(item => item.fileId);
  if (!targets.length) return toast("Không có file Drive để đối soát.", "warn");
  gallery.busyId = "sync";
  render();
  try {
    let removed = 0;
    let unknown = false;
    for (const item of targets) {
      const check = await driveCheck(item.fileId);
      if (check == null) { unknown = true; break; }
      if (check.exists) continue;
      if (item.source === "plan") await removePlanImage(item);
      else await removeLogImage(item);
      removed++;
    }
    gallery.busyId = "";
    gallery.status = "idle";
    render();
    if (unknown) {
      toast("Apps Script chưa có lệnh kiểm tra file. Hãy Deploy bản GAS mới (New version). Nút Xóa từng ảnh vẫn gỡ được id đã mất.", "warn", 9000);
      return;
    }
    toast(removed ? `Đã gỡ ${removed} ảnh không còn trên Drive.` : "Mọi ảnh trong danh sách vẫn còn trên Drive.", removed ? "success" : "success", 5000);
  } catch (err) {
    console.error(err);
    gallery.busyId = "";
    render();
    toast("Đối soát thất bại: " + (err.message || err), "error", 6000);
  }
}

async function removePlanImage(item) {
  const raw = state.experiments.find(exp => exp.id === reportForm.experimentId);
  if (!raw) throw new Error("Không thấy bài để cập nhật.");
  const experiment = normalizeExperiment(raw);
  let changed = false;
  for (const sec of experiment.sections) {
    for (const step of sec.steps) {
      if (item.stepId && step.id !== item.stepId && item.fileId) {
        const before = step.images.length;
        step.images = step.images.filter(im => (im.file_id || driveIdFromUrl(im.url)) !== item.fileId);
        if (step.images.length !== before) changed = true;
        continue;
      }
      if (step.id !== item.stepId) continue;
      const before = step.images.length;
      step.images = step.images.filter(im => {
        const id = im.file_id || driveIdFromUrl(im.url);
        if (item.fileId) return id !== item.fileId;
        return im.url !== item.url;
      });
      if (step.images.length !== before) changed = true;
    }
  }
  if (!changed) return;
  raw.sections = experiment.sections;
  const { id, ...data } = raw;
  data.sections = experiment.sections;
  data.updated_at_ms = Date.now();
  await setDoc(doc(db, "experiments", reportForm.experimentId), data);
}

async function removeLogImage(item) {
  gallery.items = gallery.items.filter(entry => entry.key !== item.key);
  const siblings = gallery.items.filter(entry => entry.source === "log" && entry.logId === item.logId);
  const photos = siblings.map(entry => ({
    file_id: entry.fileId || "",
    url: entry.url || (entry.fileId ? driveImageUrl(entry.fileId) : ""),
    name: entry.name || ""
  }));
  const primary = photos[0] || null;
  await setDoc(doc(db, "execution_logs", item.logId), {
    photos,
    photo_file_id: primary?.file_id || null,
    photo_url: primary?.url || null
  }, { merge: true });
}

async function collectReportData() {
  const raw = state.experiments.find(exp => exp.id === reportForm.experimentId);
  if (!raw) throw new Error("Hãy chọn bài thí nghiệm.");
  const people = parseReportPeople(reportForm.peopleText);
  if (!people.length) throw new Error("Hãy nhập ít nhất một dòng theo dạng Họ tên - MSSV.");

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
    const reportPhotos = reportForm.includePhotos ? photos.map((photo, index) => {
      const fileId = photo?.file_id || driveIdFromUrl(photo?.url);
      if (!fileId) return null;
      const name = photo?.name || `TN${item.si + 1}_${item.label}_Anh${index + 1}`;
      const code = photoCode(name, item.label, index);
      return { file_id: fileId, name, code };
    }).filter(Boolean) : [];
    const observation = reportForm.includeObservation ? log.observation_text || "" : "";
    return {
      section: `${item.si + 1}. ${item.sec.section_name || "Thí nghiệm"}`,
      label: item.label,
      action: reportForm.actionTemplate
        .replaceAll("{label}", "")
        .replaceAll("{title}", item.step.title || "")
        .replaceAll("{text}", item.step.text || "")
        .replaceAll("{value}", reportForm.includeMeasurement && log.input_data != null ? String(log.input_data) : "")
        .replaceAll("{unit}", reportForm.includeMeasurement ? log.input_unit || "" : "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      measurement: reportForm.includeMeasurement && log.input_data != null ? `${log.input_data}${log.input_unit ? ` ${log.input_unit}` : ""}` : "",
      observation: placePhotoMarkers(observation, reportPhotos),
      explanation: reportForm.includeExplanation ? log.explanation_text || "" : "",
      photos: reportPhotos
    };
  });
  const imagesSkipped = reportForm.includePhotos
    ? flatten(experiment).reduce((count, item) => {
      const log = logs[item.step.id] || {};
      const photos = Array.isArray(log.photos) && log.photos.length
        ? log.photos
        : (log.photo_file_id || log.photo_url ? [{ file_id: log.photo_file_id || "", url: log.photo_url || "" }] : []);
      return count + photos.filter(photo => {
        const url = String(photo?.url || "");
        return !photo?.file_id && !driveIdFromUrl(url) && url.startsWith("data:image/");
      }).length;
    }, 0)
    : 0;
  return {
    experimentTitle: experiment.title || "Bài thí nghiệm",
    runName: run.name || run.id,
    people,
    group: reportForm.group.trim(),
    date: reportForm.date || localDate(),
    semester: reportForm.semester.trim(),
    imagesSkipped,
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
        const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(photo.file_id)}&sz=w800`;
        const link = `https://drive.google.com/file/d/${encodeURIComponent(photo.file_id)}/view`;
        const html = `<div class="report-photo"><a href="${link}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="${esc(photo.name || "Ảnh hiện tượng")}"></a><a href="${link}" target="_blank" rel="noopener noreferrer">${esc(photo.name || "Mở ảnh trên Drive")} ↗</a></div>`;
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
      "{{EXPERIMENT}}": esc(report.experimentTitle),
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
    const match = line.trim().match(/^(.+?)\s*[-–—]\s*(.+)$/);
    return match ? { name: match[1].trim(), studentId: match[2].trim() } : null;
  }).filter(person => person?.name && person?.studentId);
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