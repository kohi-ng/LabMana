/**
 * LabMana — helpers for exporting a completed experiment to Google Docs.
 * Add this file to the same Apps Script project as code.gs.
 */
function handleCreateReport_(report) {
  if (!report || typeof report !== "object") throw new Error("Thiếu dữ liệu báo cáo.");
  const studentName = reportText_(report.studentName, 160);
  const studentId = reportText_(report.studentId, 80);
  const experimentTitle = reportText_(report.experimentTitle, 240);
  const reportDate = reportText_(report.date, 40);
  const semester = reportText_(report.semester, 100);
  const group = reportText_(report.group, 100);
  const steps = Array.isArray(report.steps) ? report.steps : [];
  let imagesSkipped = Number(report.imagesSkipped) || 0;
  if (!studentName || !studentId || !experimentTitle || !reportDate) {
    throw new Error("Báo cáo cần có tên, MSSV, bài thí nghiệm và ngày báo cáo.");
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
        return { fileId: fileId, name: reportText_(photo.name, 240), blob: file.getBlob() };
      })
    };
  });
  const safeTitle = reportText_(experimentTitle, 80).replace(/[\\/:*?"<>|]+/g, "-");
  const document = DocumentApp.create(`Báo cáo - ${safeTitle} - ${studentName}`);
  const body = document.getBody();
  body.clear();

  const title = body.appendParagraph("BÁO CÁO THÍ NGHIỆM HÓA VÔ CƠ");
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const termLine = body.appendParagraph(semester || "HỌC KỲ / NĂM HỌC");
  termLine.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  termLine.editAsText().setBold(true);
  body.appendParagraph(`HỌ VÀ TÊN: ${studentName}`);
  body.appendParagraph(`MSSV: ${studentId}`);
  body.appendParagraph(`NHÓM: ${group || "________________"}`);
  body.appendParagraph(`BÀI SỐ: ${experimentTitle}`);
  body.appendParagraph(`NGÀY: ${reportDate_(reportDate)}`);
  body.appendParagraph("GVGD: TS. NGUYỄN BÌNH NGUYÊN");
  body.appendParagraph("");

  const table = body.appendTable([[
    "TN",
    "CÁC BƯỚC TIẾN HÀNH",
    "HIỆN TƯỢNG QUAN SÁT THỰC TẾ",
    "GIẢI THÍCH VÀ PTPƯ MINH HỌA"
  ]]);
  for (let column = 0; column < 4; column++) {
    const headerCell = table.getRow(0).getCell(column);
    headerCell.setBackgroundColor("#dce6f1");
    headerCell.editAsText().setBold(true);
  }

  preparedSteps.forEach(step => {
    const row = table.appendTableRow();
    row.appendTableCell(step.section);
    row.appendTableCell(`${step.label}\n${step.action || "Chưa có nội dung thao tác."}`);
    const observationText = [
      step.measurement ? `Số liệu: ${step.measurement}` : "",
      step.observation
    ].filter(Boolean).join("\n");
    const observationCell = row.appendTableCell(observationText || "Chưa ghi nhận hiện tượng.");
    row.appendTableCell(step.explanation || "Chưa ghi nhận giải thích.");
    step.photos.forEach((photo, index) => {
      const imageParagraph = observationCell.appendParagraph(`Ảnh ${index + 1}${photo.name ? `: ${photo.name}` : ""}`);
      imageParagraph.editAsText().setFontSize(9);
      const mime = photo.blob.getContentType();
      const byteSize = photo.blob.getBytes().length;
      const supportedMime = ["image/jpeg", "image/png", "image/gif"].includes(mime);
      if (supportedMime && byteSize <= 2 * 1024 * 1024) {
        try {
          const image = observationCell.appendImage(photo.blob);
          if (image.getWidth() > 220) {
            const height = image.getHeight();
            const ratio = 220 / image.getWidth();
            image.setWidth(220);
            image.setHeight(Math.round(height * ratio));
          }
        } catch (err) {
          imagesSkipped++;
          observationCell.appendParagraph("Không nhúng được ảnh; dùng link Drive bên dưới.");
          console.warn(`Không chèn được ảnh ${photo.fileId}: ${err}`);
        }
      } else {
        imagesSkipped++;
        observationCell.appendParagraph("Ảnh quá lớn hoặc định dạng không hỗ trợ nhúng; dùng link Drive bên dưới.");
      }
      const link = observationCell.appendParagraph("Mở ảnh trên Google Drive");
      link.editAsText().setLinkUrl(0, link.getText().length - 1, `https://drive.google.com/file/d/${encodeURIComponent(photo.fileId)}/view`);
      link.editAsText().setFontSize(9);
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

function reportText_(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function reportDate_(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
