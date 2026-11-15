// ============ Mô phỏng 3D thao tác pha chế (Three.js + GSAP 3) cho Bước 4/4 của tab Pha chế ============
// Dữ liệu vào: computeMix().anim. Toàn bộ chuyển động là SỐ THUẦN trong đối tượng P, điều khiển bởi MỘT gsap.timeline()
// (mọi tween dùng fromTo) → Bước trước / Bước tiếp / chấm tiến trình tua tới-lui luôn chính xác. Cảnh 3D chỉ là hàm của P.
import { CHEMS, fmtVol, fmtMass } from "./chem-logic.js";

let THREE, gsap;
const G = 980; // cm/s²
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Màu đặc trưng của dung dịch (nước cất → màu hóa chất)
const TINTS = { cuso4_5: 0x3b8fe0, kmno4: 0x9b2fae, k2cr2o7: 0xf08a1c, k2cro4: 0xf2d21a, niso4_6: 0x4fb36a, cocl2_6: 0xe0577f,
  fecl3_6: 0xe3b52a, feso4_7: 0x9cd1a0, mohr: 0xa9d9b0, crcl3_6: 0x3f8f5a, agno3: 0xd5eaf4, mnso4_h2o: 0xf3c9d3 };
const tintOf = id => TINTS[id] ?? 0xc9e4f4;
const WATER = 0xcfe9f7;

/* ------------------------------ Dụng cụ thủy tinh (LatheGeometry) ------------------------------ */
function makeVessel({ H, R, wall = .18, floor = .4, refY, ticks = 0, tickLen = .9, glassMat, liqColor }) {
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const g = new THREE.Group();
  const inner = y => Math.max(.04, R(y) - wall);
  const N = 80, pts = [V2(0, 0), V2(Math.max(R(0) - .3, .05), 0)];
  for (let i = 0; i <= N; i++) { const y = H * i / N; pts.push(V2(R(y), y)); }
  pts.push(V2(R(H) - wall * .4, H + .06), V2(inner(H), H));            // vành miệng vát mép
  for (let i = N; i >= 0; i--) { const y = floor + (H - floor) * i / N; pts.push(V2(inner(y), y)); }
  pts.push(V2(0, floor));                                              // đáy dày
  const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), glassMat); glass.renderOrder = 3;

  // Chất lỏng: lấy đúng lòng trong R_inner(y), cắt bởi mặt phẳng ngang trong không gian thế giới
  const lp = [V2(0, floor + .01)];
  for (let i = 0; i <= N; i++) { const y = floor + (H - floor) * i / N; lp.push(V2(inner(y) - .03, y)); }
  lp.push(V2(0, H));
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const mkLiq = clip => new THREE.MeshPhysicalMaterial({ color: liqColor, transparent: true, opacity: .8, roughness: .06, clearcoat: 1,
    side: THREE.DoubleSide, clippingPlanes: clip ? [plane] : null, envMapIntensity: 1.1 });
  const lm = mkLiq(true), sm = mkLiq(false);
  const liquid = new THREE.Mesh(new THREE.LatheGeometry(lp, 72), lm); liquid.renderOrder = 1;

  // Bảng thể tích tích lũy ∫πR²dy → đổi tỉ lệ f (so với thể tích tại refY) ↔ cao độ mặt thoáng
  const M = 240, hs = [], cv = [0];
  for (let i = 0; i <= M; i++) hs.push(floor + (H - floor) * i / M);
  for (let i = 1; i <= M; i++) { const r = inner((hs[i] + hs[i - 1]) / 2); cv.push(cv[i - 1] + Math.PI * r * r * (hs[i] - hs[i - 1])); }
  const volAt = h => { const t = clamp((h - floor) / (H - floor)) * M, i = Math.min(M - 1, Math.floor(t)); return cv[i] + (cv[i + 1] - cv[i]) * (t - i); };
  const vRef = volAt(refY);
  const hOf = f => {
    const target = clamp(f, 0, 1.6) * vRef; let lo = 0, hi = M;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cv[m] <= target) lo = m; else hi = m; }
    return Math.min(H, hs[lo] + (hs[hi] - hs[lo]) * ((target - cv[lo]) / ((cv[hi] - cv[lo]) || 1)));
  };

  // Mặt thoáng: lưới đồng tâm nhiều vòng (meniscus lõm, phễu xoáy, sóng lan)
  const RINGS = 14, SEG = 64, sg = new THREE.BufferGeometry(), sp = new Float32Array((RINGS * SEG + 1) * 3), idx = [];
  const vi = (k, j) => 1 + (k - 1) * SEG + (j % SEG);
  for (let j = 0; j < SEG; j++) idx.push(0, vi(1, j + 1), vi(1, j));
  for (let k = 1; k < RINGS; k++) for (let j = 0; j < SEG; j++) idx.push(vi(k, j), vi(k, j + 1), vi(k + 1, j), vi(k, j + 1), vi(k + 1, j + 1), vi(k + 1, j));
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3)); sg.setIndex(idx);
  const surf = new THREE.Mesh(sg, sm); surf.frustumCulled = false; surf.renderOrder = 2;
  const sgrp = new THREE.Group(); sgrp.add(surf);

  g.add(glass, liquid, sgrp);
  if (ticks) { // vạch chia độ in trực tiếp (theo thể tích) + vạch đỏ Class A nếu là bình định mức
    const lines = [];
    for (let i = 1; i <= ticks; i++) {
      const h = hOf(i / ticks), r = R(h) + .012, L = i % 5 === 0 || ticks <= 10 ? tickLen : tickLen * .55;
      lines.push(-L / 2, h, Math.sqrt(Math.max(0, r * r - L * L / 4)), L / 2, h, Math.sqrt(Math.max(0, r * r - L * L / 4)));
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    g.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x334155 })));
  }
  const tmp = new THREE.Vector3(), wq = new THREE.Quaternion();
  const v = {
    group: g, H, R, inner, hOf, f: 0, floor, refY,
    setColor(c, op) { lm.color.set(c); sm.color.set(c); if (op != null) { lm.opacity = sm.opacity = op; } },
    /** o: {vort, rip:{a,t}|null, slosh} */
    update(time, o = {}) {
      const show = v.f > .002; liquid.visible = surf.visible = show; if (!show) return;
      const h = hOf(v.f); g.updateMatrixWorld(true);
      tmp.set(0, h, 0); g.localToWorld(tmp);
      let rimY = Infinity; for (const sx of [-1, 1]) { const q = new THREE.Vector3(sx * R(H), H, 0); g.localToWorld(q); rimY = Math.min(rimY, q.y); }
      plane.constant = Math.min(tmp.y, rimY - .05);               // mặt thoáng luôn nằm ngang theo trọng lực
      g.getWorldQuaternion(wq); const tiltA = Math.acos(clamp(new THREE.Vector3(0, 1, 0).applyQuaternion(wq).y, -1, 1));
      surf.visible = tiltA < .3;
      sgrp.position.set(0, h, 0); sgrp.quaternion.copy(wq).invert();
      const rad = inner(h) - .03, { vort = 0, rip = null, slosh = 0 } = o;
      sp[0] = 0; sp[1] = 0; sp[2] = 0;
      for (let k = 1; k <= RINGS; k++) {
        const u = k / RINGS, r = u * rad;
        for (let j = 0; j < SEG; j++) {
          const th = j / SEG * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
          let y = -.04 + .2 * u ** 4;                               // meniscus lõm: dâng sát thành ~ (r/R)^4
          y -= vort * 1.0 * (1 - u * u);                            // phễu xoáy parabol ~ -ω²(1-(r/R)²)
          y += slosh * .35 * u * c * Math.sin(time * 7);
          if (rip && rip.t >= 0) y += rip.a * Math.exp(-3 * rip.t) * Math.sin(13 * r - 20 * rip.t) * Math.exp(-.25 * r);
          const i3 = (1 + (k - 1) * SEG + j) * 3; sp[i3] = r * c; sp[i3 + 1] = y; sp[i3 + 2] = r * s;
        }
      }
      sg.attributes.position.needsUpdate = true; sg.computeVertexNormals();
    },
    dispose() { [glass, liquid].forEach(m => m.geometry.dispose()); sg.dispose(); lm.dispose(); sm.dispose(); }
  };
  return v;
}

