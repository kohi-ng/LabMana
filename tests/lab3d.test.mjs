// Kiểm thử mô phỏng 3D pha chế (Node + headless Chromium/swiftshader). Chạy:  node tests/lab3d.test.mjs [audit|render|all]
// Cần:  npm i three@0.149.0 gsap@3.12.5 puppeteer-core @sparticuz/chromium@123   (cài ở thư mục bất kỳ, đặt NM_DIR nếu khác)
import fs from "fs"; import http from "http"; import path from "path"; import { createRequire } from "module"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), NM = process.env.NM_DIR || path.join(process.cwd(), "node_modules"), PORT = +process.env.PORT || 8097;
const req = createRequire(path.join(NM, "_.js")), puppeteer = req("puppeteer-core"), chromium = req("@sparticuz/chromium");
const OUT = process.env.OUT || path.join(process.cwd(), "lab3d-out"), which = process.argv[2] || "all";
const CASES = {
  "solid-vol": { chem: "cuso4_5", method: "solid", stockUnit: "M", targetUnit: "M", v: { purity: "99", target: "0.1", amount: "250", mw: "249.685" }, scale: { vol: "mL", mass: "g" } },
  "solid-mass": { chem: "nacl", method: "solid", stockUnit: "M", targetUnit: "ww", v: { purity: "99.5", target: "5", amount: "200" }, scale: { vol: "mL", mass: "g" } },
  "dilute-vol/pipet": { chem: "h2so4", method: "dilute", stockUnit: "ww", targetUnit: "M", v: { stock: "98", density: "1.84", target: "0.1", amount: "250", mw: "98.079" }, scale: { vol: "mL", mass: "g" } },
  "dilute-vol/cylinder": { chem: "hcl", method: "dilute", stockUnit: "ww", targetUnit: "M", v: { stock: "37", density: "1.19", target: "2", amount: "500", mw: "36.46" }, scale: { vol: "mL", mass: "g" } },
  "dilute-vol/micropipet": { chem: "h2so4", method: "dilute", stockUnit: "ww", targetUnit: "M", v: { stock: "98", density: "1.84", target: "0.005", amount: "100", mw: "98.079" }, scale: { vol: "mL", mass: "g" } },
  "dilute-mass": { chem: "hcl", method: "dilute", stockUnit: "ww", targetUnit: "ww", v: { stock: "37", density: "1.19", target: "10", amount: "100" }, scale: { vol: "mL", mass: "g" } },
  "colored": { chem: "kmno4", method: "solid", stockUnit: "M", targetUnit: "M", v: { purity: "99", target: "0.02", amount: "250", mw: "158.034" }, scale: { vol: "mL", mass: "g" } }
};
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0]; let f;
  if (u === "/three.js") f = NM + "/three/build/three.min.js"; else if (u === "/gsap.js") f = NM + "/gsap/dist/gsap.min.js"; else if (u === "/") f = path.join(OUT, "_t.html"); else f = path.join(ROOT, u);
  if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader("content-type", { ".js": "text/javascript", ".html": "text/html", ".css": "text/css" }[path.extname(f)] || "text/plain"); r.end(fs.readFileSync(f)); }).listen(PORT);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "_t.html"), `<!doctype html><meta charset=utf-8><link rel=stylesheet href="/css/style.css"><body style="margin:0;padding:8px;width:440px"><div id=h></div>
<script src="/three.js"></script><script src="/gsap.js"></script><script type=module>
import * as L from "/js/lab-animator.js"; import * as C from "/js/chem-logic.js"; window.L=L; window.C=C; window.ready=true;</script>`);
const b = await puppeteer.launch({ args: [...chromium.args, "--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"], executablePath: await chromium.executablePath(), headless: "shell" });
const p = await b.newPage(); const errs = []; let fails = 0;
p.on("console", m => { if (["error", "warning"].includes(m.type()) && !/ERR_NAME_NOT_RESOLVED|fonts\.g|Failed to load resource/.test(m.text())) { errs.push(m.text()); console.log("  [console]", m.text().slice(0, 200)); } });
p.on("pageerror", e => { errs.push(e.message); console.log("  [pageerror]", e.message); });
await p.setViewport({ width: 460, height: 900, deviceScaleFactor: 1 }); await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction("window.ready");
const ok = (c, msg) => { if (!c) { fails++; console.log("  ✗", msg); } return c; };

