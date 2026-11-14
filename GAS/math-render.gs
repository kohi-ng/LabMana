/**
 * LabMana — "biên dịch" công thức toán/hóa (LaTeX + mhchem) sang Unicode thật,
 * dùng khi chèn văn bản vào Google Docs (report.gs). Google Docs không chạy được
 * KaTeX (không có DOM), nên không thể render công thức như trong app; thay vào đó
 * ta chuyển các cú pháp phổ biến nhất của giáo trình sang ký tự Unicode tương đương
 * (subscript, superscript, mũi tên phản ứng…) để đọc được trực tiếp trong Docs.
 *
 * Hỗ trợ đủ dùng cho hóa vô cơ: $\ce{...}$, $...$, $$...$$, \frac{a}{b}, x^{n}, x_{n}.
 * Không hỗ trợ: ma trận, tích phân, công thức trình bày phức tạp — các trường hợp
 * này được giữ nguyên dạng gốc (bỏ dấu $ ngoài cùng) để không mất thông tin.
 */

const SUB_MAP_ = { "0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉",
  "+":"₊","-":"₋","=":"₌","(":"₍",")":"₎", "a":"ₐ","e":"ₑ","i":"ᵢ","o":"ₒ","u":"ᵤ","x":"ₓ" };
const SUP_MAP_ = { "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹",
  "+":"⁺","-":"⁻","=":"⁼","(":"⁽",")":"⁾","n":"ⁿ" };

// Unicode không có subscript cho mọi chữ cái (vd M, C in hoa) — khi gặp ký tự không map được,
// giữ nguyên ký tự đó thay vì âm thầm làm mất nó, để không biến "C_M" thành "CM" vô nghĩa.
function toSubscript_(s) { return String(s).split("").map(c => SUB_MAP_[c] ?? c).join(""); }
function toSuperscript_(s) { return String(s).split("").map(c => SUP_MAP_[c] ?? c).join(""); }

/** Công thức hóa học mhchem: \ce{...} → Unicode (subscript số, mũi tên, điện tích…). */
function renderChem_(src) {
  let s = String(src);

  // Mũi tên phản ứng / cân bằng — xử lý trước vì chứa dấu > và = dễ đụng các bước sau.
  s = s.replace(/<=>/g, "⇌").replace(/<=>>/g, "⇌").replace(/->/g, "→").replace(/<-/g, "←");

  // Kết tủa (v) / bay hơi (^) kiểu mhchem: hậu tố "v" hoặc "^" dính liền ngay sau công thức
  // (vd BaSO4v, H2↑) — xử lý TRƯỚC bước chuyển số thành subscript để không ăn nhầm số đứng trước "v".
  s = s.replace(/\\downarrow/g, "↓").replace(/\\uparrow/g, "↑");
  s = s.replace(/([A-Za-z0-9\)\]])v(?=[\s+\-=]|$)/g, "$1↓");
  s = s.replace(/([A-Za-z0-9\)\]])\^(?=[\s+\-=]|$)/g, "$1↑");

  // Điện tích / số oxi hóa dạng ^{2+}, ^{3-}, ^2+, ^+, ^- (có dấu ^ rõ ràng)
  s = s.replace(/\^\{([^}]+)\}/g, (_, inner) => toSuperscript_(inner));
  s = s.replace(/\^(\d*[+-])/g, (_, inner) => toSuperscript_(inner));
  // Điện tích viết tắt không có ^ kiểu mhchem: Na+, OH-, SO4^2- đã xử lý ở trên;
  // còn lại như "3OH-" hay "Cl-" — dấu +/- đứng cuối một nhóm nguyên tử, trước khoảng trắng/+/-/cuối chuỗi.
  s = s.replace(/([A-Za-z0-9\)\]])(\++|-+)(?=[\s+\-=]|$)/g, (_, letter, sign) => letter + toSuperscript_(sign));

  // Chỉ số dưới dạng _{..} hoặc số liền sau chữ/]/) — công thức hóa học: H2SO4, Na2SO4, (NH4)2SO4
  s = s.replace(/_\{([^}]+)\}/g, (_, inner) => toSubscript_(inner));
  s = s.replace(/_(\d+)/g, (_, inner) => toSubscript_(inner));
  // Số đứng ngay sau chữ cái hoặc ) ] → chỉ số dưới (bỏ qua số đứng đầu công thức, là hệ số phản ứng)
  s = s.replace(/([A-Za-z\)\]])(\d+)/g, (_, letter, digits) => letter + toSubscript_(digits));

  // Hiđrat: \cdot hoặc . giữa công thức và nước kết tinh → dấu chấm giữa
  s = s.replace(/\\cdot/g, "·");

  // Dọn lệnh LaTeX còn sót không áp dụng được (vd \text{...}) — giữ nội dung, bỏ lệnh
  s = s.replace(/\\text\{([^}]*)\}/g, "$1");
  s = s.replace(/\\[a-zA-Z]+/g, "");
  s = s.replace(/[{}]/g, "");

  return s.trim();
}