/* ------------------------------ Dòng chảy: ống bán kính biến thiên ------------------------------ */
function makeStream(mat) {
  const N = 64, M = 8, geo = new THREE.BufferGeometry(), pos = new Float32Array(N * M * 3), idx = [];
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < M; j++) { const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M; idx.push(a, c, b, b, c, d); }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 2;
  const P = Array.from({ length: N }, () => new THREE.Vector3()), R = new Array(N).fill(0);
  const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1), ux = new THREE.Vector3(1, 0, 0);
  /** path: [{p:Vector3, r}], đoạn hiển thị theo chiều dài cung từ s0 đến s1 ∈ [0,1] */
  mesh.setPath = (path, s0, s1) => {
    if (!path || path.length < 2 || s1 - s0 < .004) { mesh.visible = false; return; }
    const L = [0]; for (let i = 1; i < path.length; i++) L.push(L[i - 1] + path[i].p.distanceTo(path[i - 1].p));
    const tot = L[L.length - 1] || 1; let seg = 0;
    for (let i = 0; i < N; i++) {
      const u = lerp(s0, s1, i / (N - 1)) * tot; while (seg < path.length - 2 && L[seg + 1] < u) seg++;
      const w = clamp((u - L[seg]) / ((L[seg + 1] - L[seg]) || 1));
      P[i].lerpVectors(path[seg].p, path[seg + 1].p, w);
      R[i] = lerp(path[seg].r, path[seg + 1].r, w) * (i === 0 || i === N - 1 ? .55 : 1);
    }
    for (let i = 0; i < N; i++) {
      t.subVectors(P[Math.min(N - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
      n.crossVectors(t, Math.abs(t.z) > .9 ? ux : up).normalize(); b.crossVectors(t, n);
      for (let j = 0; j < M; j++) {
        const a = j / M * Math.PI * 2, c = Math.cos(a) * R[i], s = Math.sin(a) * R[i], o = (i * M + j) * 3;
        pos[o] = P[i].x + n.x * c + b.x * s; pos[o + 1] = P[i].y + n.y * c + b.y * s; pos[o + 2] = P[i].z + n.z * c + b.z * s;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); mesh.visible = true;
  };
  return mesh;
}

/** Tia nước tự do: parabol theo trọng lực, bán kính theo phương trình liên tục r(y)=r0·(v0²/(v0²+2gΔy))^¼ */
function freeJet(tip, dir, v0, endY, r0 = .22) {
  const path = [], vx = dir.x * v0, vz = dir.z * v0, vy = dir.y * v0;
  for (let i = 0; i <= 40; i++) {
    const t = i * .0075, y = tip.y + vy * t - .5 * G * t * t;
    const dy = tip.y - y, r = r0 * Math.pow(v0 * v0 / (v0 * v0 + 2 * G * Math.max(0, dy)), .25);
    path.push({ p: new THREE.Vector3(tip.x + vx * t, Math.max(y, endY), tip.z + vz * t), r });
    if (y <= endY) break;
  }
  return path;
}

/** Dòng chảy bám đũa thủy tinh rồi ôm sát thành trong R_inner(y) của bình đích xuống mặt thoáng (Coanda) */
function wallPath(start, via, vessel, cx, side, surfY, r1) {
  const path = [{ p: start.clone(), r: r1 }];
  if (via) path.push({ p: via.clone(), r: r1 * .9 });
  const y0 = (via || start).y, n = 22;
  for (let i = 0; i <= n; i++) {
    const y = lerp(y0, surfY, i / n), ly = y - vessel.group.position.y; // vessel đứng thẳng
    path.push({ p: new THREE.Vector3(cx + side * (vessel.inner(clamp(ly, vessel.floor, vessel.H)) - .1), y, 0), r: r1 * .8 });
  }
  return path;
}

const teardropGeo = () => {
  const pts = [];
  for (let i = 0; i <= 28; i++) { const y = i / 28 * 1.5; const r = y <= .5 ? .5 * Math.sqrt(Math.max(0, 1 - ((y - .5) / .5) ** 2)) : .5 * Math.pow(1 - (y - .5), 2.2); pts.push(new THREE.Vector2(r, y)); }
  return new THREE.LatheGeometry(pts, 24);
};

function lcdCanvas() {
  const cv = document.createElement("canvas"); cv.width = 320; cv.height = 110;
  const ctx = cv.getContext("2d"), tex = new THREE.CanvasTexture(cv); let last = null;
  return { tex, draw(text) {
    if (text === last) return; last = text;
    ctx.fillStyle = "#a9bd96"; ctx.fillRect(0, 0, 320, 110); ctx.fillStyle = "#1c2915"; ctx.font = "bold 52px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(text, 300, 58); tex.needsUpdate = true;
  } };
}

/* ====================================================================================================
 * createSim: dựng cảnh + timeline (không cần DOM / renderer → kiểm thử được)
 * ================================================================================================== */
export function createSim(anim, lib) {
  THREE = lib.THREE; gsap = lib.gsap;
  const A = anim, mode = A.mode, solidM = mode.startsWith("solid"), volM = mode.endsWith("vol");
  const FV = A.finalVolume, sa = A.soluteAmount, wa = A.solventAmount, F = A.soluteFormula, exo = !!A.exothermic;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf8fafc);
  const camera = new THREE.PerspectiveCamera(32, 16 / 10, .5, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdbe3ec, .85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.15); sun.position.set(22, 42, 28); scene.add(sun);

  const std = (c, r = .5, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .03, metalness: 0, transparent: true, opacity: .15, side: THREE.DoubleSide,
    depthWrite: false, envMapIntensity: 1.7, clearcoat: 1, clearcoatRoughness: .02 });
  glassMat.onBeforeCompile = sh => { // viền phản quang Fresnel trên thành thủy tinh
    sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>",
      "#include <dithering_fragment>\n gl_FragColor.a = clamp(gl_FragColor.a + pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0) * 0.6, 0.0, 1.0);");
  };
  const stock = tintOf(A.chemId);

  // Sàn + bóng mờ
  const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 64), std(0xeef2f7, 1)); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const blobTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, "rgba(15,23,42,.35)"); gr.addColorStop(1, "rgba(15,23,42,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const blobs = [];
  const blob = (obj, size, base = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = .03; scene.add(m); blobs.push({ obj, m, size, base }); };

  /* ---- Cân điện tử ---- */
  const bal = (() => {
    const g = new THREE.Group(), L = lcdCanvas();
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 7), std(0xe5e7eb, .4)); body.position.y = .8;
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, .18, 48), std(0xb8c0cc, .25, .8)); pan.position.y = 1.69;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.3), new THREE.MeshBasicMaterial({ map: L.tex })); scr.position.set(0, .85, 3.52);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.5, .1), std(0x1f2937, .5)); bez.position.set(0, .85, 3.48);
    g.add(body, pan, scr, bez); scene.add(g); return { group: g, panY: 1.78, draw: L.draw, tex: L.tex };
  })();
  const needBal = mode !== "dilute-vol", balX = mode === "solid-vol" ? -13 : 0;
  bal.group.visible = needBal; bal.group.position.x = balX; if (needBal) blob(bal.group, 14);
  const PAN = bal.panY;

  /* ---- Dụng cụ thủy tinh ---- */
  const beaker = makeVessel({ H: 9, R: () => 3.3, wall: .2, floor: .45, refY: 7.6, ticks: 8, tickLen: .9, glassMat, liqColor: WATER });
  const flaskR = y => { const s = y < 8 ? 4.5 * Math.sqrt(Math.max(0, 1 - ((y - 4.7) / 4.5) ** 2)) : 0;
    const sh = y >= 8 && y < 11 ? lerp(2.83, 1.0, sstep(8, 11, y)) : 0; return y < 1 ? Math.max(s, 2.4) : y < 8 ? s : y < 11 ? sh : y > 15.4 ? 1.0 + .18 * sstep(15.4, 16, y) : 1.0; };
  const flask = makeVessel({ H: 16, R: flaskR, wall: .18, floor: .4, refY: 13, glassMat, liqColor: WATER });
  { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.03, .035, 8, 64), new THREE.MeshBasicMaterial({ color: 0xdc2626 })); ring.rotation.x = Math.PI / 2; ring.position.y = 13; flask.group.add(ring); }
  const bottleR = y => y < 7 ? 2.6 : y < 9 ? lerp(2.6, 1.1, sstep(7, 9, y)) : 1.1;
  const stockV = makeVessel({ H: 10.5, R: bottleR, wall: .15, floor: .35, refY: 6.5, glassMat, liqColor: stock });
  stockV.setColor(stock, .88);

  const bx = 0, BY0 = !volM ? PAN : 0;
  const FX = mode === "solid-vol" ? 10 : 3, SX = -10;
  const fp = new THREE.Group(); flask.group.position.y = -8; fp.add(flask.group); // trục xoay bình ở tâm bầu
  scene.add(beaker.group, fp, stockV.group);
  beaker.group.visible = true; fp.visible = volM; stockV.group.visible = !solidM;
  blob(beaker.group, 9, BY0); if (volM) blob(fp, 12, 8); if (!solidM) blob(stockV.group, 8);
  { // nhãn dán trên chai dung dịch gốc & bình định mức
    const lbl = (text, w, h) => { const c = document.createElement("canvas"); c.width = 256; c.height = Math.round(256 * h / w); const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#0f172a"; x.font = "bold 54px Inter, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(text, 128, c.height / 2); return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })); };
    const l1 = lbl(F, 3.4, 1.8); l1.position.set(0, 3.2, 2.66); stockV.group.add(l1);
    const l2 = lbl(A.targetText, 3.6, 1.5); l2.position.set(0, 5, 3.4); flask.group.add(l2);
  }

  /* ---- Cốc/ống đong/pipet dùng để lấy dung dịch gốc (dilute-vol) ---- */
  const toolKind = !solidM && volM ? (A.soluteVolume < 1 ? "micro" : A.soluteVolume <= 25 ? "pip" : "cyl") : null;
  const tools = { pip: null, micro: null, cyl: null };
  let tool = null;
  if (toolKind === "cyl") tool = makeVessel({ H: 15, R: () => 1.5, wall: .12, floor: .3, refY: 13.5, ticks: 10, tickLen: .8, glassMat, liqColor: stock });
  else if (toolKind === "pip") tool = makeVessel({ H: 22, R: y => y < 2 ? .1 + .11 * y : y > 10 && y < 13.5 ? .32 + .62 * Math.sin(Math.PI * (y - 10) / 3.5) : .32, wall: .07, floor: .02, refY: 19.5, glassMat, liqColor: stock });
  else if (toolKind === "micro") {
    tool = makeVessel({ H: 4, R: y => .3 - .05 * y, wall: .05, floor: .02, refY: 3.6, glassMat, liqColor: stock });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.9, .55, 9, 24), std(0xf3f4f6, .4)); body.position.y = 8.2;
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 1.4, 20), std(0xdc2626, .4)); btn.position.y = 13.4; tool.group.add(body, btn);
  }
  if (tool) { tool.setColor(stock, .85); scene.add(tool.group); tool.group.visible = false; }

  /* ---- Chai tia nước cất ---- */
  const wash = new THREE.Group(); { const b = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 7, 32), std(0xf8fafc, .35)); b.position.y = 3.5;
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(.55, 1.5, 1.6, 32), std(0xf8fafc, .35)); sh.position.y = 7.8;
    const nz = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, 2, 12), std(0x2563eb, .4)); nz.position.y = 9.5;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .6, 20), std(0x2563eb, .4)); cap.position.y = 8.9;
    wash.add(b, sh, cap, nz); scene.add(wash); wash.visible = false; }
  const NOZ = new THREE.Vector3(0, 10.5, 0);
  const washPose = (tip, tilt) => { const o = NOZ.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), -tilt); return { x: tip.x - o.x, y: tip.y - o.y }; };
  const WREST = { x: 20, y: 0 };

  /* ---- Lọ chất rắn + thuyền cân + tinh thể ---- */
  const solidBottle = new THREE.Group(); { const b = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5.5, 32), std(0xf8fafc, .3)); b.position.y = 2.75;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 1.1, 32), std(0x2563eb, .4)); c.position.y = 6.05; solidBottle.add(b, c); }
  solidBottle.position.set(solidM && volM ? balX - 8.5 : -9, 0, -1.5); solidBottle.visible = solidM; scene.add(solidBottle);
  const boat = new THREE.Mesh(new THREE.SphereGeometry(1.5, 28, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: .4, side: THREE.DoubleSide }));
  boat.scale.set(1.6, .5, 1.1); boat.visible = solidM; scene.add(boat);
  const NC = 42, cr = rng(7), crystals = [], cgeo = [new THREE.IcosahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.DodecahedronGeometry(1, 0)];
  const cmat = new THREE.MeshStandardMaterial({ color: A.chemId === "kmno4" ? 0x5b1a6b : 0xf8fafc, roughness: .25, metalness: .1 });
  for (let i = 0; i < NC; i++) {
    const m = new THREE.Mesh(cgeo[i % 3], cmat); m.visible = false; scene.add(m);
    crystals.push({ m, a: cr() * 6.28, rr: cr(), s: .16 + cr() * .2, d: cr() * .55, rot: cr() * 6, bx: (cr() - .5) * 1.8, bz: (cr() - .5) * 1.1, ph: cr() });
  }

  /* ---- Đũa thủy tinh, nút bình, hơi nhiệt ---- */
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 1, 14), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: .45, roughness: .05, clearcoat: 1, envMapIntensity: 1.5 }));
  rod.visible = false; scene.add(rod); const Y = new THREE.Vector3(0, 1, 0);
  const setRod = (a, b) => { const d = b.clone().sub(a), len = d.length(); rod.position.copy(a).addScaledVector(d, .5); rod.scale.set(1, len, 1); rod.quaternion.setFromUnitVectors(Y, d.normalize()); rod.visible = true; };
  const stopper = new THREE.Group(); { const c = new THREE.Mesh(new THREE.CylinderGeometry(1.1, .8, 2.2, 24), new THREE.MeshPhysicalMaterial({ color: 0xe0f2fe, transparent: true, opacity: .6, roughness: .1, clearcoat: 1 }));
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, .5, 24), new THREE.MeshPhysicalMaterial({ color: 0xe0f2fe, transparent: true, opacity: .6, roughness: .1 })); t.position.y = 1.3; stopper.add(c, t); }
  stopper.visible = false; scene.add(stopper);
  const vapors = []; const vgeo = new THREE.SphereGeometry(.5, 10, 8);
  for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(vgeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; scene.add(m); vapors.push(m); }

  /* ---- Dòng chảy, giọt định mức, vi giọt ---- */
  const jetMat = new THREE.MeshPhysicalMaterial({ color: WATER, transparent: true, opacity: .75, roughness: .05, clearcoat: 1 });
  const pourMat = jetMat.clone();
  const jet = makeStream(jetMat), pour = makeStream(pourMat); scene.add(jet, pour);
  const drop = new THREE.Mesh(teardropGeo(), jetMat); drop.visible = false; scene.add(drop);
  const spl = Array.from({ length: 5 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), jetMat); m.visible = false; scene.add(m); return m; });
  const wd = Array.from({ length: 6 }, (_, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.07 + (i % 3) * .015, 8, 6), jetMat); m.visible = false; scene.add(m); return m; });

  /* ---------------------------------- Trạng thái số P (duy nhất) ---------------------------------- */
  const P = { cTh: .3, cPh: 1.2, cD: 50, cX: 0, cY: 7, cZ: 0,
    bX: bx, bY: BY0, bTilt: 0, bFill: 0, fFill: 0, fRot: 0, fLift: 0, sFill: .85, sX: SX, sTilt: 0,
    tFill: 0, tX: SX, tY: 26, tTilt: 0, tOn: 0, wOn: 0, wX: WREST.x, wY: 0, wTilt: 0,
    boatX: -13, boatY: PAN + 8, boatTilt: 0, boatOn: 0, boatLoad: 0, fall: 0, dissolve: 0,
    lcd: 0, tint: 0, heat: 0, heatV: 0, vort: 0, stir: 0, slosh: 0, rodMode: 0, rodT: 0,
    jH: 0, jT: 0, jTgt: 0, pH: 0, pT: 0, pSrc: 0, dropT: 0, dropOn: 0, wallT: 0, stopY: 30, mark: 0 };

  /* ---------------------------------- Timeline ---------------------------------- */
  const tl = gsap.timeline({ paused: true }), steps = [];
  const seg = (at, dur, spec, ease = "power2.inOut") => {
    const from = {}, to = {}; for (const k in spec) { from[k] = spec[k][0]; to[k] = spec[k][1]; }
    tl.fromTo(P, from, { ...to, duration: Math.max(dur, .001), ease, immediateRender: false }, at);
  };
  const sw = (at, k, a, b) => seg(at, .001, { [k]: [a, b] });
  const camSpec = (c, p) => ({ cTh: [p[0], c[0]], cPh: [p[1], c[1]], cD: [p[2], c[2]], cX: [p[3], c[3]], cY: [p[4], c[4]], cZ: [p[5], c[5]] });
  let cur = 0;
  const step = (cap, dur, cam, fn) => {
    const i = steps.length, prev = i ? steps[i - 1].cam : cam;
    steps.push({ t: cur, dur, cap, cam });
    seg(cur, 1.3, camSpec(cam, prev));
    fn(cur); cur += dur;
  };
  const lipLocal = v => new THREE.Vector3(v.R(v.H), v.H, 0);
  const poseFromLip = (v, lipT, tilt) => { const o = lipLocal(v).applyAxisAngle(new THREE.Vector3(0, 0, 1), -tilt); return { x: lipT.x - o.x, y: lipT.y - o.y }; };
  const JT = 2.95; // chai tia gần như thẳng đứng hướng xuống
  const washFill = (t, dur, tip, tgt, key, f0, f1) => {
    const end = washPose(tip, JT);
    seg(t, .8, { wOn: [0, 1], wX: [WREST.x, end.x], wY: [WREST.y, end.y], wTilt: [0, JT] });
    seg(t + .8, .001, { jTgt: [tgt, tgt] });
    seg(t + .8, .5, { jH: [0, 1], jT: [0, 0] }, "none");
    seg(t + .9, dur - 2.1, { [key]: [f0, f1] }, "none");
    seg(t + dur - .9, .5, { jT: [0, 1] }, "none");
    seg(t + dur - .7, .7, { wX: [end.x, WREST.x], wY: [end.y, WREST.y], wTilt: [JT, 0] });
    sw(t + dur - .01, "wOn", 1, 0); sw(t + dur - .01, "jH", 1, 0);
  };
  const stirSeq = (t, dur, vessel) => { // đũa khuấy + phễu xoáy + hòa tan + đổi màu + (nếu tỏa nhiệt) hơi bốc lên
    seg(t, .8, { rodT: [0, 1] }); sw(t, "rodMode", 0, 1);
    seg(t + .4, dur - .9, { stir: [0, 6.2 * (dur - .9)] }, "none");
    seg(t + .5, 1, { vort: [0, 1] }); seg(t + dur - 1.1, 1, { vort: [1, 0] });
    seg(t + dur - .7, .6, { rodT: [1, 0] }); sw(t + dur - .05, "rodMode", 1, 0);
    if (exo) { sw(t, "heatV", vessel, vessel); seg(t + .6, dur - .6, { heat: [0, 1] }, "none"); }
  };
  const stopperSeq = (t, dur) => {
    seg(t, 1, { stopY: [30, 16.9] }, "power2.in");
    const k = [.9, -.9, .9, -.9, 0]; k.forEach((a, i) => seg(t + 1.1 + i * .5, .5, { fRot: [i ? k[i - 1] : 0, a] }));
    seg(t, 1, { heat: [1, 0] });
  };
  const camBal = [.25, 1.2, 24, balX, 3, 0];

  if (mode === "solid-vol") {
    const camAll = [.35, 1.2, 62, -1, 8, 0], camPour = [.6, 1.25, 40, 6, 12, 0], camMark = [.1, 1.43, 16, FX, 13, 0];
    step(`Cân ${fmtMass(sa)} ${F} lên thuyền cân (đã hiệu chỉnh độ tinh khiết).`, 3.4, camBal, t => {
      seg(t, .7, { boatOn: [1, 1], boatX: [balX - 7, balX], boatY: [PAN + 7, PAN + .05] }); seg(t + .6, 2.5, { boatLoad: [0, 1], lcd: [0, sa] }, "none"); });
    step("Cho khoảng 60–70% thể tích dung môi (nước cất) vào cốc.", 4, camAll, t => {
      washFill(t, 4, new THREE.Vector3(bx - .8, 14, 0), 0, "bFill", 0, .6); });
    step("Đổ chất rắn từ thuyền cân vào cốc.", 3.6, [.3, 1.1, 30, 0, 6, 0], t => {
      seg(t, 1.2, { boatX: [balX, bx + 1.3], boatY: [PAN + .05, 12.8], boatTilt: [0, -.9] });
      seg(t + 1.2, 1.7, { fall: [0, 1] }, "none"); seg(t + 3, .6, { boatY: [12.8, 22], boatX: [bx + 1.3, bx + 7] }); });
    step(`Khuấy bằng đũa thủy tinh đến tan hoàn toàn${exo ? "; dung dịch tỏa nhiệt — chờ nguội về nhiệt độ phòng" : ""}.`, 4.6, [.3, 1.15, 30, 0, 5.5, 0], t => {
      stirSeq(t, 4.6, 0); seg(t + .6, 3.2, { dissolve: [0, 1], tint: [0, 1] }, "none"); });
    const bp = poseFromLip(beaker, { x: FX - 3.2, y: 18.4 }, 1.3), lipT = new THREE.Vector3(FX - 3.2, 18.4, 0);
    step(`Rót dọc đũa thủy tinh vào bình định mức ${fmtVol(FV)} (tráng cốc 2–3 lần).`, 6, camPour, t => {
      seg(t, 1.3, { bX: [bx, bp.x], bY: [BY0, bp.y], bTilt: [0, 1.3] }); sw(t + 1, "rodMode", 0, 2); sw(t + 1, "pSrc", 0, 0);
      seg(t + 1.1, .6, { pH: [0, 1], pT: [0, 0] }, "none"); seg(t + 1.3, 3.4, { bFill: [.6, .05], fFill: [0, .72] }, "none"); seg(t + 4.5, .6, { pT: [0, 1] }, "none");
      sw(t + 4.9, "rodMode", 2, 0); seg(t + 4.7, 1.2, { bX: [bp.x, bx], bY: [bp.y, BY0], bTilt: [1.3, 0] }); seg(t + 4.9, .001, { pH: [1, 0] }); seg(t + 1.4, 3.3, { slosh: [0, .6] }); seg(t + 4.7, 1, { slosh: [.6, 0] }); });
    step(`Thêm nước đến sát vạch, rồi nhỏ từng giọt đến vạch định mức ${fmtVol(FV)}.`, 9.4, camMark, t => dilutionToMark(t, .72));
    step("Đậy nút, đảo ngược bình ≥ 10 lần để dung dịch đồng nhất.", 4.2, [.3, 1.15, 36, FX, 9, 0], t => stopperSeq(t, 4.2));
  } else if (mode === "solid-mass") {
    const camAll = [.3, 1.2, 34, 0, 5.5, 0];
    step("Đặt cốc lên cân, đợi số ổn định rồi nhấn Tare để cân bì.", 3.4, [.25, 1.15, 26, 0, 4.5, 0], t => {
      seg(t, 1, { bY: [PAN + 8, PAN] }, "power2.in"); seg(t + 1, 1, { lcd: [0, 38.6] }, "none"); seg(t + 2.2, .6, { lcd: [38.6, 0] }, "none"); });
    step(`Cân ${fmtMass(sa)} ${F} vào cốc đã cân bì.`, 4, [.3, 1.1, 28, 0, 6, 0], t => {
      sw(t, "boatOn", 0, 1); seg(t, 1, { boatX: [bx + 9, bx + 1.3], boatY: [PAN + 16, PAN + 11.5], boatTilt: [0, -.9], boatLoad: [1, 1] });
      seg(t + 1, 2.2, { fall: [0, 1], lcd: [0, sa] }, "none"); seg(t + 3.3, .7, { boatY: [PAN + 11.5, PAN + 22], boatX: [bx + 1.3, bx + 8] }); });
    step(`Thêm ${fmtMass(wa)} nước cất theo khối lượng (cân trực tiếp đến ${fmtMass(A.finalMass)}).`, 4.4, camAll, t => {
      washFill(t, 4.4, new THREE.Vector3(bx - .8, PAN + 14, 0), 0, "bFill", 0, .55); seg(t + .9, 2.4, { lcd: [sa, A.finalMass] }, "none"); });
    step(`Khuấy đến tan hoàn toàn${exo ? "; tỏa nhiệt — để nguội nếu cần" : ""}.`, 4.6, camAll, t => {
      stirSeq(t, 4.6, 0); seg(t + .6, 3.2, { dissolve: [0, 1], tint: [0, 1] }, "none"); });
  } else if (mode === "dilute-vol") {
    const camAll = [.3, 1.2, 56, -3, 9, 0], camMark = [.1, 1.43, 16, FX, 13, 0];
    const vs = A.soluteVolume, fAdd = clamp(vs / FV, .015, .4), fMid = .5;
    const kind = { micro: "micropipet", pip: "pipet", cyl: "ống đong" }[toolKind];
    step(`Cho trước nước cất (khoảng một nửa thể tích) vào bình định mức ${fmtVol(FV)}.`, 4, camAll, t => {
      washFill(t, 4, new THREE.Vector3(FX - .9, 19.5, 0), 1, "fFill", 0, fMid); });
    step(`Dùng ${kind} lấy chính xác ${fmtVol(vs)} ${F} gốc.`, 4.2, [.3, 1.1, 44, -6, 9, 0], t => {
      sw(t, "tOn", 0, 1);
      if (toolKind === "cyl") { seg(t, 1, { tX: [SX - 6, SX - 6], tY: [0, 0] }); seg(t + .8, 2.6, { tFill: [0, 1], sFill: [.85, .78] }, "none"); }
      else { seg(t, 1.2, { tX: [SX, SX], tY: [26, 2.4] }); seg(t + 1.3, 1.8, { tFill: [0, 1], sFill: [.85, .84] }, "none"); seg(t + 3.2, 1, { tY: [2.4, 26] }); } });
    if (toolKind === "cyl") {
      const tp = poseFromLip(tool, { x: FX - 2.6, y: 18.4 }, 1.0), cx0 = SX - 6;
      step(`Rót ${F} gốc từ từ dọc đũa thủy tinh vào nước${A.isAcid ? " (luôn cho axit vào nước)" : ""}.`, 5.4, [.6, 1.25, 42, FX - 4, 11, 0], t => {
        seg(t, 1.4, { tX: [cx0, tp.x], tY: [0, tp.y], tTilt: [0, 1.0] }); sw(t + 1.1, "rodMode", 0, 2); sw(t + 1.1, "pSrc", 0, 3);
        seg(t + 1.2, .5, { pH: [0, 1], pT: [0, 0] }, "none"); seg(t + 1.4, 2.6, { tFill: [1, 0], fFill: [fMid, fMid + fAdd] }, "none"); seg(t + 4, .6, { pT: [0, 1] }, "none");
        sw(t + 4.6, "rodMode", 2, 0); seg(t + 4.6, .8, { tX: [tp.x, cx0], tY: [tp.y, 0], tTilt: [1.0, 0] }); sw(t + 4.6, "pH", 1, 0); });
    } else {
      const tipW = new THREE.Vector3(FX - .45, 15.0, 0);
      step(`Đưa đầu ${kind} sát thành bình, thả từ từ ${F} gốc xuống nước${A.isAcid ? " (luôn cho axit vào nước)" : ""}.`, 5.4, [.35, 1.3, 30, FX, 12, 0], t => {
        seg(t, 1.4, { tX: [SX, tipW.x], tY: [26, 19] }); seg(t + 1.4, .6, { tY: [19, tipW.y] }); sw(t + 1.9, "pSrc", 0, 2);
        seg(t + 2, .4, { pH: [0, 1], pT: [0, 0] }, "none"); seg(t + 2, 2.6, { tFill: [1, 0], fFill: [fMid, fMid + fAdd] }, "none"); seg(t + 4.4, .4, { pT: [0, 1] }, "none");
        sw(t + 4.8, "pH", 1, 0); seg(t + 4.6, .8, { tY: [tipW.y, 30] }); sw(t + 5.4, "tOn", 1, 0); }); }
    step(`Xoay nhẹ để trộn đều${exo ? "; chờ nguội về nhiệt độ phòng (dung dịch tỏa nhiệt)" : ""}.`, 4, [.3, 1.15, 38, FX, 9, 0], t => {
      const k = [.35, -.35, .3, -.3, 0]; k.forEach((a, i) => seg(t + .3 + i * .6, .6, { fRot: [i ? k[i - 1] : 0, a] })); seg(t, 3.4, { tint: [0, 1], slosh: [.5, .5] }, "none");
      if (exo) { sw(t, "heatV", 1, 1); seg(t, 3.6, { heat: [0, 1] }, "none"); } });
    step(`Thêm nước sát vạch, rồi nhỏ từng giọt đến vạch định mức ${fmtVol(FV)}.`, 9.4, camMark, t => dilutionToMark(t, fMid + fAdd));
    step("Đậy nút, đảo ngược bình ≥ 10 lần để dung dịch đồng nhất.", 4.2, [.3, 1.15, 36, FX, 9, 0], t => stopperSeq(t, 4.2));
  } else { // dilute-mass
    const camAll = [.3, 1.2, 40, -3, 6.5, 0], sp = poseFromLip(stockV, { x: bx - 4.8, y: PAN + 12.4 }, 1.3), sRest = { x: SX, y: 0 };
    step("Đặt cốc lên cân, đợi số ổn định rồi nhấn Tare để cân bì.", 3.4, [.25, 1.15, 26, 0, 4.5, 0], t => {
      seg(t, 1, { bY: [PAN + 8, PAN] }, "power2.in"); seg(t + 1, 1, { lcd: [0, 38.6] }, "none"); seg(t + 2.2, .6, { lcd: [38.6, 0] }, "none"); });
    step(`Cho trước ${fmtMass(wa)} nước cất vào cốc (cân trực tiếp).`, 4.4, camAll, t => {
      washFill(t, 4.4, new THREE.Vector3(bx - .8, PAN + 14, 0), 0, "bFill", 0, .5); seg(t + .9, 2.4, { lcd: [0, wa] }, "none"); });
    step(`Thêm từ từ ${fmtMass(sa)} ${F} gốc dọc đũa thủy tinh${A.isAcid ? " (luôn cho axit vào nước)" : ""}.`, 6, [.6, 1.2, 44, -4, 8, 0], t => {
      seg(t, 1.5, { sX: [sRest.x, sp.x], sTilt: [0, 1.3] }); sw(t + 1.1, "rodMode", 0, 2); sw(t + 1.1, "pSrc", 0, 1);
      seg(t + 1.4, .5, { pH: [0, 1], pT: [0, 0] }, "none"); seg(t + 1.6, 2.6, { sFill: [.85, .72], bFill: [.5, .58], lcd: [wa, A.finalMass] }, "none"); seg(t + 4.4, .5, { pT: [0, 1] }, "none");
      sw(t + 4.9, "rodMode", 2, 0); sw(t + 4.9, "pH", 1, 0); seg(t + 4.7, 1.2, { sX: [sp.x, sRest.x], sTilt: [1.3, 0] }); });
    step(`Khuấy đều đến khi ${exo ? "dung dịch nguội và " : ""}đồng nhất.`, 4.6, [.3, 1.15, 30, 0, 6, 0], t => {
      stirSeq(t, 4.6, 0); seg(t + .3, 3.4, { tint: [0, 1] }, "none"); });
  }

  /** Định mức: tia nước đến sát vạch rồi nhỏ giọt hình giọt lệ, vi giọt bám thành cổ bình */
  function dilutionToMark(t, f0) {
    const NDROP = 3, DS = 1.2;
    washFill(t, 3.4, new THREE.Vector3(FX - .9, 19.5, 0), 1, "fFill", f0, .93);
    const d0 = t + 3.4;
    const dp = washPose(new THREE.Vector3(FX, 19.5, 0), Math.PI);
    seg(d0, .7, { wOn: [0, 1], wX: [WREST.x, dp.x], wY: [WREST.y, dp.y], wTilt: [0, Math.PI] });
    seg(d0 + .7, NDROP * DS, { dropT: [0, NDROP], fFill: [.93, 1.0], wallT: [0, 1] }, "none"); sw(d0 + .7, "dropOn", 0, 1); sw(d0 + .7 + NDROP * DS, "dropOn", 1, 0);
    seg(d0 + .7 + NDROP * DS, .5, { mark: [0, 1] }); seg(d0 + 1.2 + NDROP * DS, .6, { wOn: [1, 0] }, "none");
  }
  // Với flow dilutionToMark (hàm hoisted): các biến đã khai báo trước khi step() gọi

  const total = cur + .8; tl.set({}, {}, total); // giữ độ dài timeline
  steps.forEach((s, i) => tl.addLabel("s" + i, s.t));

  /* ---------------------------------- Áp trạng thái P → cảnh 3D ---------------------------------- */
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), tmp = V3(0, 0, 0), tmp2 = V3(0, 0, 0);
  const lipWorld = v => { v.group.updateMatrixWorld(true); const q = lipLocal(v); return v.group.localToWorld(q); };
  const surfYOf = (v, f) => { v.group.updateMatrixWorld(true); const q = V3(0, v.hOf(f), 0); return v.group.localToWorld(q).y; };
  const waterC = new THREE.Color(WATER), tintC = new THREE.Color(stock), mixC = new THREE.Color();
  const dropSplashDir = Array.from({ length: 5 }, (_, i) => ({ vx: (i - 2) * .55, vy: 1.4 + (i % 2) * .5 }));
  const fCenter = () => FX;
  let lastLCD = "";

  function apply(time) {
    const p = P;
    // vật dụng
    beaker.f = p.bFill; stockV.f = p.sFill; if (volM) flask.f = p.fFill;
    beaker.group.position.set(p.bX, p.bY, 0); beaker.group.rotation.z = -p.bTilt;
    fp.position.set(FX, 8 + p.fLift, 0); fp.rotation.z = p.fRot;
    stockV.group.position.set(p.sX, 0, 0); stockV.group.rotation.z = -p.sTilt;
    if (tool) {
      tool.f = p.tFill; tool.group.visible = p.tOn > .5; tool.group.position.set(p.tX, p.tY, 0); tool.group.rotation.z = -p.tTilt;
    }
    wash.visible = p.wOn > .5; wash.position.set(p.wX, p.wY, 0); wash.rotation.z = -p.wTilt;
    boat.visible = solidM && p.boatOn > .5; boat.position.set(p.boatX, p.boatY, 0); boat.rotation.z = -p.boatTilt * .5;
    stopper.visible = p.stopY < 29; stopper.position.set(FX, p.stopY, 0);

    scene.updateMatrixWorld(true);
    // màu dung dịch (nước cất → màu hóa chất)
    mixC.copy(waterC).lerp(tintC, p.tint * .85); beaker.setColor(mixC, lerp(.55, .82, p.tint)); flask.setColor(mixC, lerp(.55, .82, p.tint));
    jetMat.color.copy(waterC); pourMat.color.copy(p.pSrc === 0 ? mixC : tintC);

    // mặt thoáng + sóng
    let ripB = null, ripF = null;
    const dropK = Math.floor(clamp(p.dropT, 0, 2.999)), du = p.dropT - dropK;
    const tSince = p.dropOn ? (du >= .9 ? du - .9 : p.dropT >= 1 ? du + .1 : -1) * 1.2 : -1;
    if (p.dropOn && tSince >= 0) ripF = { a: .22, t: tSince };
    const stirring = p.rodMode === 1;
    beaker.update(time, { vort: stirring ? p.vort : 0, slosh: p.slosh * (volM && mode === "solid-vol" ? 1 : 0) });
    stockV.update(time, {});
    if (volM) flask.update(time, { rip: ripF, slosh: p.slosh });
    if (tool) tool.update(time, {});

    // tinh thể: nằm trong thuyền → rơi → quay cuộn xoáy ốc khi khuấy → nhỏ dần tan hết
    const bk = beaker.group.position, bFloor = bk.y + beaker.floor + .15, rIn = beaker.inner(1) - .5;
    crystals.forEach((c, i) => {
      const m = c.m; let vis = false;
      const loadVis = solidM && p.boatOn > .5 && i < p.boatLoad * NC + .001 && p.fall <= 0;
      if (p.fall <= 0) {
        if (loadVis) { m.position.set(p.boatX + c.bx, p.boatY + .2 + c.ph * .25, c.bz); m.scale.setScalar(c.s); vis = true; }
      } else {
        const u = clamp((p.fall - c.d) / .45), ang = c.a + p.stir * (.5 + c.rr * .6) * (p.rodMode === 1 || p.stir > 0 ? 1 : 0), rr = (.15 + c.rr * .6) * rIn * (1 - .35 * p.vort * c.ph);
        const dst = V3(bk.x + rr * Math.cos(ang), bFloor + c.s * .8 + p.vort * c.ph * .6, rr * Math.sin(ang));
        const src = V3(p.boatX + c.bx, p.boatY + .2, c.bz);
        m.position.set(lerp(src.x, dst.x, u), lerp(src.y, dst.y, u * u), lerp(src.z, dst.z, u));
        m.scale.setScalar(c.s * (1 - sstep(c.d * .4, 1, p.dissolve))); vis = m.scale.x > .01;
      }
      m.visible = vis; m.rotation.set(c.rot + (p.fall > 0 ? p.stir * .4 : 0), c.rot * 2, c.rot);
    });

    // LCD cân điện tử (fmtMass/fmtVol khớp #calc)
    if (needBal) { const txt = p.lcd <= 0 ? "0,000 g" : fmtMass(p.lcd); bal.draw(txt); lastLCD = txt; }

    // đũa thủy tinh
    rod.visible = false;
    if (p.rodMode === 1) { const a = p.stir, top = V3(bk.x + 3.2, bk.y + 18, 0), tip = V3(bk.x + .85 * Math.cos(a) * p.rodT, lerp(bk.y + 14, bk.y + 1, p.rodT), .85 * Math.sin(a) * p.rodT); setRod(top, tip); }
    // dòng chảy
    jet.visible = false; pour.visible = false; drop.visible = false; spl.forEach(s => s.visible = false); wd.forEach(w => w.visible = false);
    if (wash.visible && (p.jH > .004)) {
      wash.updateMatrixWorld(true); const tip = wash.localToWorld(NOZ.clone()), dir = V3(0, 1, 0).applyQuaternion(wash.quaternion).normalize();
      const tgtV = p.jTgt === 1 ? flask : beaker, endY = Math.max(surfYOf(tgtV, tgtV.f), tgtV === flask ? 0 : bk.y + .6);
      // đoạn hiển thị [jT, jH]: đầu dòng tiến tới mặt thoáng, đuôi dòng rút theo khi ngắt
      jet.setPath(freeJet(tip, dir, 45, endY), clamp(p.jT, 0, .99), clamp(Math.max(p.jH, p.jT + .01), 0, 1));
    }
    if (p.pH > .004 || p.rodMode === 2) {
      let path = null;
      if (p.pSrc === 0 || p.pSrc === 3 || p.pSrc === 1) {
        const srcV = p.pSrc === 0 ? beaker : p.pSrc === 1 ? stockV : tool, tgtV = p.pSrc === 1 ? beaker : flask;
        const lip = lipWorld(srcV).add(V3(0, .1, 0)), cx = p.pSrc === 1 ? bk.x : FX, side = p.pSrc === 1 ? 1 : -1;
        const topY = p.pSrc === 1 ? bk.y + beaker.H : flask.H;
        const tPt = V3(cx + side * (p.pSrc === 1 ? 3.1 : .72), topY - (p.pSrc === 1 ? 1.2 : .8), 0);
        const wallV = p.pSrc === 1 ? beaker : { group: { position: { y: 0 } }, inner: flask.inner, floor: flask.floor, H: flask.H };
        if (p.rodMode === 2) setRod(lip.clone().lerp(tPt, -.45), tPt);
        path = wallPath(lip, tPt, wallV, cx, side, surfYOf(tgtV, tgtV.f), .22);
      } else if (p.pH > .004) { // pipet / micropipet: đầu tip chạm thành trong cổ bình
        tool.group.updateMatrixWorld(true); const tip = tool.group.localToWorld(V3(0, .05, 0));
        path = wallPath(tip, null, { group: { position: { y: 0 } }, inner: flask.inner, floor: flask.floor, H: flask.H }, FX, -1, surfYOf(flask, flask.f), .12);
      }
      if (p.pH > .004 && path) pour.setPath(path, clamp(p.pT, 0, .99), clamp(Math.max(p.pH, p.pT + .01), 0, 1));
    }
    // giọt định mức (teardrop) + vi giọt + giọt bám thành cổ bình
    if (p.dropOn && volM) {
      const tipY = 19.5, sY = surfYOf(flask, flask.f), ud = clamp(du);
      drop.visible = true; const sc = .55;
      if (ud < .55) { const g = sstep(0, .55, ud); drop.scale.set(sc * g, sc * g, sc * g); drop.position.set(FX, tipY - 1.5 * sc * g, 0); }
      else if (ud < .7) { const s = (ud - .55) / .15; drop.scale.set(sc * (1 - .15 * s), sc * (1 + 1.2 * s), sc * (1 - .15 * s)); drop.position.set(FX, tipY - 1.5 * sc - s * .3, 0); }
      else if (ud < .9) { const s = (ud - .7) / .2; drop.scale.set(sc * .85, sc * 1.1, sc * .85); drop.position.set(FX, lerp(tipY - 2, sY + .3, s * s), 0); }
      else drop.visible = false;
      if (tSince >= 0 && tSince < .12) spl.forEach((s, i) => { const k = clamp(tSince / .12); s.visible = true; s.position.set(FX + dropSplashDir[i].vx * k * 1.2, sY + dropSplashDir[i].vy * 4 * k * (1 - k), (i % 2 ? 1 : -1) * .25 * k); });
      wd.forEach((w, i) => {
        const y0 = 15.7 - i * .38, y = y0 - p.wallT * (2.4 + i * .5) , sY2 = sY;
        if (p.wallT > 0 && y > sY2 + .15) { const phi = (i - 2.5) * .35, r = flask.inner(clamp(y, 1, 16)) - .06; w.visible = true; w.position.set(FX + r * Math.sin(phi), y, r * Math.cos(phi)); }
      });
    }

    // hơi nhiệt (chỉ khi exothermic)
    const hv = p.heatV === 1 ? flask.group : beaker.group, top = hv.localToWorld(V3(0, p.heatV === 1 ? 16 : 9, 0));
    vapors.forEach((m, i) => {
      if (!exo || p.heat < .02) { m.visible = false; return; }
      const a = (time * .35 + i / vapors.length) % 1; m.visible = true;
      m.position.set(top.x + Math.sin(time * 1.3 + i * 2.1) * (.3 + a * .9), top.y + .4 + a * 7, top.z + Math.cos(time + i) * .5);
      m.scale.setScalar(.6 + a * 1.7); m.material.opacity = p.heat * (1 - a) * .3;
    });
    // bóng mờ
    blobs.forEach(b => { const w = b.obj.getWorldPosition(tmp2); b.m.position.x = w.x; b.m.material.opacity = clamp(1 - Math.max(0, w.y - b.base) / 12); b.m.visible = b.obj.visible; });
  }

  return { scene, camera, P, tl, steps, apply, bal, lcdText: () => lastLCD, FX, volM, solidM, needBal, mode, dispose() { scene.traverse(o => { o.geometry?.dispose?.(); }); } };
}