if (which === "audit" || which === "all") for (const [name, inp] of Object.entries(CASES)) {
  const res = await p.evaluate((inp) => {
    const T = THREE, r = C.computeMix(inp), sim = L.createSim(r.anim, { THREE: T, gsap }), tl = sim.tl, dur = tl.duration(), V = (x, y, z) => new T.Vector3(x, y, z);
    // OBB (hộp bao định hướng) từ hộp cục bộ + ma trận thế giới
    const obb = b => { const m = b.obj.matrixWorld, e = m.elements, ax = [V(e[0], e[1], e[2]), V(e[4], e[5], e[6]), V(e[8], e[9], e[10])], sc = ax.map(a => a.length());
      const c = b.min.clone().add(b.max).multiplyScalar(.5).applyMatrix4(m), h = b.max.clone().sub(b.min).multiplyScalar(.5);
      return { name: b.name, c, ax: ax.map((a, i) => a.divideScalar(sc[i] || 1)), h: [h.x * sc[0], h.y * sc[1], h.z * sc[2]] }; };
    const pen = (A, B) => { const d = B.c.clone().sub(A.c); let best = 1e9; const axes = [...A.ax, ...B.ax];
      for (const a of A.ax) for (const b2 of B.ax) { const x = a.clone().cross(b2); if (x.lengthSq() > 1e-6) axes.push(x.normalize()); }
      for (const ax of axes) { const ra = A.h.reduce((s, h, i) => s + h * Math.abs(ax.dot(A.ax[i])), 0), rb = B.h.reduce((s, h, i) => s + h * Math.abs(ax.dot(B.ax[i])), 0), o = ra + rb - Math.abs(d.dot(ax)); if (o <= 0) return 0; best = Math.min(best, o); } return best; };
    const hits = {}; let N = 0;
    for (let t = 0; t <= dur; t += .1) {
      tl.time(t, false); sim.apply(t); sim.scene.updateMatrixWorld(true); N++;
      const bs = sim.collisionBoxes().filter(b => b.v).map(b => ({ b, o: obb(b) }));
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const A = bs[i].o, B = bs[j].o, key = [A.name, B.name].sort().join(" × ");
        const pr = (a, b2) => (A.name.startsWith(a) && B.name.startsWith(b2)) || (A.name.startsWith(b2) && B.name.startsWith(a));
        if (A.name.split("-")[0] === B.name.split("-")[0] || bs[i].b.obj === bs[j].b.obj) continue;   // các hộp của cùng một vật
        const d = pen(A, B); if (d < .12) continue;
        if (pr("boat", "pan") || pr("boat", "balance") || pr("beaker", "balance") || pr("beaker", "pan")) { if (d < .35) continue; }  // đặt trên đĩa cân (tiếp xúc)
        if (pr("tool", "stock")) continue; // pipet nhúng vào chai là có chủ ý
        if (pr("tool", "flask-neck")) continue;  // pipet chạm cổ bình có chủ ý
        (hits[key] = hits[key] || { n: 0, t0: t, t1: t, maxD: 0 }); const h = hits[key]; h.n++; h.t1 = t; h.maxD = Math.max(h.maxD, d);
      }
      const seg = sim.rodSeg(); if (seg) {
        const q = sim.collisionBoxes().filter(b => b.v); for (const b of q) { const M = b.obj.matrixWorld.clone().invert(); const a1 = seg[0].clone().applyMatrix4(M), a2 = seg[1].clone().applyMatrix4(M);
          // lấy mẫu dọc đũa; đũa được phép nằm trong cốc/bình/cổ bình (thao tác khuấy/rót) nhưng không được xuyên bất kỳ vật khác
          if (/^(beaker|flask)/.test(b.name)) continue;
          let inside = 0; for (let k = 0; k <= 20; k++) { const pnt = a1.clone().lerp(a2, k / 20); if (pnt.x > b.min.x + .2 && pnt.x < b.max.x - .2 && pnt.y > b.min.y + .2 && pnt.y < b.max.y - .2 && pnt.z > b.min.z + .2 && pnt.z < b.max.z - .2) inside++; }
          if (inside > 1) { const key = "rod × " + b.name; (hits[key] = hits[key] || { n: 0, t0: t, t1: t, maxD: 0 }); hits[key].n++; hits[key].t1 = t; }
        }
      }
    }
    return { dur, N, hits, anim: r.anim, steps: sim.steps.map(s => s.cap) };
  }, inp);
  const list = Object.entries(res.hits);
  console.log(`${name.padEnd(22)} ${res.dur.toFixed(1)}s  ${res.steps.length} bước  va chạm: ${list.length}`);
  for (const [k, h] of list) console.log(`   ${k}  ${h.t0.toFixed(1)}–${h.t1.toFixed(1)}s  sâu ≤ ${h.maxD.toFixed(2)} cm`);
  ok(list.length === 0, `${name}: có xuyên thấu/chồng chéo`);
}

const run = n => which === "all" ? n !== "render" : which === n;
const parseG = t => +t.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");