/** Công thức toán cơ bản ngoài mhchem: \frac{a}{b}, x^{n}, x_{n}, các ký hiệu Hy Lạp thường gặp. */
function renderMathPlain_(src) {
  let s = String(src);
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${a}/${b}`);
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, (_, a) => `√(${a})`);
  s = s.replace(/\^\{([^}]+)\}/g, (_, inner) => toSuperscript_(inner));
  s = s.replace(/\^(\w)/g, (_, inner) => toSuperscript_(inner));
  s = s.replace(/_\{([^}]+)\}/g, (_, inner) => toSubscript_(inner));
  s = s.replace(/_(\w)/g, (_, inner) => toSubscript_(inner));
  const GREEK_ = { "\\alpha":"α","\\beta":"β","\\gamma":"γ","\\delta":"δ","\\Delta":"Δ",
    "\\theta":"θ","\\lambda":"λ","\\mu":"µ","\\pi":"π","\\sigma":"σ","\\Omega":"Ω",
    "\\pm":"±","\\times":"×","\\cdot":"·","\\approx":"≈","\\neq":"≠","\\leq":"≤","\\geq":"≥" };
  for (const [key, value] of Object.entries(GREEK_)) s = s.split(key).join(value);
  s = s.replace(/\\[a-zA-Z]+/g, "");
  s = s.replace(/[{}]/g, "");
  return s.trim();
}

/**
 * Biên dịch một đoạn văn bản có thể chứa nhiều công thức $...$ / $$...$$ xen giữa văn bản
 * thường. Trả về chuỗi thuần, sẵn sàng chèn vào Google Docs (appendParagraph/appendText).
 * Không throw: công thức không nhận diện được sẽ được làm sạch ký hiệu LaTeX ở mức tối thiểu
 * thay vì chặn toàn bộ báo cáo.
 */
function compileFormulas_(text) {
  if (!text) return "";
  let out = String(text);

  // $$...$$ trước (display), rồi \(...\), rồi $...$ (inline) — tránh $$ bị bắt nhầm bởi $...$
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => compileOneFormula_(inner));
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => compileOneFormula_(inner));
  out = out.replace(/\$([^$\n]+?)\$/g, (_, inner) => compileOneFormula_(inner));

  return out;
}

function compileOneFormula_(inner) {
  const trimmed = String(inner).trim();
  const ceMatch = trimmed.match(/^\\ce\{([\s\S]*)\}$/);
  if (ceMatch) return renderChem_(ceMatch[1]);
  return renderMathPlain_(trimmed);
}

/**
 * Nhận diện bảng Markdown kiểu Planner (cùng cú pháp với richHtml() trong utils.js:
 * mỗi dòng bảng bắt đầu/kết thúc bằng "|", ô cách nhau bởi "|"; dòng phân cách
 * "| --- | --- |" ngay sau tiêu đề bị bỏ qua). Tách văn bản thành các khối xen kẽ
 * đoạn văn thường / bảng, để report.gs chèn đúng loại nội dung (appendParagraph
 * hay appendTable lồng trong ô) thay vì in nguyên ký tự "|" như chữ thường.
 * Mỗi ô/đoạn văn trả về đã được compileFormulas_() để công thức hiện đúng Unicode.
 */
function parseMarkdownBlocks_(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const blocks = [];
  let textBuffer = [];
  const flushText = () => {
    if (textBuffer.length) { blocks.push({ type: "text", lines: textBuffer.map(compileFormulas_) }); textBuffer = []; }
  };
  const tableRow_ = line => {
    const value = line.trim();
    if (!value.startsWith("|") || !value.endsWith("|") || value.length < 2) return null;
    return value.slice(1, -1).split("|").map(cell => cell.trim());
  };
  const isSeparatorRow_ = row => row.every(cell => /^:?-{3,}:?$/.test(cell));

  for (let i = 0; i < lines.length;) {
    const headerRow = tableRow_(lines[i]);
    if (!headerRow || headerRow.length < 2) { textBuffer.push(lines[i]); i++; continue; }
    // Tìm toàn bộ khối bảng liên tiếp trước khi quyết định đây có phải bảng thật không.
    const rawRows = [headerRow];
    let j = i + 1;
    while (j < lines.length) {
      const row = tableRow_(lines[j]);
      if (!row || row.length < 2) break;
      rawRows.push(row);
      j++;
    }
    if (rawRows.length < 2) { textBuffer.push(lines[i]); i++; continue; } // chỉ 1 dòng "|...|" đơn lẻ: không phải bảng
    flushText();
    const body = rawRows.slice(1);
    const header = rawRows[0];
    const dataRows = body.length && isSeparatorRow_(body[0]) ? body.slice(1) : body;
    const width = header.length;
    const normalizeRow = row => {
      const cells = row.slice(0, width).map(compileFormulas_);
      while (cells.length < width) cells.push("");
      return cells;
    };
    blocks.push({ type: "table", header: normalizeRow(header), rows: dataRows.map(normalizeRow) });
    i = j;
  }
  flushText();
  return blocks;
}