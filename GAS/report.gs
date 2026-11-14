/**
 * LabMana — helpers for exporting a completed experiment to Google Docs.
 * Add this file to the same Apps Script project as code.gs VÀ math-render.gs
 * (math-render.gs cung cấp hàm compileFormulas_() dùng bên dưới để "biên dịch"
 * công thức $...$ / \ce{...} sang Unicode — Apps Script dùng chung scope giữa
 * các file .gs trong cùng project nên không cần import gì thêm).
 */
function handleCreateReport_(report) {
  if (!report || typeof report !== "object") throw new Error("Thiếu dữ liệu báo cáo.");
  const experimentTitle = reportText_(report.experimentTitle, 240);
  const reportDate = reportText_(report.date, 40);
  const semester = reportText_(report.semester, 100);
  const group = reportText_(report.group, 100);
  const people = Array.isArray(report.people) ? report.people.map(person => ({
    name: reportText_(person.name, 160),
    studentId: reportText_(person.studentId, 80)
  })).filter(person => person.name && person.studentId) : [];
  const steps = Array.isArray(report.steps) ? report.steps : [];
  let imagesSkipped = Number(report.imagesSkipped) || 0;
  if (!people.length || !experimentTitle || !reportDate) {
    throw new Error("Báo cáo cần có ít nhất một người (họ tên và MSSV), bài thí nghiệm và ngày báo cáo.");
  }
  if (!steps.length || steps.length > 200) throw new Error("Số thao tác trong báo cáo không hợp lệ.");
  const photoCount = steps.reduce((total, step) => total + (Array.isArray(step.photos) ? step.photos.length : 0), 0);
  if (photoCount > 80) throw new Error("Báo cáo có quá nhiều ảnh (tối đa 80 ảnh).");

  const preparedSteps = steps.map(step => {
    const photos = Array.isArray(step.photos) ? step.photos : [];
    return {
      section: compileFormulas_(reportText_(step.section, 240)),
      label: reportText_(step.label, 32),
      // "Các bước tiến hành" giữ dạng thô ở đây: có thể chứa bảng Markdown (cú pháp Planner),
      // nên việc tách bảng + biên dịch công thức được làm khi chèn vào Docs (xem appendActionCell_),
      // không compile trước ở đây để tránh làm mất ranh giới dòng "|...|" của bảng.
      action: reportText_(step.action, 10000),
      measurement: compileFormulas_(reportText_(step.measurement, 1000)),
      // Giữ nguyên mã [[IMG_...]] — compileFormulas_ có thể nuốt dấu _ trong công thức
      // nếu biên dịch cả ô trước khi tách ảnh. Công thức được biên dịch lúc chèn văn bản.
      observation: reportText_(step.observation, 10000),
      explanation: compileFormulas_(reportText_(step.explanation, 10000)),
      photos: photos.map(photo => {
        const fileId = reportText_(photo.file_id, 200);
        if (!fileId) throw new Error("Báo cáo có ảnh thiếu mã Drive.");
        const file = DriveApp.getFileById(fileId);
        if (!isInRootFolder_(file)) throw new Error("Ảnh báo cáo không thuộc thư mục LabMana.");
        return {
          fileId: fileId,
          name: reportText_(photo.name, 240),
          code: reportText_(photo.code, 500),
          blob: file.getBlob()
        };
      })
    };
  });
  const safeTitle = reportText_(experimentTitle, 80).replace(/[\\/:*?"<>|]+/g, "-");
  const peopleTitle = people.map(person => person.name).join(", ").slice(0, 120);
  const document = DocumentApp.create(`Báo cáo - ${safeTitle} - ${peopleTitle}`);
  const body = document.getBody();
  body.clear();
  body.setPageWidth(842).setPageHeight(595);
  body.setMarginTop(32).setMarginBottom(32).setMarginLeft(32).setMarginRight(32);

  const title = body.appendParagraph("BÁO CÁO THÍ NGHIỆM HÓA VÔ CƠ");
  setReportTextStyle_(title.editAsText(), false, 16);
  title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const termLine = body.appendParagraph(semester || "HỌC KỲ / NĂM HỌC");
  setReportTextStyle_(termLine.editAsText(), false);
  termLine.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const peopleHeading = body.appendParagraph("HỌ VÀ TÊN - MSSV:");
  setReportTextStyle_(peopleHeading.editAsText(), false);
  people.forEach(person => {
    const line = body.appendParagraph(`${person.name} - ${person.studentId}`);
    setReportTextStyle_(line.editAsText(), false);
  });
  [
    `NHÓM: ${group || "________________"}`,
    `NGÀY: ${reportDate_(reportDate)}`,
    "GVGD: TS. NGUYỄN BÌNH NGUYÊN"
  ].forEach(text => setReportTextStyle_(body.appendParagraph(text).editAsText(), false));
  const experimentTitleCompiled = compileFormulas_(experimentTitle);
  const experimentLine = body.appendParagraph(`BÀI SỐ: ${experimentTitleCompiled}`);
  const experimentText = experimentLine.editAsText();
  setReportTextStyle_(experimentText, false);
  const experimentOffset = experimentText.getText().indexOf(experimentTitleCompiled);
  if (experimentOffset >= 0 && experimentTitleCompiled.length) {
    experimentText.setBold(experimentOffset, experimentOffset + experimentTitleCompiled.length - 1, true);
  }
  body.appendParagraph("");

  const table = body.appendTable([[
    "Thí nghiệm",
    "Các bước tiến hành",
    "Hiện tượng quan sát thực tế",
    "Giải thích và PTPƯ minh họa"
  ]]);
  for (let column = 0; column < 4; column++) {
    const headerCell = table.getRow(0).getCell(column);
    headerCell.setBackgroundColor("#dce6f1");
    setReportTextStyle_(headerCell.editAsText(), true);
  }
  table.setColumnWidth(0, 160);
  table.setColumnWidth(1, 200);
  table.setColumnWidth(2, 209);
  table.setColumnWidth(3, 209);

  preparedSteps.forEach(step => {
    const row = table.appendTableRow();
    const sectionCell = row.appendTableCell(step.section || "Thí nghiệm");
    const actionCell = row.appendTableCell("");
    const observationText = [
      step.measurement ? `Số liệu: ${step.measurement}` : "",
      placePhotoMarkers_(step.observation, step.photos)
    ].filter(Boolean).join("\n");
    const observationCell = row.appendTableCell("");
    const explanationCell = row.appendTableCell("");
    setReportTextStyle_(sectionCell.editAsText(), false);
    appendActionCell_(actionCell, step.label, step.action);
    if (String(step.explanation || "").trim()) appendRichBlocks_(explanationCell, step.explanation);
    else setReportTextStyle_(explanationCell.appendParagraph("Chưa ghi nhận giải thích.").editAsText(), false);

    const photosByCode = {};
    step.photos.forEach(photo => { if (photo.code) photosByCode[photo.code] = photo; });
    const pending = Object.keys(photosByCode);
    let cursor = 0;
    while (pending.length) {
      let next = null;
      pending.forEach(code => {
        const at = observationText.indexOf(code, cursor);
        if (at < 0) return;
        if (!next || at < next.at || (at === next.at && code.length > next.code.length)) next = { at: at, code: code };
      });
      if (!next) break;
      appendRichBlocks_(observationCell, observationText.slice(cursor, next.at));
      appendReportPhoto_(observationCell, photosByCode[next.code], () => { imagesSkipped++; });
      cursor = next.at + next.code.length;
      pending.splice(pending.indexOf(next.code), 1);
    }
    appendRichBlocks_(observationCell, stripPhotoCodes_(observationText.slice(cursor), Object.keys(photosByCode)));
    if (!observationText.trim() && !step.photos.length) {
      const placeholder = observationCell.appendParagraph("Chưa ghi nhận hiện tượng.");
      setReportTextStyle_(placeholder.editAsText(), false);
    }
    step.photos.forEach((photo, index) => {
      if (photo.code && observationText.includes(photo.code)) return;
      appendReportPhoto_(observationCell, photo, () => { imagesSkipped++; }, index);
    });
  });

  document.saveAndClose();
  const file = DriveApp.getFileById(document.getId());
  file.moveTo(DriveApp.getFolderById(ROOT_FOLDER_ID));
  return {
    ok: true,
    document_id: document.getId(),
    name: document.getName(),
    url: document.getUrl(),
    images_skipped: imagesSkipped
  };
}

function setReportTextStyle_(text, bold, fontSize) {
  text.setFontFamily("Times New Roman").setFontSize(fontSize || 11).setBold(bold);
}

function appendReportText_(cell, text) {
  appendRichBlocks_(cell, text);
}

/** Đoạn văn thường hoặc bảng Markdown, cùng cách richHtml() tách khối trên web. */
function appendRichBlocks_(cell, text) {
  const value = String(text ?? "");
  if (!value) return;
  parseMarkdownBlocks_(value).forEach(block => {
    if (block.type === "table") appendActionTable_(cell, block);
    else block.lines.forEach(line => setReportTextStyle_(cell.appendParagraph(line).editAsText(), false));
  });
}

/**
 * Chèn cột "Các bước tiến hành": nhãn bước in đậm, sau đó nội dung thao tác —
 * có thể xen kẽ đoạn văn thường và bảng Markdown (cú pháp Planner "| a | b |").
 * Bảng được chèn bằng appendTable() lồng ngay trong ô, không in ký tự "|" như chữ thường.
 */
function appendActionCell_(cell, label, action) {
  const labelPara = cell.appendParagraph(String(label || ""));
  setReportTextStyle_(labelPara.editAsText(), true);

  const trimmedAction = String(action || "").trim();
  if (!trimmedAction) {
    setReportTextStyle_(cell.appendParagraph("Chưa có nội dung thao tác.").editAsText(), false);
    return;
  }
  appendRichBlocks_(cell, trimmedAction);
}

function appendActionTable_(cell, block) {
  const rows = [block.header, ...block.rows].map(row => row.map(value => value || ""));
  const nested = cell.appendTable(rows);
  const headerRow = nested.getRow(0);
  for (let column = 0; column < block.header.length; column++) {
    const headerCell = headerRow.getCell(column);
    headerCell.setBackgroundColor("#f0f3f7");
    setReportTextStyle_(headerCell.editAsText(), true, 10);
  }
  for (let r = 1; r < nested.getNumRows(); r++) {
    for (let c = 0; c < nested.getRow(r).getNumCells(); c++) {
      setReportTextStyle_(nested.getRow(r).getCell(c).editAsText(), false, 10);
    }
  }
  cell.appendParagraph(""); // khoảng cách nhỏ sau bảng để không dính đoạn văn kế tiếp
}

function appendReportPhoto_(cell, photo, onSkipped, index) {
  const caption = cell.appendParagraph(photo.name ? `Ảnh: ${photo.name}` : `Ảnh ${Number(index || 0) + 1}`);
  setReportTextStyle_(caption.editAsText(), false, 9);
  const blob = embeddableImageBlob_(photo.blob);
  if (blob) {
    try {
      // appendImage() của ô bảng hay đẩy ảnh lên đầu ô hoặc ra ngoài bảng.
      // Ảnh gắn vào một đoạn mới thì nằm ngay sau hiện tượng vừa chèn.
      const holder = cell.appendParagraph("");
      const image = holder.appendInlineImage(blob);
      if (image.getWidth() > 190) {
        const height = image.getHeight();
        const ratio = 190 / image.getWidth();
        image.setWidth(190);
        image.setHeight(Math.max(1, Math.round(height * ratio)));
      }
    } catch (err) {
      onSkipped();
      const warning = cell.appendParagraph("Không nhúng được ảnh; dùng link Drive bên dưới.");
      setReportTextStyle_(warning.editAsText(), false, 9);
      console.warn(`Không chèn được ảnh ${photo.fileId}: ${err}`);
    }
  } else {
    onSkipped();
    const warning = cell.appendParagraph("Ảnh quá lớn hoặc định dạng không hỗ trợ nhúng; dùng link Drive bên dưới.");
    setReportTextStyle_(warning.editAsText(), false, 9);
  }
  const link = cell.appendParagraph("Mở ảnh trên Google Drive");
  const linkText = link.editAsText();
  setReportTextStyle_(linkText, false, 9);
  linkText.setLinkUrl(0, linkText.getText().length - 1, `https://drive.google.com/file/d/${encodeURIComponent(photo.fileId)}/view`);
}

/** JPEG/PNG/GIF thật, kể cả khi Drive báo image/jpg hoặc application/octet-stream. */
function embeddableImageBlob_(blob) {
  if (!blob) return null;
  const bytes = blob.getBytes();
  if (!bytes || bytes.length < 8 || bytes.length > 2 * 1024 * 1024) return null;
  const sniffed = sniffImageMime_(bytes);
  const declared = normalizeImageMime_(blob.getContentType());
  const mime = sniffed || (["image/jpeg", "image/png", "image/gif"].includes(declared) ? declared : "");
  if (!mime) return null;
  return Utilities.newBlob(bytes, mime, "hien-tuong");
}

function normalizeImageMime_(mime) {
  const value = String(mime || "").toLowerCase().split(";")[0].trim();
  if (value === "image/jpg" || value === "image/pjpeg" || value === "image/jpe") return "image/jpeg";
  if (value === "image/x-png") return "image/png";
  return value;
}

function sniffImageMime_(bytes) {
  const b0 = unsignedByte_(bytes, 0), b1 = unsignedByte_(bytes, 1), b2 = unsignedByte_(bytes, 2), b3 = unsignedByte_(bytes, 3);
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "image/jpeg";
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return "image/png";
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return "image/gif";
  return "";
}

function unsignedByte_(bytes, index) {
  const value = bytes[index];
  return value < 0 ? value + 256 : value;
}

function stripPhotoCodes_(text, codes) {
  let out = String(text || "");
  codes.forEach(code => { if (code) out = out.split(code).join(""); });
  return out;
}

/**
 * Gắn ảnh vào hiện tượng cùng thứ tự khi số ảnh bằng số đoạn (dòng trống) hoặc số dòng.
 * Không khớp số lượng thì ảnh nằm cuối ô hiện tượng của đúng bước.
 * Mã do client chèn sẵn được gỡ rồi đặt lại, để bản Docs khớp bản xem trước.
 */
function placePhotoMarkers_(observation, photos) {
  const list = Array.isArray(photos) ? photos : [];
  const codes = list.map(photo => photo.code).filter(Boolean);
  const text = stripPhotoMarkerLines_(observation, codes);
  if (!list.length) return text;
  if (isMarkdownTable_(text)) return joinPhotoMarkers_(text, list);
  const paragraphs = text.split(/\n[ \t]*\n/).map(block => block.replace(/^\n+|\n+$/g, "")).filter(block => block.trim());
  const lines = text.split(/\n/).filter(line => line.trim());
  const useParagraphs = paragraphs.length > 1 && paragraphs.length === list.length;
  const useLines = !useParagraphs && lines.length > 1 && lines.length === list.length;
  if (useParagraphs) return zipPhotoBlocks_(paragraphs, list, "\n\n");
  if (useLines) return zipPhotoLines_(text, list);
  return joinPhotoMarkers_(text, list);
}

function stripPhotoMarkerLines_(text, codes) {
  const marker = {};
  codes.forEach(code => { if (code) marker[code] = true; });
  const lines = String(text || "").split(/\n/).filter(line => !marker[line.trim()]);
  let out = lines.join("\n");
  codes.forEach(code => { if (code) out = out.split(code).join(""); });
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function joinPhotoMarkers_(text, photos) {
  return [text, ...photos.map(photo => photo.code)].filter(Boolean).join("\n");
}

function zipPhotoBlocks_(blocks, photos, separator) {
  const pairCount = Math.min(blocks.length, photos.length);
  const parts = [];
  for (let i = 0; i < blocks.length; i++) {
    parts.push(blocks[i]);
    if (i < pairCount) parts.push(photos[i].code);
  }
  for (let i = pairCount; i < photos.length; i++) parts.push(photos[i].code);
  return parts.join(separator);
}

function zipPhotoLines_(text, photos) {
  const lines = String(text || "").split(/\n/);
  const contentIndexes = [];
  lines.forEach((line, index) => { if (line.trim()) contentIndexes.push(index); });
  const pairCount = Math.min(contentIndexes.length, photos.length);
  const after = {};
  for (let i = 0; i < pairCount; i++) after[contentIndexes[i]] = photos[i].code;
  const out = [];
  lines.forEach((line, index) => {
    out.push(line);
    if (Object.prototype.hasOwnProperty.call(after, index)) out.push(after[index]);
  });
  for (let i = pairCount; i < photos.length; i++) out.push(photos[i].code);
  return out.join("\n");
}

function isMarkdownTable_(text) {
  return String(text || "").split(/\n/).some(line => {
    const value = line.trim();
    return value.startsWith("|") && value.endsWith("|") && value.length > 2 && value.slice(1, -1).indexOf("|") >= 0;
  });
}

function reportText_(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function reportDate_(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}