/* ---- số liệu hiển thị khớp kết quả tính toán (LCD cân, thể tích bình, thể tích dụng cụ) ---- */
if (run("numbers")) for (const [name, inp] of Object.entries(CASES)) {
  const r = await p.evaluate(inp => {
    const res = C.computeMix(inp), A = res.anim, sim = L.createSim(A, { THREE, gsap }), tl = sim.tl, st = sim.steps, P = sim.P, out = { mode: A.mode, A, titles: st.map(s => s.title), reads: [], tMax: 0, dur: tl.duration() };
    const at = (t) => { tl.time(t, false); sim.apply(t); return { lcd: P.lcd, txt: sim.lcdText(), fFill: P.fFill, boatLoad: P.boatLoad }; };
    st.forEach((s, i) => out.reads.push({ i, title: s.title, ...at(s.t + s.dur - .02) }));
    for (let t = 0; t <= tl.duration(); t += .1) { tl.time(t, false); sim.apply(t); out.tMax = Math.max(out.tMax, P.tFill || 0); }
    out.end = at(tl.duration()); out.hero = res.hero.value;
    // mức chất lỏng khi rót phải đơn điệu: góc nghiêng cần thiết tăng khi thể tích giảm
    const bk = sim.parts.beaker; let mono = true, prev = -1; for (let f = 1; f >= 0; f -= .05) { const th = bk.tiltForLip(f); if (th < prev - 1e-6) mono = false; prev = th; } out.mono = mono;
    return out;
  }, inp);
  const A = r.A, g = x => parseG(x), near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  console.log(`${name.padEnd(22)} bước: ${r.titles.join(" → ")}`);
  ok(r.mono, `${name}: góc nghiêng rót không đơn điệu theo thể tích`);
  const find = t => r.reads.find(x => x.title.startsWith(t));
  if (A.mode === "solid-vol") { const x = find("Xúc"); ok(near(x.lcd, A.soluteAmount), `${name}: LCD sau khi xúc ≠ khối lượng cần cân`); ok(near(g(x.txt), A.soluteAmount, 2e-3), `${name}: chữ LCD ${x.txt} ≠ ${A.soluteAmount}`); ok(near(r.end.fFill, 1), `${name}: bình cuối chưa đến vạch`); }
  if (A.mode === "solid-mass") { ok(near(find("Cân chất").lcd, A.soluteAmount), `${name}: LCD sau khi cân chất rắn sai`); ok(near(find("Thêm nước").lcd, A.finalMass), `${name}: LCD sau khi thêm nước ≠ khối lượng dung dịch`); }
  if (A.mode === "dilute-mass") { ok(near(find("Cho nước").lcd, A.solventAmount), `${name}: LCD sau khi cho nước ≠ khối lượng nước`); ok(near(find("Thêm dung").lcd, A.finalMass), `${name}: LCD cuối ≠ khối lượng dung dịch`); }
  if (A.mode === "dilute-vol") { ok(near(r.tMax, 1), `${name}: dụng cụ không đầy đến thể tích cần lấy`); ok(near(r.end.fFill, 1), `${name}: bình cuối chưa đến vạch`); }
  console.log(`   hero: ${r.hero}  ·  lcd cuối: ${r.end.txt}  ·  bình: ${(r.end.fFill * (A.finalVolume || 0)).toFixed(2)} mL`);
}

/* ---- tua: cùng thời điểm → cùng trạng thái dù đến từ phía trước hay phía sau ---- */
if (run("seek")) for (const [name, inp] of Object.entries(CASES)) {
  const bad = await p.evaluate(inp => {
    const A = C.computeMix(inp).anim, sim = L.createSim(A, { THREE, gsap }), tl = sim.tl, P = sim.P, D = tl.duration();
    const T = [0, 4.7, 9.3, 13.1, D * .33, D * .5, D * .71, D - .2, D]; const snap = t => { tl.time(t, false); sim.apply(t); return { ...P }; };
    const fwd = T.map(snap), bwd = [...T].reverse().map(snap).reverse(), rnd = [3, 7, 1, 8, 5, 0, 6, 2, 4].map(i => [i, snap(T[i])]);
    const bad = []; const cmp = (a, b, tag) => { for (const k in a) if (Math.abs(a[k] - b[k]) > 1e-6 && !(Number.isNaN(a[k]) && Number.isNaN(b[k]))) bad.push(`${tag} ${k}: ${a[k]} ≠ ${b[k]}`); };
    T.forEach((t, i) => { cmp(fwd[i], bwd[i], `t=${t.toFixed(1)} tiến/lùi`); }); rnd.forEach(([i, s]) => cmp(fwd[i], s, `t=${T[i].toFixed(1)} ngẫu nhiên`));
    return bad.slice(0, 6);
  }, inp);
  console.log(`${name.padEnd(22)} tua: ${bad.length ? bad.length + " lệch" : "nhất quán"}`); bad.forEach(b => console.log("   ", b)); ok(!bad.length, `${name}: tua không nhất quán`);
}

