/**
 * LabMana — helpers for exporting a completed experiment to Google Docs.
 * Add this file to the same Apps Script project as code.gs.
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
      section: reportText_(step.section, 240),
      label: reportText_(step.label, 32),
      action: reportText_(step.action, 10000),
      measurement: reportText_(step.measurement, 1000),
      observation: reportText_(step.observation, 10000),
      explanation: reportText_(step.explanation, 10000),
      photos: photos.map(photo => {
        const fileId = reportText_(photo.file_id, 200);
        if (!fileId) throw new Error("Báo cáo có ảnh thiếu mã Drive.");
        const file = DriveApp.getFileById(fileId);
        if (!isInRootFolder_(file)) throw new Error("Ảnh báo cáo không thuộc thư mục LabMana.");
        return {
          fileId: fileId,
          name: reportText_(photo.name, 240),
          code: reportText_(photo.code, 300),
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
  const experimentLine = body.appendParagraph(`BÀI SỐ: ${experimentTitle}`);
  const experimentText = experimentLine.editAsText();
  setReportTextStyle_(experimentText, false);
  const experimentOffset = experimentText.getText().indexOf(experimentTitle);
  experimentText.setBold(experimentOffset, experimentOffset + experimentTitle.length - 1, true);
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
  table.setColumnWidth(0, 60);
  table.setColumnWidth(1, 225);
  table.setColumnWidth(2, 245);
  table.setColumnWidth(3, 245);

  preparedSteps.forEach(step => {
    const row = table.appendTableRow();
    const sectionNumber = String(step.label).split(".")[0];
    const sectionCell = row.appendTableCell(`TN${sectionNumber}`);
    const actionCell = row.appendTableCell(`${step.label}\n${step.action || "Chưa có nội dung thao tác."}`);
    const observationText = [
      step.measurement ? `Số liệu: ${step.measurement}` : "",
      step.observation
    ].filter(Boolean).join("\n");
    const observationCell = row.appendTableCell("");
    const explanationCell = row.appendTableCell(step.explanation || "Chưa ghi nhận giải thích.");
    setReportTextStyle_(sectionCell.editAsText(), false);
    setReportTextStyle_(actionCell.editAsText(), false);
    setReportTextStyle_(explanationCell.editAsText(), false);

    const photosByCode = {};
    step.photos.forEach(photo => { if (photo.code) photosByCode[photo.code] = photo; });
    const markers = Object.keys(photosByCode).sort((a, b) => observationText.indexOf(a) - observationText.indexOf(b));
    let cursor = 0;
    markers.forEach(code => {
      const markerAt = observationText.indexOf(code, cursor);
      if (markerAt < 0) return;
      appendReportText_(observationCell, observationText.slice(cursor, markerAt));
      const photo = photosByCode[code];
      appendReportPhoto_(observationCell, photo, () => { imagesSkipped++; });
      cursor = markerAt + code.length;
    });
    appendReportText_(observationCell, observationText.slice(cursor));
    if (!observationText && !step.photos.length) {
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
  if (!text) return;
  String(text).split(/\r?\n/).forEach(line => {
    setReportTextStyle_(cell.appendParagraph(line).editAsText(), false);
  });
}

function appendReportPhoto_(cell, photo, onSkipped, index) {
  const caption = cell.appendParagraph(photo.name ? `Ảnh: ${photo.name}` : `Ảnh ${Number(index || 0) + 1}`);
  setReportTextStyle_(caption.editAsText(), false, 9);
  const mime = photo.blob.getContentType();
  const byteSize = photo.blob.getBytes().length;
  const supportedMime = ["image/jpeg", "image/png", "image/gif"].includes(mime);
  if (supportedMime && byteSize <= 2 * 1024 * 1024) {
    try {
      const image = cell.appendImage(photo.blob);
      if (image.getWidth() > 220) {
        const height = image.getHeight();
        const ratio = 220 / image.getWidth();
        image.setWidth(220);
        image.setHeight(Math.round(height * ratio));
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

function reportText_(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function reportDate_(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