/* ====================================================================================================
 * mount: dựng khung sân khấu (canvas WebGL + điều khiển) vào host, trả về { destroy }
 * ================================================================================================== */
const VIEWS = [["dir", "Đạo diễn"], ["all", "Toàn cảnh"], ["mark", "Cận cảnh vạch"], ["top", "Góc cao"]];

export function mount(host, anim) {
  const lib = { THREE: globalThis.THREE, gsap: globalThis.gsap };
  if (!lib.THREE || !lib.gsap) { host.innerHTML = `<div class="lab3d-err">Chưa tải được thư viện 3D (Three.js / GSAP). Hãy kết nối mạng một lần để lưu vào bộ nhớ đệm.</div>`; return { destroy() {} }; }
  host.innerHTML = `<div class="lab3d"><div class="lab3d-view"><canvas></canvas><div class="lab3d-hud"></div>
    <div class="lab3d-cams">${VIEWS.map(([k, n], i) => `<button type="button" data-v="${k}" class="${i ? "" : "on"}">${n}</button>`).join("")}</div></div>
    <div class="lab3d-cap"></div>
    <div class="lab3d-bar"><button type="button" data-a="prev" aria-label="Bước trước">⏮</button><button type="button" data-a="play" aria-label="Tạm dừng / Phát lại">⏸</button><button type="button" data-a="next" aria-label="Bước tiếp">⏭</button>
    <div class="lab3d-dots"></div></div><div class="lab3d-prog"><i></i></div></div>`;
  const $ = s => host.querySelector(s), canvas = $("canvas");
  let renderer;
  try {
    renderer = new lib.THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) { host.innerHTML = `<div class="lab3d-err">Thiết bị không hỗ trợ WebGL nên không hiển thị được mô phỏng 3D.</div>`; return { destroy() {} }; }
  const THREE_ = lib.THREE;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputEncoding = THREE_.sRGBEncoding; renderer.toneMapping = THREE_.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;

  const sim = createSim(anim, lib), { scene, camera, tl, steps, P } = sim;
  { // môi trường studio (PMREM) cho phản xạ/khúc xạ thủy tinh
    const env = new THREE_.Scene(); env.add(new THREE_.Mesh(new THREE_.SphereGeometry(60, 24, 12), new THREE_.MeshBasicMaterial({ color: 0x9fb0c3, side: THREE_.BackSide })));
    const panel = (w, h, x, y, z, i) => { const m = new THREE_.Mesh(new THREE_.PlaneGeometry(w, h), new THREE_.MeshBasicMaterial({ color: new THREE_.Color(i, i, i), side: THREE_.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    panel(40, 20, 0, 40, 12, 7); panel(14, 40, -38, 14, 8, 5); panel(14, 40, 38, 14, -6, 4); panel(30, 12, 0, 8, 45, 3);
    const pm = new THREE_.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, .02).texture; pm.dispose();
  }

  const hud = $(".lab3d-hud"), cap = $(".lab3d-cap"), dots = $(".lab3d-dots"), prog = $(".lab3d-prog i"), playBtn = $("[data-a=play]");
  dots.innerHTML = steps.map((s, i) => `<button type="button" data-i="${i}" aria-label="Bước ${i + 1}"></button>`).join("");

  // Camera: quỹ đạo quanh mục tiêu; kéo/chạm xoay 360°, cuộn/chụm để thu phóng
  let view = "dir", off = { th: 0, ph: 0, z: 1 }; const cs = { th: 0, ph: 0, d: 0, x: 0, y: 0, z: 0 }; let first = true;
  const FX = sim.FX, vm = sim.volM;
  const preset = { all: [.4, 1.22, vm ? 62 : 46, vm ? FX / 2 - 2 : 0, 8, 0], mark: vm ? [.1, 1.43, 16, FX, 13, 0] : [.12, 1.4, 20, 0, 6, 0], top: [.3, .55, vm ? 60 : 44, vm ? FX / 2 - 2 : 0, 6, 0] };
  const target = () => view === "dir" ? [P.cTh, P.cPh, P.cD, P.cX, P.cY, P.cZ] : preset[view];
  function updCam(dt) {
    const t = target(), k = first ? 1 : 1 - Math.exp(-6 * dt); first = false;
    cs.th = lerp(cs.th, t[0], k); cs.ph = lerp(cs.ph, t[1], k); cs.d = lerp(cs.d, t[2], k); cs.x = lerp(cs.x, t[3], k); cs.y = lerp(cs.y, t[4], k); cs.z = lerp(cs.z, t[5], k);
    const th = cs.th + off.th, ph = clamp(cs.ph + off.ph, .12, 1.55), d = cs.d * off.z;
    camera.position.set(cs.x + d * Math.sin(ph) * Math.sin(th), cs.y + d * Math.cos(ph), cs.z + d * Math.sin(ph) * Math.cos(th)); camera.lookAt(cs.x, cs.y, cs.z);
  }
  const ptrs = new Map(); let pinch = 0;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); });
  canvas.addEventListener("pointermove", e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    if (ptrs.size === 1) { off.th -= (e.clientX - prev.clientX) * .008; off.ph -= (e.clientY - prev.clientY) * .008; }
    ptrs.set(e.pointerId, e);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) off.z = clamp(off.z * pinch / d, .35, 2.2); pinch = d; }
  });
  const up = e => { ptrs.delete(e.pointerId); pinch = 0; }; canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", e => { e.preventDefault(); off.z = clamp(off.z * Math.exp(e.deltaY * .001), .35, 2.2); }, { passive: false });

  const stepAt = tm => { let i = 0; steps.forEach((s, k) => { if (tm >= s.t - .001) i = k; }); return i; };
  let lastStep = -1;
  const ui = () => {
    const tm = tl.time(), i = stepAt(tm);
    if (i !== lastStep) { lastStep = i; cap.textContent = `${i + 1}/${steps.length} · ${steps[i].cap}`; dots.querySelectorAll("button").forEach((b, k) => b.classList.toggle("on", k === i)); }
    dots.querySelectorAll("button").forEach((b, k) => b.classList.toggle("done", k < i));
    prog.style.width = `${clamp(tm / (tl.duration() || 1)) * 100}%`;
    playBtn.textContent = tl.paused() ? "▶" : "⏸";
  };
  const hudText = () => {
    const a = anim, parts = [];
    if (sim.needBal) parts.push(`Cân: ${sim.lcdText() || "0,000 g"}`);
    if (sim.volM) parts.push(`Bình ${fmtVol(a.finalVolume)}: ${fmtVol(P.fFill * a.finalVolume)}`);
    if (!sim.solidM && sim.volM && P.tOn > .5) parts.push(`Lấy: ${fmtVol(P.tFill * a.soluteVolume)}`);
    return parts.join("  ·  ");
  };
  const go = i => { i = clamp(i, 0, steps.length - 1); tl.tweenTo("s" + i, { duration: clamp(Math.abs(tl.time() - steps[i].t) * .25, .25, 1.2), ease: "power1.inOut" }); };
  host.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) { view = b.dataset.v; off = { th: 0, ph: 0, z: 1 }; host.querySelectorAll(".lab3d-cams button").forEach(x => x.classList.toggle("on", x === b)); }
    else if (b.dataset.i != null) { tl.pause(); go(+b.dataset.i); }
    else if (b.dataset.a === "prev") { tl.pause(); const i = stepAt(tl.time()); go(tl.time() - steps[i].t > .6 ? i : i - 1); }
    else if (b.dataset.a === "next") { tl.pause(); go(stepAt(tl.time()) + 1); }
    else if (b.dataset.a === "play") { if (tl.progress() >= 1) tl.restart(); else tl.paused(!tl.paused()); ui(); }
  });
  tl.eventCallback("onUpdate", ui); tl.eventCallback("onComplete", ui);

  const view$ = $(".lab3d-view");
  const resize = () => { const w = view$.clientWidth || 380, h = view$.clientHeight || 230; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(view$); resize();
  let raf = 0, last = performance.now(), dead = false, shown = "";
  const loop = now => {
    if (dead) return; raf = requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    sim.apply(now / 1000); updCam(dt); renderer.render(scene, camera);
    const h = hudText(); if (h !== shown) { shown = h; hud.textContent = h; }
  };
  tl.progress(0); ui(); raf = requestAnimationFrame(loop); tl.play();
  return { destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); tl.kill(); sim.dispose(); renderer.dispose(); host.innerHTML = ""; } };
}