/* ---- bộ điều khiển: phát/tạm dừng, bước, tua, tốc độ, lặp, góc nhìn, phím tắt, hủy ---- */
if (run("ui")) {
  const res = await p.evaluate(async inp => {
    gsap.globalTimeline.clear(); gsap.ticker.lagSmoothing(0); const A = C.computeMix(inp).anim, h = document.getElementById("h"); h.innerHTML = ""; const inst = L.mount(h, A); const W = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms = 25000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await W(50); } return false; };   // GPU phần mềm chạy chậm nên chờ điều kiện, không chờ cố định
    const tl = gsap.globalTimeline.getChildren(false, false, true).find(x => x.duration && x.duration() > 5), q = s => h.querySelector(s), out = {};
    const cur = () => [...h.querySelectorAll(".lab3d-chips button")].findIndex(b => b.classList.contains("on")), nSteps = h.querySelectorAll(".lab3d-chips button").length; out.chips = nSteps; out.marks = h.querySelectorAll(".lab3d-marks i").length;
    out.labels = [...h.querySelectorAll(".lab3d-bar button")].map(b => b.textContent.replace(/\s+/g, " ").trim());
    await W(500); out.playing0 = !tl.paused();
    q("[data-a=play]").click(); await W(80); out.afterPause = tl.paused(); out.pauseLabel = q("[data-a=play]").textContent;
    q("[data-a=play]").click(); await W(80); out.afterPlay = !tl.paused(); out.playLabel = q("[data-a=play]").textContent;
    q("[data-a=play]").click(); q("[data-a=next]").click(); await until(() => cur() === 1); out.step2 = cur(); await until(() => !tl.isActive()); out.pausedAfterNext = tl.paused();
    q("[data-a=prev]").click(); await until(() => cur() === 0); out.step1 = cur(); await until(() => !tl.isActive());
    h.querySelectorAll(".lab3d-chips button")[nSteps - 1].click(); await until(() => cur() === nSteps - 1); out.last = cur(); await until(() => !tl.isActive());
    const sk = q(".lab3d-seek"); sk.value = 500; sk.dispatchEvent(new Event("input", { bubbles: true })); sk.dispatchEvent(new Event("change", { bubbles: true })); await W(60); out.seekT = tl.time() / tl.duration(); out.clock = q(".lab3d-clock").textContent;
    const sp = q("[data-a=speed]"); const sps = []; for (let i = 0; i < 5; i++) { sp.click(); sps.push(tl.timeScale()); } out.speeds = sps;
    q("[data-a=loop]").click(); out.loop = q("[data-a=loop]").getAttribute("aria-pressed");
    for (const v of ["all", "mark", "top", "dir"]) { q(`[data-v=${v}]`).click(); await W(40); } out.view = q("[data-v=dir]").getAttribute("aria-checked");
    q(".lab3d").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); await W(40); out.keySpace = !tl.paused();
    tl.pause(); tl.time(0, false); await W(100); q(".lab3d").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await until(() => cur() === 1); out.keyNext = cur();
    inst.destroy(); out.destroyed = h.innerHTML === ""; return out;
  }, CASES["dilute-vol/pipet"]);
  console.log("ui:", JSON.stringify(res));
  ok(res.chips >= 5 && res.marks === res.chips - 1, "chương/vạch bước không khớp số bước");
  ok(res.labels.some(l => /Bước trước/.test(l)) && res.labels.some(l => /Bước tiếp/.test(l)), "thiếu nút Bước trước/Bước tiếp");
  ok(res.playing0 && res.afterPause === true && /Tiếp tục/.test(res.pauseLabel), "nút tạm dừng không hoạt động");
  ok(res.afterPlay === true && /Tạm dừng/.test(res.playLabel), "nút phát lại không hoạt động");
  ok(res.step2 === 1 && res.pausedAfterNext, "Bước tiếp không nhảy đúng bước hoặc không giữ trạng thái dừng");
  ok(res.step1 === 0, "Bước trước không quay đúng bước"); ok(res.last === res.chips - 1, "bấm chương cuối không nhảy tới bước cuối");
  ok(Math.abs(res.seekT - .5) < .01, "thanh tua không đến đúng vị trí"); ok(res.speeds.join() === "1.5,2,0.5,0.75,1", "chu kỳ tốc độ sai: " + res.speeds);
  ok(res.loop === "true" && res.view === "true" && res.keySpace && res.keyNext === 1 && res.destroyed, "lặp/góc nhìn/phím tắt/hủy hoạt động sai");
}

console.log(errs.length ? `console: ${errs.length} lỗi` : "console: sạch"); ok(!errs.length, "có lỗi console");
await b.close(); srv.close(); console.log(fails ? `THẤT BẠI (${fails})` : "ĐẠT"); process.exit(fails ? 1 : 0);
