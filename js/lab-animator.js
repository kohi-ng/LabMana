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
// Màu dung dịch (bão hòa hơn để nổi trên nền tối): Cu²⁺ xanh lam, MnO₄⁻ tím, Cr₂O₇²⁻ cam, CrO₄²⁻ vàng, Ni²⁺ lục, Co²⁺ hồng, Fe³⁺ vàng nâu...
const TINTS = { cuso4_5: 0x1d8cf0, kmno4: 0x8a1fb0, k2cr2o7: 0xff7d00, k2cro4: 0xffd400, niso4_6: 0x2fbf6a, cocl2_6: 0xf0457f,
  fecl3_6: 0xe8a317, feso4_7: 0x7fd39a, mohr: 0x8fd9a8, crcl3_6: 0x1f9a57, mnso4_h2o: 0xf7b7c9, pbno3_2: 0xd9eefc };
// Màu tinh thể chất rắn
const CRYSTAL = { cuso4_5: 0x2878d8, kmno4: 0x2a0a3a, k2cr2o7: 0xe8530a, k2cro4: 0xe0b000, niso4_6: 0x2a9a58, cocl2_6: 0xa81e55,
  fecl3_6: 0xb2701a, feso4_7: 0x86c897, mohr: 0x96d0a6, crcl3_6: 0x2a6a46, mnso4_h2o: 0xf4cfd9 };
const isColored = id => TINTS[id] != null;
const tintOf = id => TINTS[id] ?? 0xa9dcf7;
const WATER = 0xa4d6f5;

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
  // Định luật Beer–Lambert theo từng kênh màu: I = I0·exp(−σ·d). σ lấy từ phần màu bị hấp thụ (1 − màu) nên nước cất hơi ngả xanh ngọc khi dày,
  // CuSO₄ đậm dần thành xanh lam, KMnO₄ thành tím thẫm; d = độ sâu thẳng đứng dưới mặt thoáng (uSurf − y). Độ đục tăng theo d.
  const uSurf = { value: 0 }, uSig = { value: new THREE.Vector3(.2, .1, .05) }, uKap = { value: .05 }; let absK = .14;
  const mkLiq = clip => {
    const m = new THREE.MeshPhysicalMaterial({ color: liqColor, transparent: true, opacity: .8, roughness: .06, clearcoat: .6, clearcoatRoughness: .05,
      side: THREE.DoubleSide, clippingPlanes: clip ? [plane] : null, envMapIntensity: .6, emissive: liqColor, emissiveIntensity: .05, depthWrite: false });
    m.onBeforeCompile = sh => {
      sh.uniforms.uSurf = uSurf; sh.uniforms.uSig = uSig; sh.uniforms.uKap = uKap;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vWY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n vWY = (modelMatrix * vec4(transformed, 1.0)).y;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vWY; uniform float uSurf; uniform vec3 uSig; uniform float uKap;")
        .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n float dpt = max(uSurf - vWY, 0.0);\n gl_FragColor.rgb *= exp(-uSig * dpt) * 1.1;\n gl_FragColor.a = clamp(gl_FragColor.a + (1.0 - gl_FragColor.a) * (1.0 - exp(-uKap * dpt)), 0.0, 1.0);");
    };
    return m;
  };
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

  /* Chất lỏng chiếm phần bình nằm DƯỚI một mặt phẳng ngang trong thế giới. Với bình xoay bất kỳ, pháp tuyến "lên" trong hệ bình là n=(nx,ny,nz); mặt phẳng n·p=c.
   * Mỗi lát đĩa (bán kính r, cao y) bị cắt thành hình viên phân: S = r²·acos(−u/r) + u·√(r²−u²), u=(c−ny·y)/|n_xz|. Giải c sao cho Σ S·dy = V (chia đôi)
   * → thể tích được bảo toàn khi nghiêng, rót và đảo ngược; mức chất lỏng tại môi rót tính được chính xác. */
  const NS = 120, sdy = (H - floor) / NS, sy = [], sr = []; let rMax = 0;
  for (let i = 0; i < NS; i++) { const y = floor + (i + .5) * sdy, r = inner(y); sy.push(y); sr.push(r); rMax = Math.max(rMax, r); }
  const volBelow = (c, nx, ny, nz) => {
    const m = Math.hypot(nx, nz); let sum = 0;
    for (let i = 0; i < NS; i++) {
      const r = sr[i], y = sy[i]; let A;
      if (m < 1e-4) A = ny * y <= c ? Math.PI * r * r : 0;
      else { const u = (c - ny * y) / m; A = u >= r ? Math.PI * r * r : u <= -r ? 0 : r * r * Math.acos(-u / r) + u * Math.sqrt(r * r - u * u); }
      sum += A * sdy;
    }
    return sum;
  };
  const solveC = (V, nx, ny, nz) => {
    const m = Math.hypot(nx, nz); let lo = Math.min(ny * floor, ny * H) - rMax * m - 1e-3, hi = Math.max(ny * floor, ny * H) + rMax * m + 1e-3;
    for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (volBelow(mid, nx, ny, nz) < V) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  /** Góc nghiêng nhỏ nhất (quanh trục z, rót về phía +x) để mặt chất lỏng không vượt môi rót khi thể tích = f·V_ref */
  const tiltForLip = f => {
    const V = clamp(f, 0, 1.6) * vRef, RH = R(H); let lo = 0, hi = 1.75;
    const vol = th => volBelow(-Math.sin(th) * RH + Math.cos(th) * H, -Math.sin(th), Math.cos(th), 0);
    if (vol(0) <= V) return 0; if (vol(hi) > V) return hi;
    for (let it = 0; it < 26; it++) { const mid = (lo + hi) / 2; if (vol(mid) > V) lo = mid; else hi = mid; }
    return hi;
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
    group: g, H, R, inner, hOf, f: 0, floor, refY, tiltForLip, closed: false,
    setColor(c, op) { lm.color.set(c); sm.color.set(c); lm.emissive.set(c); sm.emissive.set(c); if (op != null) { lm.opacity = sm.opacity = op; }
      uSig.value.set(1 - lm.color.r, 1 - lm.color.g, 1 - lm.color.b).multiplyScalar(absK); },
    setAbsorb(k, kap) { absK = k; if (kap != null) uKap.value = kap; uSig.value.set(1 - lm.color.r, 1 - lm.color.g, 1 - lm.color.b).multiplyScalar(absK); },
    /** o: {vort, rip:{a,t}|null, slosh} */
    update(time, o = {}) {
      const show = v.f > .002; liquid.visible = surf.visible = show; if (!show) return;
      g.updateMatrixWorld(true);
      const e = g.matrixWorld.elements, nx = e[1], ny = e[5], nz = e[9], m = Math.hypot(nx, nz);
      let c = m < 1e-3 && ny > 0 ? ny * hOf(v.f) : solveC(clamp(v.f, 0, 1.6) * vRef, nx, ny, nz);
      if (!v.closed) c = Math.min(c, ny * H - R(H) * m - .02);       // tràn qua môi thấp nhất khi nghiêng (bình hở)
      plane.constant = c + e[13];                                     // mặt thoáng luôn nằm ngang theo trọng lực; thể tích bảo toàn
      uSurf.value = plane.constant;
      g.getWorldQuaternion(wq); const tiltA = Math.acos(clamp(ny, -1, 1));
      surf.visible = tiltA < .35 && ny > 0;
      const h = clamp(ny > .2 ? c / ny : floor, floor, H);
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

/** LCD cân điện tử: nền xanh lá nhạt có đèn nền, số lớn + đơn vị nhỏ + chấm ổn định */
function lcdCanvas() {
  const cv = document.createElement("canvas"); cv.width = 384; cv.height = 128;
  const ctx = cv.getContext("2d"), tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4; let last = null;
  return { tex, draw(text, stable = true) {
    const key = text + stable; if (key === last) return; last = key;
    const g = ctx.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, "#c4d8ae"); g.addColorStop(1, "#a9c18f");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 384, 128);
    const i = text.lastIndexOf(" "), num = i < 0 ? text : text.slice(0, i), unit = i < 0 ? "" : text.slice(i + 1);
    ctx.fillStyle = "#17230f"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    let fs = 78; ctx.font = `bold ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    while (ctx.measureText(num).width > 270 && fs > 34) { fs -= 4; ctx.font = `bold ${fs}px ui-monospace, Menlo, Consolas, monospace`; }
    ctx.fillText(num, 322, 70);
    ctx.font = "bold 40px ui-monospace, Menlo, Consolas, monospace"; ctx.textAlign = "left"; ctx.fillText(unit, 332, 84);
    ctx.fillStyle = stable ? "#17230f" : "rgba(23,35,15,.25)"; ctx.beginPath(); ctx.arc(26, 26, 9, 0, 6.3); ctx.fill();
    ctx.font = "bold 22px ui-monospace, Menlo, monospace"; ctx.textAlign = "left"; ctx.fillText("STABLE", 42, 28);
    tex.needsUpdate = true;
  } };
}

/* ------------------------------ Chữ in lên dụng cụ (decal cong bám thành) ------------------------------ */
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
}
const decalMat = tex => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
/** Vá hình trụ bán kính R, cao y0..y1, rộng `len` rad, tâm lệch theta0 (0 = hướng +z, về phía camera) */
function cylDecal(R, y0, y1, len, theta0, tex) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, y1 - y0, 40, 1, true, theta0 - len / 2, len), decalMat(tex));
  m.position.y = (y0 + y1) / 2; m.renderOrder = 5; return m;
}
/** Vá hình cầu (bầu bình định mức): tâm cầu ở cy, vá cao dy so với xích đạo, rộng w × cao h (cm) */
function sphDecal(R, cy, dy, w, h, tex) {
  const pl = w / R, tl = h / R, tc = Math.PI / 2 - Math.asin(clamp(dy / R, -.95, .95));
  const m = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 24, Math.PI / 2 - pl / 2, pl, tc - tl / 2, tl), decalMat(tex));
  m.position.y = cy; m.renderOrder = 5; return m;
}
function roundedBox(w, d, h, r, mat) {  // hộp bo góc (w × d trên mặt sàn, cao h), đáy ở y=0
  const sh = new THREE.Shape(), x = -w / 2, y = -d / 2;
  sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + d - r); sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  sh.lineTo(x + r, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(sh, { depth: h - .24, bevelEnabled: true, bevelThickness: .12, bevelSize: .12, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = .12; return m;
}
const KIND_BAND = { acid: "#d97706", base: "#2563eb", oxidizer: "#7c3aed", toxic: "#dc2626", salt: "#16a34a", unknown: "#64748b" };
/** Nhãn dán trên chai/lọ: dải màu theo nhóm nguy cơ, công thức, nồng độ/độ tinh khiết */
function bottleLabel(formula, name, sub, kind) {
  return canvasTex(512, 300, (x, w, h) => {
    x.fillStyle = "#fbfbf8"; x.fillRect(0, 0, w, h);
    x.fillStyle = KIND_BAND[kind] || KIND_BAND.unknown; x.fillRect(0, 0, w, 56);
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
    let nf = 30; x.font = `bold ${nf}px Inter, sans-serif`; const nm = name.toUpperCase();
    while (x.measureText(nm).width > w - 30 && nf > 14) { nf -= 2; x.font = `bold ${nf}px Inter, sans-serif`; }
    x.fillText(nm, w / 2, 29);
    let fs = 92; x.fillStyle = "#0b1220"; x.font = `800 ${fs}px Inter, sans-serif`;
    while (x.measureText(formula).width > w - 50 && fs > 30) { fs -= 4; x.font = `800 ${fs}px Inter, sans-serif`; }
    x.fillText(formula, w / 2, 148);
    x.fillStyle = "#475569"; x.font = "600 34px Inter, sans-serif"; x.fillText(sub, w / 2, 236);
    x.strokeStyle = "#cbd5e1"; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
  });
}

/* ====================================================================================================
 * createSim: dựng cảnh + timeline (không cần DOM / renderer → kiểm thử được)
 * ================================================================================================== */
export function createSim(anim, lib) {
  THREE = lib.THREE; gsap = lib.gsap;
  if (THREE.ColorManagement && "legacyMode" in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;  // hex sRGB → tuyến tính đúng → màu sâu, bão hòa, không bị bạc
  const A = anim, mode = A.mode, solidM = mode.startsWith("solid"), volM = mode.endsWith("vol");
  const FV = A.finalVolume, sa = A.soluteAmount, wa = A.solventAmount, F = A.soluteFormula, exo = !!A.exothermic;
  // Dung tích cốc chọn theo bài toán (cốc chuẩn thường dùng) — vạch chia in men và mức chất lỏng khớp thể tích thật: V = f·dung tích
  const niceCap = v => [25, 50, 100, 150, 250, 400, 500, 600, 1000, 2000, 5000].find(c => c >= v) || Math.ceil(v / 1000) * 1000;
  const beakerCap = mode === "solid-vol" ? niceCap(FV) : mode === "dilute-vol" ? 250 : niceCap(1.25 * (A.finalMass ?? 100));
  const scene = new THREE.Scene();
  // Nền studio tối (độ tương phản cao) để kính viền sáng và màu dung dịch nổi bật
  scene.background = canvasTex(4, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#070b12"); g.addColorStop(.55, "#17202d"); g.addColorStop(1, "#2a3647"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  scene.fog = new THREE.Fog(0x131b27, 70, 190);
  const camera = new THREE.PerspectiveCamera(32, 16 / 10, .5, 400);
  scene.add(new THREE.HemisphereLight(0xdbe6f6, 0x1b2331, .35));
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.15); sun.position.set(22, 42, 28); scene.add(sun);              // đèn chính (ấm)
  const rim = new THREE.DirectionalLight(0x86b4ff, 1.25); rim.position.set(-34, 26, -30); scene.add(rim);          // đèn viền (lạnh) → viền sáng trên kính
  const fill = new THREE.DirectionalLight(0xffffff, .3); fill.position.set(-26, 12, 30); scene.add(fill);

  const std = (c, r = .5, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xaac4dc, roughness: .03, metalness: 0, transparent: true, opacity: .035, side: THREE.DoubleSide,
    depthWrite: false, envMapIntensity: .5, clearcoat: .5, clearcoatRoughness: .03, specularIntensity: .45 });
  glassMat.onBeforeCompile = sh => { // viền phản quang Fresnel chỉ ở mép thành thủy tinh (giữa thân trong suốt để thấy rõ màu dung dịch)
    sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>",
      "#include <dithering_fragment>\n float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.4); gl_FragColor.rgb += vec3(0.55, 0.7, 0.9) * fr * 0.4; gl_FragColor.a = clamp(gl_FragColor.a + fr * 0.55, 0.0, 1.0);");
  };
  const colored = isColored(A.chemId), stock = tintOf(A.chemId);
  const WOP = .26, LIQ_OP = colored ? .62 : .26;   // độ đục nền (độ đục thực tế tăng theo độ sâu trong shader): nước/dung dịch không màu trong suốt, dung dịch có màu đặc hơn

  // Sàn + bóng mờ
  // Mặt bàn tối, mờ, có vệt sáng ở giữa như đèn chiếu → bóng đổ và đáy kính đọc rõ
  const floorTex = canvasTex(256, 256, (x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2); g.addColorStop(0, "#2b3646"); g.addColorStop(.45, "#161e2a"); g.addColorStop(1, "#070a10"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ map: floorTex, roughness: .5, metalness: .15 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const blobTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const blobs = [];
  const blob = (obj, size, base = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = .03; scene.add(m); blobs.push({ obj, m, size, base }); };

  /* ---- Cân điện tử ---- */
  const bal = (() => {
    const g = new THREE.Group(), L = lcdCanvas();
    const bodyM = std(0xe3e8ee, .3, .12), dark = std(0x182231, .4, .3), steel = std(0xd2d9e2, .2, .95);
    const body = roundedBox(9.6, 7.2, 1.62, .9, bodyM);
    const deck = roundedBox(7.6, 4.6, .1, .7, dark); deck.position.set(0, 1.62, 0);   // tấm đệm tối quanh đĩa cân
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.55, .7, .16, 24), steel); post.position.set(0, 1.78, 0);
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, .16, 64), steel); pan.position.set(0, 1.69, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.74, .05, 8, 64), steel); ring.rotation.x = Math.PI / 2; ring.position.set(0, 1.77, 0);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(4.9, 1.45, .12), std(0x0f1824, .35, .3)); bez.position.set(0, .84, 3.76);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.15), new THREE.MeshBasicMaterial({ map: L.tex, toneMapped: false })); scr.position.set(0, .84, 3.83);
    L.draw("0,000 g");
    const btn = (x, c) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .16, 20), std(c, .4, .2)); b.rotation.x = Math.PI / 2; b.position.set(x, .84, 3.8); return b; };
    const led = new THREE.Mesh(new THREE.SphereGeometry(.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x4ade80, toneMapped: false })); led.position.set(-4.05, 1.32, 3.78);
    g.add(body, deck, post, pan, ring, bez, scr, btn(3.35, 0x475569), btn(4.05, 0xdc2626), led);
    for (const [fx, fz] of [[-4, -2.9], [4, -2.9], [-4, 2.9], [4, 2.9]]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(.35, .4, .14, 12), dark); f.position.set(fx, .02, fz); g.add(f); }
    scene.add(g); return { group: g, panY: 1.78, draw: L.draw, tex: L.tex };
  })();
  const maxRead = A.finalMass ?? sa, dec = maxRead < 1 ? 4 : maxRead < 100 ? 3 : maxRead < 1000 ? 2 : 1;
  const balText = v => `${(+v).toLocaleString("vi-VN", { minimumFractionDigits: dec, maximumFractionDigits: dec })} g`;
  const needBal = mode !== "dilute-vol", balX = mode === "solid-vol" ? -13 : 0;
  bal.group.visible = needBal; bal.group.position.x = balX; bal.draw(balText(0)); if (needBal) blob(bal.group, 14);
  const PAN = bal.panY;

  /* ---- Dụng cụ thủy tinh ---- */
  const beaker = makeVessel({ H: 9, R: () => 3.3, wall: .2, floor: .45, refY: 7.6, ticks: 0, glassMat, liqColor: WATER });
  { // thang chia độ in men trắng: 50…250 mL (f=1 ứng với vạch 250 mL) + vạch phụ
    const NT = 5, W = 200, Hh = 600, tex = canvasTex(W, Hh, (x, w, h) => {
      x.fillStyle = "#f8fafc"; x.strokeStyle = "#f8fafc"; x.textBaseline = "middle"; x.textAlign = "right";
      const yy = hh => (1 - hh / 9) * h;
      for (let i = 1; i <= NT; i++) {
        const y = yy(beaker.hOf(i / NT)); x.lineWidth = 3; x.beginPath(); x.moveTo(w * .56, y); x.lineTo(w * .92, y); x.stroke();
        x.font = "bold 26px Inter, sans-serif"; x.fillText(String(Math.round(i * beakerCap / NT)), w * .5, y);
        const ym = yy(beaker.hOf((i - .5) / NT)); x.lineWidth = 2; x.beginPath(); x.moveTo(w * .56, ym); x.lineTo(w * .74, ym); x.stroke();
      }
      x.textAlign = "left"; x.font = "bold 24px Inter, sans-serif"; x.fillText(`${beakerCap} mL`, w * .12, yy(8.45));
    });
    beaker.group.add(cylDecal(3.3 + .03, 0, 9, 1.05, .62, tex));
  }
  const flaskR = y => { const s = y < 8 ? 4.5 * Math.sqrt(Math.max(0, 1 - ((y - 4.7) / 4.5) ** 2)) : 0;
    const sh = y >= 8 && y < 11 ? lerp(2.83, 1.0, sstep(8, 11, y)) : 0; return y < 1 ? Math.max(s, 2.4) : y < 8 ? s : y < 11 ? sh : y > 15.4 ? 1.0 + .18 * sstep(15.4, 16, y) : 1.0; };
  const flask = makeVessel({ H: 16, R: flaskR, wall: .18, floor: .4, refY: 13, glassMat, liqColor: WATER });
  { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.03, .04, 8, 64), new THREE.MeshBasicMaterial({ color: 0xff4a3d, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 13; flask.group.add(ring); }
  const bottleR = y => y < 7 ? 2.6 : y < 9 ? lerp(2.6, 1.1, sstep(7, 9, y)) : 1.1;
  const stockV = makeVessel({ H: 10.5, R: bottleR, wall: .15, floor: .35, refY: 6.5, glassMat, liqColor: stock });
  stockV.setColor(stock, colored ? .7 : .3);

  beaker.setColor(WATER, WOP); flask.setColor(WATER, WOP);
  { const ab = colored ? .36 : .14, kp = colored ? .16 : .05; [beaker, flask, stockV].forEach(v => v.setAbsorb(ab, kp)); }
  const stockCap = new THREE.Group(); { const c = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.32, 1.3, 40), std(0xf1f5f9, .3, .1)); c.position.y = 10.5 + .65;
    for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2, r = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.2, .1), std(0xcbd5e1, .5)); r.position.set(Math.cos(a) * 1.33, 0, Math.sin(a) * 1.33); r.rotation.y = -a; c.add(r); }
    stockCap.add(c); }
  scene.add(stockCap); stockCap.position.set(-10, 0, 0);
  const bx = 0, BY0 = !volM ? PAN : 0, SX0 = -10;
  const FX = mode === "solid-vol" ? 11 : 3, SX = -10;
  const fp = new THREE.Group(); flask.group.position.y = -8; fp.add(flask.group); // trục xoay bình ở tâm bầu
  scene.add(beaker.group, fp, stockV.group);
  beaker.group.visible = solidM || !volM; fp.visible = volM; stockV.group.visible = !solidM;
  blob(beaker.group, 9, BY0); if (volM) blob(fp, 12, 8); if (!solidM) blob(stockV.group, 8);
  { // nhãn dán trên chai dung dịch gốc & bình định mức
    const lbl = (text, w, h) => { const c = document.createElement("canvas"); c.width = 256; c.height = Math.round(256 * h / w); const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#0f172a"; x.font = "bold 54px Inter, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(text, 128, c.height / 2); return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })); };
    // nhãn chai dung dịch gốc (dải màu theo nhóm, công thức, nồng độ/khối lượng riêng) bám sát thân chai
    const cm = CHEMS[A.chemId] || {}, sub = cm.assay ? `${String(cm.assay).replace(".", ",")}% · d ${String(cm.density).replace(".", ",")} g/mL` : "dung dịch gốc";
    stockV.group.add(cylDecal(2.6 + .03, 1.0, 5.6, 1.55, 0, bottleLabel(F, cm.name || "", sub, cm.kind)));
    // bình định mức: chữ in men (dung tích, nhiệt độ hiệu chuẩn) + nhãn dán giấy ghi tên và nồng độ
    const print = canvasTex(360, 200, (x, w, h) => { x.fillStyle = "#f8fafc"; x.textAlign = "center"; x.textBaseline = "middle";
      x.font = "800 64px Inter, sans-serif"; x.fillText(fmtVol(FV ?? 0), w / 2, 62); x.font = "600 34px Inter, sans-serif"; x.fillText("20 °C  ·  CLASS A", w / 2, 128); });
    flask.group.add(sphDecal(4.5 + .03, 4.7, 2.5, 3.9, 2.1, print));
    flask.group.add(sphDecal(4.5 + .035, 4.7, -.9, 3.9, 2.7, bottleLabel(F, "", A.targetText, (CHEMS[A.chemId] || {}).kind)));
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
  if (tool) { tool.setAbsorb(colored ? .36 : .14, colored ? .16 : .05); tool.setColor(stock, colored ? .7 : .3); scene.add(tool.group); tool.group.visible = false; }

  /* ---- Chai tia nước cất (nhựa PE mờ, nắp xanh có khía, vòi thuôn) ---- */
  const wash = new THREE.Group(); {
    const V2 = (x, y) => new THREE.Vector2(x, y);
    const bodyPts = [V2(0, 0), V2(1.05, 0), V2(1.38, .22), V2(1.5, .7), V2(1.5, 5.6), V2(1.4, 6.5), V2(1.0, 7.2), V2(.62, 7.7), V2(.55, 8.3)];
    const pe = new THREE.MeshPhysicalMaterial({ color: 0xf1f6fc, roughness: .42, transparent: true, opacity: .72, clearcoat: .6, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    const b = new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 48), pe);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.62, .66, .75, 32), std(0x1d6fe8, .35, .1)); cap.position.y = 8.55;
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r = new THREE.Mesh(new THREE.BoxGeometry(.06, .62, .07), std(0x1558c0, .5)); r.position.set(Math.cos(a) * .66, 0, Math.sin(a) * .66); r.rotation.y = -a; cap.add(r); }
    const nz = new THREE.Mesh(new THREE.CylinderGeometry(.1, .24, 1.6, 16), std(0x1d6fe8, .35, .1)); nz.position.y = 9.7;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(.06, .1, .3, 12), std(0x0f172a, .5)); tip.position.y = 10.5;
    wash.add(b, cap, nz, tip); scene.add(wash); wash.visible = false; }
  const NOZ = new THREE.Vector3(0, 10.5, 0);
  const washPose = (tip, tilt) => { const o = NOZ.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), -tilt); return { x: tip.x - o.x, y: tip.y - o.y }; };
  const WREST = { x: 20, y: 0 };

  /* ---- Lọ chất rắn + thuyền cân + tinh thể ---- */
  const solidBottle = new THREE.Group(); {
    const cm = CHEMS[A.chemId] || {};
    const b = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.3, 5.5, 48), new THREE.MeshPhysicalMaterial({ color: 0xf3f6fa, roughness: .35, clearcoat: .5 })); b.position.y = 2.75;
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, .5, 48), std(0xf3f6fa, .35)); sh.position.y = 5.7;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 1.1, 48), std(0x1d4ed8, .35, .1)); c.position.y = 6.5;
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, r = new THREE.Mesh(new THREE.BoxGeometry(.09, 1.0, .12), std(0x1e40af, .5)); r.position.set(Math.cos(a) * 1.97, 0, Math.sin(a) * 1.97); r.rotation.y = -a; c.add(r); }
    const jarCapG = new THREE.Group(); jarCapG.add(c); solidBottle.userData.cap = jarCapG;
    solidBottle.add(b, sh, jarCapG, cylDecal(2.3 + .03, .9, 4.9, 1.6, 0, bottleLabel(F, cm.name || "", cm.purity ? `độ tinh khiết ${String(cm.purity).replace(".", ",")}%` : "chất rắn", cm.kind)));
  }
  solidBottle.position.set(solidM && volM ? balX - 8.5 : -9, 0, -.8); solidBottle.visible = solidM; scene.add(solidBottle);
  const boat = new THREE.Mesh(new THREE.SphereGeometry(1.5, 28, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xcfe0f2, roughness: .32, clearcoat: .6, side: THREE.DoubleSide }));
  { const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, .05, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8f1fb, roughness: .3 })); rim.rotation.x = Math.PI / 2; boat.add(rim); }
  boat.scale.set(1.6, .5, 1.1); boat.visible = solidM; scene.add(boat);
  const NC = 42, cr = rng(7), crystals = [], cgeo = [new THREE.IcosahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.DodecahedronGeometry(1, 0)];
  const cmat = new THREE.MeshPhysicalMaterial({ color: CRYSTAL[A.chemId] ?? 0xf6f8fb, roughness: .18, metalness: .05, clearcoat: 1, clearcoatRoughness: .08, envMapIntensity: 1.6 });
  for (let i = 0; i < NC; i++) {
    const m = new THREE.Mesh(cgeo[i % 3], cmat); m.visible = false; scene.add(m);
    crystals.push({ m, a: cr() * 6.28, rr: cr(), s: .16 + cr() * .2, d: cr() * .55, rot: cr() * 6, bx: (cr() - .5) * 1.8, bz: (cr() - .5) * 1.1, ph: cr() });
  }

  /* ---- Thìa xúc inox (đầu thìa tại gốc tọa độ, cán chếch lên phải) + tinh thể trên thìa ---- */
  const spat = new THREE.Group(); {
    const steel = new THREE.MeshStandardMaterial({ color: 0xd9e0e8, roughness: .18, metalness: 1, envMapIntensity: 1.4 });
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), steel); bowl.scale.set(1.15, .13, .72); bowl.position.set(.2, 0, 0);
    const L = Math.hypot(11.1, 4.4), h = new THREE.Mesh(new THREE.CylinderGeometry(.1, .13, L, 12), steel); h.position.set(6.4, 2.45, 0); h.rotation.z = Math.atan2(4.4, 11.1) - Math.PI / 2;
    spat.add(bowl, h);
  }
  spat.visible = false; scene.add(spat);
  const spC = Array.from({ length: 7 }, (_, i) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), cmat); m.scale.setScalar(.2 + (i % 3) * .05); m.position.set(-.4 + (i % 4) * .3, .2 + (i > 3 ? .18 : 0), (i % 2 ? .12 : -.12)); m.visible = false; spat.add(m); return m; });

  /* ---- Đũa thủy tinh, nút bình, hơi nhiệt ---- */
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 1, 14), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: .45, roughness: .05, clearcoat: 1, envMapIntensity: 1.5 }));
  rod.visible = false; scene.add(rod);
  const Y = new THREE.Vector3(0, 1, 0);
  const setRod = (a, b) => { const d = b.clone().sub(a), len = d.length(); rod.position.copy(a).addScaledVector(d, .5); rod.scale.set(1, len, 1); rod.quaternion.setFromUnitVectors(Y, d.normalize()); rod.visible = true; };
  const stopper = new THREE.Group(); { const c = new THREE.Mesh(new THREE.CylinderGeometry(1.1, .8, 2.2, 24), new THREE.MeshPhysicalMaterial({ color: 0xe0f2fe, transparent: true, opacity: .6, roughness: .1, clearcoat: 1 }));
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, .5, 24), new THREE.MeshPhysicalMaterial({ color: 0xe0f2fe, transparent: true, opacity: .6, roughness: .1 })); t.position.y = 1.3; stopper.add(c, t); }
  stopper.visible = false; fp.add(stopper);
  const vapors = []; const puffTex = canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2); g.addColorStop(0, "rgba(255,255,255,.85)"); g.addColorStop(.45, "rgba(235,242,252,.35)"); g.addColorStop(1, "rgba(235,242,252,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  for (let i = 0; i < 22; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false, fog: false })); m.visible = false; scene.add(m); vapors.push(m); }

  /* ---- Dòng chảy, giọt định mức, vi giọt ---- */
  const jetMat = new THREE.MeshPhysicalMaterial({ color: WATER, transparent: true, opacity: .75, roughness: .05, clearcoat: 1 });
  const pourMat = jetMat.clone();
  const jet = makeStream(jetMat), pour = makeStream(pourMat); scene.add(jet, pour);
  const drop = new THREE.Mesh(teardropGeo(), jetMat); drop.visible = false; scene.add(drop);
  const spl = Array.from({ length: 5 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), jetMat); m.visible = false; scene.add(m); return m; });
  const wd = Array.from({ length: 6 }, (_, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.07 + (i % 3) * .015, 8, 6), jetMat); m.visible = false; scene.add(m); return m; });

  /* ---------------------------------- Trạng thái số P (duy nhất) ---------------------------------- */
  const P = { bX: bx, bY: BY0, bTilt: 0, bFill: 0, fFill: 0, fRot: 0, fLift: 0, sFill: .85, sX: SX, sY: 0, sTilt: 0,
    tFill: 0, tX: SX, tY: 26, tTilt: 0, tOn: 0, wOn: 0, wX: WREST.x, wY: 0, wTilt: 0,
    boatX: -13, boatY: PAN + 8, boatTilt: 0, boatOn: 0, boatLoad: 0, fall: 0, dissolve: 0,
    lcd: 0, tint: 0, heat: 0, heatV: 0, vort: 0, stir: 0, slosh: 0, rodMode: 0, rodT: 0,
    jH: 0, jT: 0, jTgt: 0, pH: 0, pT: 0, pSrc: 0, dropT: 0, dropOn: 0, wallT: 0, stopY: 30, mark: 0,
    wZ: 0, fZ: 0, lkB: 0, lkS: 0, lkT: 0, lbX: 0, lbY: 0, lsX: 0, lsY: 0, ltX: 0, ltY: 0,       // khóa rót: mực chất lỏng luôn ở môi rót
    jarCap: 0, sCap: 0, spX: 0, spY: 0, spR: 0, spOn: 0, spLoad: 0, drop: 0, dropX: 0, dropY: 0, pan: 1 };  // thìa xúc, nắp lọ, tinh thể rơi trực tiếp

  /* ---------------------------------- Timeline ---------------------------------- */
  const tl = gsap.timeline({ paused: true }), steps = [];
  const seg = (at, dur, spec, ease = "power2.inOut") => {
    const from = {}, to = {}; for (const k in spec) { from[k] = spec[k][0]; to[k] = spec[k][1]; }
    tl.fromTo(P, from, { ...to, duration: Math.max(dur, .001), ease, immediateRender: false }, at);
  };
  const sw = (at, k, a, b) => seg(at, .001, { [k]: [a, b] });
  let cur = 0;
  /** Cú máy: f = các vật cần giữ trong khung; a = [θ đầu, φ đầu, θ cuối, φ cuối] (quỹ đạo chậm quanh cảnh); m = độ rộng lề khung */
  const SH = (f, a0, p0, a1, p1, m = 1.22) => ({ f, a: [a0, p0, a1, p1], m });
  const step = (title, cap, dur, shot, fn) => { steps.push({ t: cur, dur, title, cap, shot }); fn(cur, dur); cur += dur; };
  const ZAX = new THREE.Vector3(0, 0, 1);
  const lipLocal = v => new THREE.Vector3(v.R(v.H), v.H, 0);
  const poseFromLip = (v, lipT, tilt) => { const o = lipLocal(v).applyAxisAngle(ZAX, -tilt); return { x: lipT.x - o.x, y: lipT.y - o.y }; };
  const JT = 2.95;                                   // chai tia gần như thẳng đứng, vòi hướng xuống
  const WR = mode === "solid-vol" ? { x: 6, z: -8 } : { x: 20, z: 0 };   // chỗ đặt chai tia (solid-vol: sau lưng, giữa cốc và bình để không phải vượt qua bình)
  const yL = 19;                                      // độ cao nhấc chai tia để vượt mọi dụng cụ
  Object.assign(P, { wOn: 1, wX: WR.x, wY: 0, wZ: WR.z, wTilt: 0 });
  const mb = 1.213;                                   // khối lượng thuyền cân (g): bỏ thuyền ra khỏi đĩa cân thì cân báo −1,213 g (đã Tare cả thuyền)

  /** Chai tia: nhấc lên cao → sang vị trí → mở tia → châm → ngắt tia → (nếu !keep) rút về. Tổng thời gian = WD(fill, keep) */
  const WD0 = fill => fill + 1.85;
  const WD = (fill, keep = false) => fill + 1.85 + (keep ? 0 : 1.55);
  const DMD = WD0(3.2) + .7 + 3 * 1.2 + .5 + 1.55;   // thời lượng cả bước định mức
  const washFill = (t, fill, tip, tgt, key, f0, f1, keep = false) => {
    const end = washPose(tip, JT), a = t + 1.25;
    seg(t, .55, { wY: [0, yL], wTilt: [0, .6] });
    seg(t + .55, .7, { wX: [WR.x, end.x], wZ: [WR.z, tip.z], wY: [yL, end.y], wTilt: [.6, JT] });
    sw(a, "jTgt", tgt, tgt); seg(a, .45, { jH: [0, 1], jT: [0, 0] }, "none");
    seg(a + .1, fill, { [key]: [f0, f1] }, "none");
    seg(t + 1.35 + fill, .45, { jT: [0, 1] }, "none"); sw(t + 1.82 + fill, "jH", 1, 0);
    if (!keep) {
      const r = t + 1.85 + fill;
      seg(r, .4, { wY: [end.y, yL], wTilt: [JT, .6] }); seg(r + .4, .6, { wX: [end.x, WR.x], wZ: [tip.z, WR.z] }); seg(r + 1, .55, { wY: [yL, 0], wTilt: [.6, 0] });
    }
    return end;
  };
  const stirSeq = (t, dur, vessel) => { // đũa khuấy + phễu xoáy + hòa tan + đổi màu + (nếu tỏa nhiệt) hơi bốc lên
    seg(t, .8, { rodT: [0, 1] }); sw(t, "rodMode", 0, 1);
    seg(t + .4, dur - .9, { stir: [0, 6.2 * (dur - .9)] }, "none");
    seg(t + .5, 1, { vort: [0, 1] }); seg(t + dur - 1.1, 1, { vort: [1, 0] });
    seg(t + dur - .7, .6, { rodT: [1, 0] }); sw(t + dur - .05, "rodMode", 1, 0);
    if (exo) { sw(t, "heatV", vessel, vessel); seg(t + .6, dur - .6, { heat: [0, 1] }, "none"); }
  };
  /** Đậy nút, đưa bình ra phía trước (không chạm vật khác) rồi đảo ngược thật 180° — bọt khí chạy ngược lên theo đúng bảo toàn thể tích */
  const FLIP_DUR = 10.8;
  const flipSeq = t => {
    seg(t, 1, { stopY: [30, 16.9] }, "power2.in"); seg(t, 1, { heat: [1, 0] });
    seg(t + 1.2, 1.1, { fZ: [0, 8], fLift: [0, 6.5] });
    for (let k = 0; k < 2; k++) {
      const s = t + 2.5 + k * 3.4;
      seg(s, 1.3, { fRot: [0, Math.PI] }, "power2.inOut"); seg(s + 1.7, 1.3, { fRot: [Math.PI, Math.PI * 2] }, "power2.inOut"); sw(s + 3.02, "fRot", Math.PI * 2, 0);
    }
    seg(t + 9.5, 1.1, { fZ: [8, 0], fLift: [6.5, 0] });
  };
  /** Nắp lọ/chai: nhấc lên, vòng sang bên, nằm úp trên mặt bàn (q: 0 đậy → 1 mở) */
  const cap = (t, k, a, b, d = .8) => seg(t, d, { [k]: [a, b] }, "power2.inOut");
  /** Thìa xúc chất rắn từ lọ → mục tiêu. kind "boat": tinh thể hiện trên thuyền cân; "beaker": tinh thể rơi vào cốc. Trả về thời gian kết thúc */
  const jx = solidBottle.position.x, jz = solidBottle.position.z;
  const scoopDur = n => 1.6 + n * 2.5;
  const scoops = (t, kind, tx, ty, read0, read1, drop0 = 0) => {
    const N = 3, per = 2.5, fr = [.42, .78, 1];
    Object.assign(P, { dropX: tx - .5, dropY: ty });
    cap(t, "jarCap", 0, 1, .9); sw(t, "spOn", 0, 1);
    const K0 = { x: jx + 3.4, y: 12.5 }, K1 = { x: jx + .2, y: 5.6 }, K2 = { x: jx + .6, y: 10.4 }, K3 = { x: tx - .5, y: ty };
    seg(t, .01, { spX: [K0.x, K0.x], spY: [K0.y, K0.y], spR: [0, 0] });
    for (let k = 0; k < N; k++) {
      const s = t + .9 + k * per;
      seg(s, .45, { spX: [K0.x, K1.x], spY: [K0.y, K1.y], spR: [0, 0] });                       // đưa đầu thìa vào lọ
      seg(s + .45, .45, { spX: [K1.x, K2.x], spY: [K1.y, K2.y] }); seg(s + .6, .3, { spLoad: [0, 1] }, "none");   // xúc lên
      seg(s + .95, .75, { spX: [K2.x, K3.x], spY: [K2.y, K3.y], spR: [0, 0] });                  // đưa sang mục tiêu
      seg(s + 1.7, .3, { spR: [0, -.5] });                                                        // nghiêng thìa
      if (kind === "boat") { seg(s + 1.85, .3, { spLoad: [1, 0], boatLoad: [k / N, (k + 1) / N] }, "none"); seg(s + 1.85, .45, { lcd: [read0 + (read1 - read0) * (k ? fr[k - 1] : 0), read0 + (read1 - read0) * fr[k]] }, "power1.out"); }
      else { seg(s + 1.7, .3, { spLoad: [1, 0] }, "none"); seg(s + 1.75, .55, { drop: [drop0 + k, drop0 + k + 1] }, "none"); seg(s + 2.0, .45, { lcd: [read0 + (read1 - read0) * (k ? fr[k - 1] : 0), read0 + (read1 - read0) * fr[k]] }, "power1.out"); }
      seg(s + 2.05, .45, { spX: [K3.x, K0.x], spY: [K3.y, K0.y], spR: [-.5, 0] });                // quay lại
    }
    const e = t + .9 + N * per;
    seg(e, .6, { spY: [K0.y, 26] }); sw(e + .62, "spOn", 1, 0); cap(e, "jarCap", 1, 0, .9);
    return e;
  };

  // —— nhãn mục tiêu ——
  const Mv = fmtMass, Vv = fmtVol;
  const fW = (m, c) => clamp(m / c, 0, 1);                      // mức chất lỏng trong cốc: thể tích(mL)/dung tích cốc(mL)
  const BC = beakerCap, rho = 1;                                 // nước cất ≈ 1 g/mL

  // trạng thái ở t=0 phải trùng điểm xuất phát của bước 1 (thuyền/cốc đang lơ lửng phía trên đĩa cân rồi hạ xuống) → không giật khung hình đầu
  if (mode === "solid-vol") Object.assign(P, { boatOn: 1, boatX: balX, boatY: PAN + 9 });
  else if (mode !== "dilute-vol") P.bY = PAN + 9;
  if (mode === "solid-vol") {
    const fw = fW(.6 * FV, BC), pLip = { x: FX - 3.2, y: 18.4 }, tipB = new THREE.Vector3(bx - .8, 14, 0);
    Object.assign(P, { lbX: pLip.x, lbY: pLip.y });
    const th0 = beaker.tiltForLip(fw) + .05, thE = beaker.tiltForLip(.03), p0 = poseFromLip(beaker, pLip, th0), pE = poseFromLip(beaker, pLip, thE);
    step("Cân bì", "Đặt thuyền cân lên đĩa cân điện tử, đợi số ổn định rồi nhấn Tare để cân bì.", 4.4, SH(["bal", "boat", "jar"], .55, 1.22, .38, 1.18), t => {
      seg(t, .9, { boatOn: [1, 1], boatX: [balX, balX], boatY: [PAN + 9, PAN + .8] }, "power2.in");
      seg(t + .95, .5, { lcd: [0, mb] }, "none"); seg(t + 2.3, .3, { lcd: [mb, 0] }, "none"); });
    step("Xúc chất rắn", `Mở nắp lọ, dùng thìa xúc ${F} cho từ từ vào thuyền cân đến khi cân hiển thị ${Mv(sa)} (đã hiệu chỉnh độ tinh khiết).`, scoopDur(3) + 1.2, SH(["bal", "jar", "spat", "boat"], .45, 1.2, .3, 1.15), t => {
      scoops(t, "boat", balX, PAN + 4.2, 0, sa); });
    step("Nước vào cốc", "Cho khoảng 60–70% thể tích dung môi (nước cất) vào cốc, tia nước chảy dọc thành cốc.", WD(2.8), SH(["beaker", "wash"], .35, 1.22, .22, 1.18), t => {
      washFill(t, 2.8, tipB, 0, "bFill", 0, fw); });
    step("Đổ chất rắn", "Chuyển chất rắn từ thuyền cân vào cốc nước (nhấc thuyền khỏi cân → cân báo âm vì đã Tare cả thuyền).", 8.1, SH(["bal", "boat", "beaker"], .4, 1.2, .25, 1.12), t => {
      seg(t, .9, { boatY: [PAN + .8, 13.6] }); seg(t + .3, .5, { lcd: [sa, -mb] }, "none");
      seg(t + 1.0, 1.4, { boatX: [balX, bx + 1.3] }); seg(t + 2.5, .9, { boatTilt: [0, -.9] });
      seg(t + 3.5, 2.0, { fall: [0, 1] }, "none"); seg(t + 5.6, .6, { boatTilt: [-.9, 0] });
      seg(t + 6.2, 1.3, { boatX: [bx + 1.3, balX] }); seg(t + 7.5, .5, { boatY: [13.6, PAN + .8] }); sw(t + 7.9, "lcd", -mb, 0); });
    step("Khuấy tan", `Khuấy bằng đũa thủy tinh đến tan hoàn toàn${exo ? "; dung dịch tỏa nhiệt — chờ nguội về nhiệt độ phòng" : ""}.`, 5.2, SH(["beaker", "rod"], .3, 1.17, .15, 1.1, 1.3), t => {
      stirSeq(t, 5.2, 0); seg(t + .6, 3.6, { dissolve: [0, 1], tint: [0, 1] }, "none"); });
    step("Rót sang bình", `Rót dọc đũa thủy tinh vào bình định mức ${Vv(FV)}; tráng cốc 2–3 lần, gom nước tráng vào bình.`, 9.4, SH(["beaker", "flask"], .55, 1.15, .3, 1.2, 1.15), t => {
      seg(t, 1.6, { bX: [bx, p0.x], bY: [BY0, p0.y], bTilt: [0, th0] }); sw(t + 1.2, "rodMode", 0, 2); sw(t + 1.2, "pSrc", 0, 0); sw(t + 1.6, "lkB", 0, 1);
      seg(t + 1.7, .6, { pH: [0, 1], pT: [0, 0] }, "none");
      seg(t + 1.9, 4.8, { bFill: [fw, .03], fFill: [0, fw * BC / FV * .97] }, "none"); seg(t + 1.9, 4.8, { slosh: [.5, .5] }, "none");
      seg(t + 6.3, .5, { pT: [0, 1] }, "none"); sw(t + 6.9, "rodMode", 2, 0); sw(t + 6.9, "pH", 1, 0);
      sw(t + 6.9, "lkB", 1, 0); seg(t + 6.9, 1.4, { bX: [pE.x, bx], bY: [pE.y, BY0], bTilt: [thE, 0] }); seg(t + 6.9, .01, { slosh: [.5, 0] }); });
    step("Định mức đến vạch", `Thêm nước cất sát vạch, rồi nhỏ từng giọt đến đúng vạch định mức ${Vv(FV)} (đáy khum chất lỏng tiếp xúc vạch).`, DMD, SH(["flask", "wash"], .12, 1.42, .06, 1.46, 1.35), t => dilutionToMark(t, fw * BC / FV * .97));
    step("Đậy nút, đảo đều", "Đậy nút, đưa bình ra phía trước và đảo ngược ≥ 10 lần để dung dịch đồng nhất.", FLIP_DUR, SH(["flask"], .3, 1.2, .5, 1.1, 1.4), flipSeq);
  } else if (mode === "solid-mass") {
    const fw0 = fW(wa * rho, BC), fw1 = fW((wa + sa / 2) * rho, BC), tipB = new THREE.Vector3(bx - .8, PAN + 14, 0), m0 = 118.4;
    step("Cân bì", "Đặt cốc sạch lên cân điện tử, đợi số ổn định rồi nhấn Tare để cân bì.", 4.2, SH(["bal", "beaker"], .5, 1.22, .3, 1.15), t => {
      seg(t, 1, { bY: [PAN + 9, PAN] }, "power2.in"); seg(t + 1.05, .6, { lcd: [0, m0] }, "none"); seg(t + 2.4, .3, { lcd: [m0, 0] }, "none"); });
    step("Cân chất rắn", `Mở nắp lọ, dùng thìa xúc ${Mv(sa)} ${F} vào cốc đã cân bì; cân hiển thị ${Mv(sa)}.`, scoopDur(3) + 1.2, SH(["bal", "jar", "spat", "beaker"], .5, 1.15, .32, 1.1), t => {
      scoops(t, "beaker", bx, PAN + 12.4, 0, sa); });
    step("Thêm nước", `Thêm ${Mv(wa)} nước cất theo khối lượng; cân hiển thị tổng ${Mv(sa)} + ${Mv(wa)} = ${Mv(A.finalMass)}.`, WD(3.4), SH(["bal", "beaker", "wash"], .4, 1.2, .25, 1.15), t => {
      washFill(t, 3.4, tipB, 0, "bFill", fW(0, BC), fw0); seg(t + 1.35, 3.4, { lcd: [sa, A.finalMass] }, "none"); seg(t + 1.35, 3.4, { bFill: [fw0, fw1] }, "none"); });
    step("Khuấy tan", `Khuấy bằng đũa thủy tinh đến tan hoàn toàn${exo ? "; dung dịch tỏa nhiệt — để nguội nếu cần" : ""}.`, 5.2, SH(["bal", "beaker", "rod"], .3, 1.2, .1, 1.1, 1.3), t => {
      stirSeq(t, 5.2, 0); seg(t + .6, 3.6, { dissolve: [0, 1], tint: [0, 1] }, "none"); });
  } else if (mode === "dilute-vol") {
    const camMarkShot = SH(["flask", "wash"], .12, 1.42, .06, 1.46, 1.35);
    const vs = A.soluteVolume, fAdd = clamp(vs / FV, .015, .4), fMid = .5;
    const kind = { micro: "micropipet", pip: "pipet", cyl: "ống đong" }[toolKind];
    step("Nước vào bình", `Cho trước nước cất (khoảng một nửa thể tích) vào bình định mức ${Vv(FV)}.`, WD(3.2), SH(["flask", "wash", "stock"], .4, 1.22, .22, 1.17), t => {
      washFill(t, 3.2, new THREE.Vector3(FX - .9, 19.5, 0), 1, "fFill", 0, fMid); });
    step("Lấy dung dịch gốc", `Mở nắp chai, dùng ${kind} lấy chính xác ${Vv(vs)} ${F} gốc.`, 5.0, SH(["stock", "tool"], .45, 1.2, .3, 1.16, 1.45), t => {
      cap(t, "sCap", 0, 1, .9); sw(t + .8, "tOn", 0, 1);
      if (toolKind === "cyl") { seg(t + .8, 1.1, { tX: [SX - 6, SX - 6], tY: [0, 0] }); seg(t + 1.7, 2.6, { tFill: [0, 1], sFill: [.85, .78] }, "none"); }
      else { seg(t + .8, 1.2, { tX: [SX, SX], tY: [26, 2.4] }); seg(t + 2.1, 1.8, { tFill: [0, 1], sFill: [.85, .84] }, "none"); seg(t + 4.0, .9, { tY: [2.4, 26] }); } });
    if (toolKind === "cyl") {
      const lipT = { x: FX - 2.6, y: 18.4 }, th0 = tool.tiltForLip(1) + .05, thE = tool.tiltForLip(.02), p0 = poseFromLip(tool, lipT, th0), pE = poseFromLip(tool, lipT, thE), cx0 = SX - 6;
      Object.assign(P, { ltX: lipT.x, ltY: lipT.y });
      step("Rót vào bình", `Rót ${F} gốc từ từ dọc đũa thủy tinh vào nước${A.isAcid ? " (luôn cho axit vào nước)" : ""}.`, 6.6, SH(["tool", "flask"], .55, 1.18, .35, 1.22, 1.2), t => {
        seg(t, 1.5, { tX: [cx0, p0.x], tY: [0, p0.y], tTilt: [0, th0] }); sw(t + 1.2, "rodMode", 0, 2); sw(t + 1.2, "pSrc", 0, 3); sw(t + 1.5, "lkT", 0, 1);
        seg(t + 1.6, .5, { pH: [0, 1], pT: [0, 0] }, "none"); seg(t + 1.8, 3, { tFill: [1, .02], fFill: [fMid, fMid + fAdd] }, "none"); seg(t + 4.5, .5, { pT: [0, 1] }, "none");
        sw(t + 5.0, "rodMode", 2, 0); sw(t + 5.0, "pH", 1, 0); sw(t + 5.0, "lkT", 1, 0); seg(t + 5.0, 1.4, { tX: [pE.x, cx0], tY: [pE.y, 0], tTilt: [thE, 0] }); cap(t + 5.0, "sCap", 1, 0, .9); });
    } else {
      const tipW = new THREE.Vector3(FX - .45, 15.0, 0);
      step("Thả vào bình", `Đưa đầu ${kind} sát thành bình, thả từ từ ${F} gốc xuống nước${A.isAcid ? " (luôn cho axit vào nước)" : ""}.`, 6.0, SH(["tool", "flask", "stock"], .4, 1.2, .3, 1.28, 1.45), t => {
        seg(t, 1.5, { tX: [SX, tipW.x], tY: [26, 19] }); seg(t + 1.5, .6, { tY: [19, tipW.y] }); sw(t + 2.0, "pSrc", 0, 2);
        seg(t + 2.1, .4, { pH: [0, 1], pT: [0, 0] }, "none"); seg(t + 2.1, 2.6, { tFill: [1, 0], fFill: [fMid, fMid + fAdd] }, "none"); seg(t + 4.5, .4, { pT: [0, 1] }, "none");
        sw(t + 4.9, "pH", 1, 0); seg(t + 4.7, .8, { tY: [tipW.y, 30] }); sw(t + 5.5, "tOn", 1, 0); cap(t + 4.8, "sCap", 1, 0, .9); }); }
    step("Trộn đều", `Xoay nhẹ bình để trộn${exo ? "; dung dịch nóng lên — chờ nguội về nhiệt độ phòng trước khi định mức" : ""}.`, 4.2, SH(["flask"], .3, 1.2, .5, 1.12, 1.4), t => {
      const k = [.3, -.3, .26, -.26, 0]; k.forEach((a, i) => seg(t + .3 + i * .65, .65, { fRot: [i ? k[i - 1] : 0, a] })); seg(t, 3.6, { tint: [0, 1], slosh: [.5, .5] }, "none"); sw(t + 3.7, "slosh", .5, 0);
      if (exo) { sw(t, "heatV", 1, 1); seg(t, 3.8, { heat: [0, 1] }, "none"); } });
    step("Định mức đến vạch", `Thêm nước sát vạch, rồi nhỏ từng giọt đến đúng vạch định mức ${Vv(FV)}.`, DMD, camMarkShot, t => dilutionToMark(t, fMid + fAdd));
    step("Đậy nút, đảo đều", "Đậy nút, đưa bình ra phía trước và đảo ngược ≥ 10 lần để dung dịch đồng nhất.", FLIP_DUR, SH(["flask"], .3, 1.2, .5, 1.1, 1.4), flipSeq);
  } else { // dilute-mass
    const fw0 = fW(wa * rho, BC), fw1 = fW((wa + (A.soluteVolume ?? sa / 1.1)) * rho, BC), m0 = 118.4;
    const lipT = { x: bx - 4.6, y: PAN + 13.4 }, sRest = { x: SX, y: 0 }, th0 = stockV.tiltForLip(.85) + .05, thE = stockV.tiltForLip(.85 - .12), p0 = poseFromLip(stockV, lipT, th0), pE = poseFromLip(stockV, lipT, thE);
    Object.assign(P, { lsX: lipT.x, lsY: lipT.y });
    step("Cân bì", "Đặt cốc sạch lên cân điện tử, đợi số ổn định rồi nhấn Tare để cân bì.", 4.2, SH(["bal", "beaker", "stock"], .5, 1.22, .3, 1.15), t => {
      seg(t, 1, { bY: [PAN + 9, PAN] }, "power2.in"); seg(t + 1.05, .6, { lcd: [0, m0] }, "none"); seg(t + 2.4, .3, { lcd: [m0, 0] }, "none"); });
    step("Cho nước trước", `Cho trước ${Mv(wa)} nước cất vào cốc (cân trực tiếp); cân hiển thị ${Mv(wa)}.`, WD(3.2), SH(["bal", "beaker", "wash"], .4, 1.2, .25, 1.15), t => {
      washFill(t, 3.2, new THREE.Vector3(bx - .8, PAN + 14, 0), 0, "bFill", 0, fw0); seg(t + 1.35, 3.2, { lcd: [0, wa] }, "none"); });
    step("Thêm dung dịch gốc", `Mở nắp chai, thêm từ từ ${Mv(sa)} ${F} gốc dọc đũa thủy tinh${A.isAcid ? " (luôn cho axit vào nước)" : ""}; cân hiển thị tổng ${Mv(A.finalMass)}.`, 9.0, SH(["bal", "stock", "beaker"], .6, 1.15, .4, 1.2, 1.18), t => {
      cap(t, "sCap", 0, 1, .9);
      seg(t + .9, 1.6, { sX: [sRest.x, p0.x], sY: [0, p0.y], sTilt: [0, th0] }); sw(t + 2.1, "rodMode", 0, 2); sw(t + 2.1, "pSrc", 0, 1); sw(t + 2.5, "lkS", 0, 1);
      seg(t + 2.6, .5, { pH: [0, 1], pT: [0, 0] }, "none");
      seg(t + 2.8, 3.8, { sFill: [.85, .73], bFill: [fw0, fw1], lcd: [wa, A.finalMass] }, "none"); seg(t + 6.7, .5, { pT: [0, 1] }, "none");
      sw(t + 7.2, "rodMode", 2, 0); sw(t + 7.2, "pH", 1, 0); sw(t + 7.2, "lkS", 1, 0);
      seg(t + 7.2, 1.3, { sX: [pE.x, sRest.x], sY: [pE.y, 0], sTilt: [thE, 0] }); cap(t + 8.0, "sCap", 1, 0, .9); });
    step("Khuấy đều", `Khuấy nhẹ bằng đũa thủy tinh đến khi ${exo ? "dung dịch nguội và " : ""}đồng nhất.`, 5.2, SH(["bal", "beaker", "rod"], .3, 1.2, .1, 1.1, 1.3), t => {
      stirSeq(t, 5.2, 0); seg(t + .3, 3.6, { tint: [0, 1] }, "none"); });
  }

  /** Định mức: tia nước đến sát vạch rồi nhỏ giọt hình giọt lệ, vi giọt bám thành cổ bình */
  function dilutionToMark(t, f0) {
    const NDROP = 3, DS = 1.2, tip = new THREE.Vector3(FX - .9, 19.5, 0);
    const end = washFill(t, 3.2, tip, 1, "fFill", f0, .93, true);
    const d0 = t + WD(3.2, true), dp = washPose(new THREE.Vector3(FX, 19.5, 0), Math.PI);
    seg(d0, .7, { wX: [end.x, dp.x], wY: [end.y, dp.y], wTilt: [JT, Math.PI] });
    seg(d0 + .7, NDROP * DS, { dropT: [0, NDROP], fFill: [.93, 1.0], wallT: [0, 1] }, "none"); sw(d0 + .7, "dropOn", 0, 1); sw(d0 + .7 + NDROP * DS, "dropOn", 1, 0);
    seg(d0 + .7 + NDROP * DS, .5, { mark: [0, 1] });
    const e = d0 + 1.2 + NDROP * DS;
    seg(e, .4, { wY: [dp.y, yL], wTilt: [Math.PI, .6] }); seg(e + .4, .6, { wX: [dp.x, WR.x], wZ: [0, WR.z] }); seg(e + 1, .55, { wY: [yL, 0], wTilt: [.6, 0] });
  }

  const total = cur + .8; tl.set({}, {}, total); // giữ độ dài timeline
  steps.forEach((s, i) => tl.addLabel("s" + i, s.t));

  /* ---------------------------------- Áp trạng thái P → cảnh 3D ---------------------------------- */
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), tmp = V3(0, 0, 0), tmp2 = V3(0, 0, 0);
  const lipWorld = v => { v.group.updateMatrixWorld(true); const q = lipLocal(v); return v.group.localToWorld(q); };
  const surfYOf = (v, f) => { v.group.updateMatrixWorld(true); const q = V3(0, v.hOf(f), 0); return v.group.localToWorld(q).y; };
  const waterC = new THREE.Color(WATER), tintC = new THREE.Color(stock), mixC = new THREE.Color();
  const dropSplashDir = Array.from({ length: 5 }, (_, i) => ({ vx: (i - 2) * .55, vy: 1.4 + (i % 2) * .5 }));
  const fCenter = () => FX;
  let lastLCD = "", lastRead = 0;

  function apply(time) {
    const p = P;
    // vật dụng. Khi đang rót (khóa lk*=1): góc nghiêng = max(góc theo kịch bản, góc để mặt chất lỏng chạm môi rót) → mực luôn khớp thể tích còn lại
    beaker.f = p.bFill; stockV.f = p.sFill; if (volM) flask.f = p.fFill;
    let bX = p.bX, bY = p.bY, bT = p.bTilt, sX = p.sX, sY = p.sY, sT = p.sTilt, tX = p.tX, tY = p.tY, tT = p.tTilt;
    if (p.lkB > .5) { bT = Math.max(bT, beaker.tiltForLip(p.bFill)); const o = poseFromLip(beaker, { x: p.lbX, y: p.lbY }, bT); bX = o.x; bY = o.y; }
    if (p.lkS > .5) { sT = Math.max(sT, stockV.tiltForLip(p.sFill)); const o = poseFromLip(stockV, { x: p.lsX, y: p.lsY }, sT); sX = o.x; sY = o.y; }
    if (tool && toolKind === "cyl" && p.lkT > .5) { tT = Math.max(tT, tool.tiltForLip(p.tFill)); const o = poseFromLip(tool, { x: p.ltX, y: p.ltY }, tT); tX = o.x; tY = o.y; }
    beaker.group.position.set(bX, bY, 0); beaker.group.rotation.z = -bT;
    fp.position.set(FX, 8 + p.fLift, p.fZ); fp.rotation.z = p.fRot; flask.closed = p.stopY < 29;
    stockV.group.position.set(sX, sY, 0); stockV.group.rotation.z = -sT;
    { const q = p.sCap; stockCap.visible = stockV.group.visible; stockCap.position.set(SX0 + 3.9 * q, 3.4 * Math.sin(Math.PI * q) - 10.5 * q, 2.6 * q); stockCap.rotation.x = Math.PI * q; }  // nắp: nhấc lên, vòng sang bên, nằm úp trên bàn
    if (tool) { tool.f = p.tFill; tool.group.visible = p.tOn > .5; tool.group.position.set(tX, tY, 0); tool.group.rotation.z = -tT; }
    wash.visible = p.wOn > .5; wash.position.set(p.wX, p.wY, p.wZ); wash.rotation.z = -p.wTilt;
    boat.visible = solidM && p.boatOn > .5; boat.position.set(p.boatX, p.boatY, 0); boat.rotation.z = -p.boatTilt;
    stopper.visible = p.stopY < 29; stopper.position.set(0, p.stopY - 8, 0);
    bal.group.visible = needBal && p.pan > .5;
    { // nắp lọ chất rắn: nhấc lên, vòng sang bên rồi nằm úp trên mặt bàn
      const q = p.jarCap, cg = solidBottle.userData.cap; if (cg) { cg.position.set(-3.8 * q, 3.4 * Math.sin(Math.PI * q) - 5.95 * q, 2.6 * q); cg.rotation.x = Math.PI * q; }
    }
    spat.visible = p.spOn > .5; spat.position.set(p.spX, p.spY, 0); spat.rotation.z = p.spR;
    spC.forEach((m, i) => { m.visible = p.spLoad > (i + .5) / spC.length - .001; });

    scene.updateMatrixWorld(true);
    // màu dung dịch (nước cất → màu hóa chất)
    mixC.copy(waterC).lerp(tintC, p.tint); beaker.setColor(mixC, lerp(WOP, LIQ_OP, p.tint)); flask.setColor(mixC, lerp(WOP, LIQ_OP, p.tint));
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
      if (p.fall <= 0 && p.drop > 0) {   // thìa đổ trực tiếp vào cốc: từng muỗng rơi tự do (y ∝ t²) tới đáy rồi cuộn theo xoáy khi khuấy
        const g = Math.min(2, Math.floor(i / (NC / 3))), q = p.drop - g;
        if (q > 0) {
          const ang = c.a + p.stir * (.5 + c.rr * .6), rr = (.15 + c.rr * .6) * rIn * (1 - .35 * p.vort * c.ph), u = clamp((q - c.d * .25) / .55);
          const dst = V3(bk.x + rr * Math.cos(ang), bFloor + c.s * .8 + p.vort * c.ph * .6, rr * Math.sin(ang)), src = V3(p.dropX + c.bx * .5, p.dropY - .3, c.bz * .5);
          m.position.set(lerp(src.x, dst.x, u), lerp(src.y, dst.y, u * u), lerp(src.z, dst.z, u)); m.scale.setScalar(c.s * (1 - sstep(c.d * .4, 1, p.dissolve))); vis = m.scale.x > .01 && u > 0;
        }
      } else if (p.fall <= 0) {
        if (loadVis) { m.position.set(p.boatX + c.bx, p.boatY + .2 + c.ph * .25, c.bz); m.scale.setScalar(c.s); vis = true; }
      } else {
        // 1) trượt dọc lòng thuyền nghiêng tới mép thấp  2) rơi tự do xuống cốc
        const rb = boat.rotation.z, cb = Math.cos(rb), sb = Math.sin(rb), bowl = lx => -.75 * Math.sqrt(Math.max(0, 1 - (lx / 2.4) ** 2));
        const slideAt = su => { const lx = lerp(c.bx, -2.3, su), ly = bowl(lx) + .2 + c.ph * .1 * (1 - su), lz = c.bz * (1 - .5 * su);
          return V3(p.boatX + lx * cb - ly * sb, p.boatY + lx * sb + ly * cb, lz); };
        const su = sstep(0, 1, clamp((p.fall - c.d * .3) / .4)), u = clamp((p.fall - .4 - c.d * .35) / .4);
        const ang = c.a + p.stir * (.5 + c.rr * .6) * (p.rodMode === 1 || p.stir > 0 ? 1 : 0), rr = (.15 + c.rr * .6) * rIn * (1 - .35 * p.vort * c.ph);
        const dst = V3(bk.x + rr * Math.cos(ang), bFloor + c.s * .8 + p.vort * c.ph * .6, rr * Math.sin(ang));
        if (u <= 0) m.position.copy(slideAt(su));
        else { const src = slideAt(1); m.position.set(lerp(src.x, dst.x, u), lerp(src.y, dst.y, u * u), lerp(src.z, dst.z, u)); }
        m.scale.setScalar(c.s * (1 - sstep(c.d * .4, 1, p.dissolve))); vis = m.scale.x > .01;
      }
            m.visible = vis; m.rotation.set(c.rot + (p.fall > 0 ? p.stir * .4 : 0), c.rot * 2, c.rot);
    });

    // LCD cân điện tử (fmtMass/fmtVol khớp #calc)
    if (needBal) { const txt = balText(p.lcd); bal.draw(txt, Math.abs(p.lcd - lastRead) < 1e-6 * (1 + Math.abs(p.lcd)) || p.lcd === 0); lastRead = p.lcd; lastLCD = txt; }

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
        if (p.rodMode === 2) setRod(lip.clone(), tPt);
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
      m.scale.setScalar(1.2 + a * 3.6); m.material.opacity = p.heat * Math.sin(Math.PI * Math.min(1, a * 1.1)) * .34; m.material.rotation = time * .2 + i;
    });
    // bóng mờ
    blobs.forEach(b => { const w = b.obj.getWorldPosition(tmp2); b.m.position.x = w.x; b.m.material.opacity = clamp(1 - Math.max(0, w.y - b.base) / 12); b.m.visible = b.obj.visible; });
  }

  /** Hộp bao định hướng (OBB, hệ cục bộ của từng vật) của các vật rắn → kiểm tra không xuyên thấu/chồng chéo (xem tests/lab3d.test.mjs) */
  const visibleChain = o => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
  const box = (name, obj, a, b) => ({ name, obj, min: V3(...a), max: V3(...b), visible: visibleChain(obj) });
  function collisionBoxes() {
    const L = [box("beaker", beaker.group, [-3.5, 0, -3.5], [3.5, 9.1, 3.5]),
      box("flask-bulb", flask.group, [-4.6, 0, -4.6], [4.6, 9.2, 4.6]), box("flask-neck", flask.group, [-1.3, 9.2, -1.3], [1.3, 16.3, 1.3]),
      box("stock-body", stockV.group, [-2.7, 0, -2.7], [2.7, 8.6, 2.7]), box("stock-neck", stockV.group, [-1.3, 8.6, -1.3], [1.3, 10.5, 1.3]),
      box("wash-body", wash, [-1.6, 0, -1.6], [1.6, 8.3, 1.6]), box("wash-nozzle", wash, [-.7, 8.2, -.7], [.7, 10.7, .7]),
      box("balance", bal.group, [-4.9, 0, -3.7], [4.9, 1.78, 3.7]), box("pan", bal.group, [-2.8, 1.6, -2.8], [2.8, 1.82, 2.8]),
      box("solid-jar", solidBottle, [-2.4, 0, -2.4], [2.4, 7.1, 2.4]), box("boat", boat, [-1.5, -1.5, -1.5], [1.5, 0, 1.5])];
    if (tool) L.push(box("tool", tool.group, toolKind === "cyl" ? [-1.7, 0, -1.7] : [-1.1, 0, -1.1], toolKind === "cyl" ? [1.7, 15, 1.7] : toolKind === "pip" ? [-1.1, 0, -1.1] : [-1, 0, -1]));
    if (tool && toolKind === "pip") L[L.length - 1].max.set(1.1, 22, 1.1);
    if (tool && toolKind === "micro") L[L.length - 1].max.set(1, 14.2, 1);
    L.forEach(b => { b.v = b.obj.visible !== false && b.visible; });
    return L;
  }
  /* ---- Camera điện ảnh: giữ các vật trọng tâm của nhịp trong khung (tính theo 8 đỉnh hộp bao, theo tỉ lệ khung hình), góc quay trôi chậm trong từng nhịp ---- */
  const stepAt = tm => { let i = 0; for (let k = 0; k < steps.length; k++) if (tm >= steps[k].t - 1e-4) i = k; return i; };
  const focusObj = () => ({ bal: bal.group, jar: solidBottle, boat, beaker: beaker.group, flask: fp, stock: stockV.group, tool: tool?.group, wash, rod, spat });
  const _b = new THREE.Box3(), _b2 = new THREE.Box3(), _c = V3(0, 0, 0), _q = V3(0, 0, 0);
  /** @returns [θ, φ, khoảng cách, x, y, z] của tâm ngắm */
  function frame(tm, aspect = 1.5, shot = null) {
    const st = steps[stepAt(tm)]; shot = shot || st.shot;
    const sp = clamp((tm - st.t) / st.dur), e = sp * sp * (3 - 2 * sp);
    const th = lerp(shot.a[0], shot.a[2], e), ph = lerp(shot.a[1], shot.a[3], e), fo = focusObj();
    _b.makeEmpty();
    for (const k of shot.f) { const o = fo[k]; if (o && visibleChain(o)) { o.updateMatrixWorld(true); _b2.setFromObject(o); if (!_b2.isEmpty()) _b.union(_b2); } }
    if (_b.isEmpty()) _b.set(V3(-8, 0, -4), V3(8, 16, 4));
    _b.getCenter(_c);
    const dir = V3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)).normalize();
    const right = dir.clone().negate().cross(V3(0, 1, 0)).normalize(), up = right.clone().cross(dir.clone().negate()).normalize();
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tvh = tv * aspect, m = shot.m ?? 1.22;
    let d = 9;
    for (let i = 0; i < 8; i++) {
      _q.set(i & 1 ? _b.max.x : _b.min.x, i & 2 ? _b.max.y : _b.min.y, i & 4 ? _b.max.z : _b.min.z).sub(_c);
      const along = _q.dot(dir); d = Math.max(d, along + Math.abs(_q.dot(right)) * m / tvh, along + Math.abs(_q.dot(up)) * m / tv);
    }
    return [th, ph, Math.min(d, 95), _c.x, _c.y, _c.z];
  }
  const rodSeg = () => rod.visible ? (() => { const d = V3(0, 1, 0).applyQuaternion(rod.quaternion).multiplyScalar(rod.scale.y / 2); return [rod.position.clone().sub(d), rod.position.clone().add(d)]; })() : null;
  return { scene, camera, P, tl, steps, apply, bal, lcdText: () => lastLCD, FX, volM, solidM, needBal, mode, collisionBoxes, rodSeg, frame, stepAt, toolKind, parts: { beaker, flask, stockV, tool, wash, boat, fp, stopper }, dispose() { scene.traverse(o => { o.geometry?.dispose?.(); }); } };
}

/* ====================================================================================================
 * mount: dựng khung sân khấu (canvas WebGL + bộ phát) vào host, trả về { destroy }
 * Bố cục: [khung 3D: huy hiệu số liệu · công cụ] → [chương: chip các bước] + lời giải thích → [thanh tua có vạch bước + thời gian]
 *         → [⏮ Bước trước · ⏯ Phát/Tạm dừng · Bước tiếp ⏭] [góc nhìn] [tốc độ · lặp]
 * ================================================================================================== */
const VIEWS = [["dir", "Tự động"], ["all", "Toàn cảnh"], ["mark", "Cận cảnh"], ["top", "Từ trên"]];
const SPEEDS = [.5, .75, 1, 1.5, 2];
const fmtSpeed = s => `${String(s).replace(".", ",")}×`;
const clock = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const FOCUS_ALL = ["bal", "jar", "beaker", "flask", "stock", "tool", "wash"];

export function mount(host, anim) {
  const lib = { THREE: globalThis.THREE, gsap: globalThis.gsap };
  if (!lib.THREE || !lib.gsap) { host.innerHTML = `<div class="lab3d-err">Chưa tải được thư viện 3D (Three.js / GSAP). Hãy kết nối mạng một lần để lưu vào bộ nhớ đệm.</div>`; return { destroy() {} }; }
  host.innerHTML = `<div class="lab3d" tabindex="0" aria-label="Mô phỏng 3D pha chế. Phím Space: phát/tạm dừng, mũi tên: đổi bước, F: toàn màn hình, R: phát lại, V: đổi góc nhìn">
    <div class="lab3d-view"><canvas></canvas>
      <div class="lab3d-hud" aria-live="off"></div>
      <div class="lab3d-tools"><button type="button" class="lab3d-reset" data-a="resetview" aria-label="Đặt lại góc nhìn" title="Đặt lại góc nhìn" hidden>⟲</button><button type="button" data-a="fullscreen" aria-label="Toàn màn hình" title="Toàn màn hình (F)">⛶</button></div>
      <div class="lab3d-flash" aria-hidden="true"></div>
      <div class="lab3d-hint" aria-hidden="true">Kéo để xoay · Chụm để thu phóng · Chạm để phát/dừng</div>
    </div>
    <div class="lab3d-info"><div class="lab3d-chips" role="group" aria-label="Các bước thao tác"></div><p class="lab3d-cap" aria-live="polite"><b></b><span></span></p></div>
    <div class="lab3d-timeline"><div class="lab3d-track"><div class="lab3d-marks"></div><i class="lab3d-fill"></i><input class="lab3d-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Thanh tua mô phỏng"></div><span class="lab3d-clock">0:00 / 0:00</span></div>
    <div class="lab3d-bar">
      <div class="lab3d-grp"><button type="button" class="lab3d-btn" data-a="prev" aria-label="Bước trước"><span aria-hidden="true">⏮\uFE0E</span><em>Bước trước</em></button><button type="button" class="lab3d-btn lab3d-playbtn" data-a="play" aria-label="Tạm dừng"></button><button type="button" class="lab3d-btn" data-a="next" aria-label="Bước tiếp"><em>Bước tiếp</em><span aria-hidden="true">⏭\uFE0E</span></button></div>
      <div class="lab3d-grp lab3d-views" role="radiogroup" aria-label="Góc nhìn">${VIEWS.map(([k, n], i) => `<button type="button" role="radio" aria-checked="${i ? "false" : "true"}" data-v="${k}" class="lab3d-btn ${i ? "" : "on"}">${n}</button>`).join("")}</div>
      <div class="lab3d-grp lab3d-opts"><button type="button" class="lab3d-btn" data-a="speed" aria-label="Tốc độ phát: 1×">1×</button><button type="button" class="lab3d-btn" data-a="loop" aria-pressed="false" aria-label="Lặp lại">↻ Lặp</button></div>
    </div></div>`;
  const $ = s => host.querySelector(s), canvas = $("canvas");
  let renderer;
  try { renderer = new lib.THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { host.innerHTML = `<div class="lab3d-err">Thiết bị không hỗ trợ WebGL nên không hiển thị được mô phỏng 3D.</div>`; return { destroy() {} }; }
  const THREE_ = lib.THREE;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputEncoding = THREE_.sRGBEncoding; renderer.toneMapping = THREE_.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.localClippingEnabled = true;

  const sim = createSim(anim, lib), { scene, camera, tl, steps } = sim, P = sim.P;
  { // môi trường studio (PMREM): nền tối + vài tấm đèn softbox → viền sáng trên kính, ánh phản chiếu trên mặt chất lỏng mà không làm bạc màu
    const env = new THREE_.Scene(); env.add(new THREE_.Mesh(new THREE_.SphereGeometry(60, 24, 12), new THREE_.MeshBasicMaterial({ color: 0x080d15, side: THREE_.BackSide })));
    const panel = (w, h, x, y, z, i, tint = 0xffffff) => { const m = new THREE_.Mesh(new THREE_.PlaneGeometry(w, h), new THREE_.MeshBasicMaterial({ color: new THREE_.Color(tint).multiplyScalar(i), side: THREE_.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    panel(40, 14, 0, 40, 14, 3.4, 0xfff3e0); panel(7, 44, -40, 14, 10, 3, 0x9ec5ff); panel(7, 44, 40, 14, -8, 2.2, 0xffffff); panel(26, 6, 0, 10, 46, 1.2); panel(30, 5, 0, 4, -46, 1.6, 0x9ec5ff);
    const pm = new THREE_.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, .02).texture; pm.dispose();
  }

  const card = $(".lab3d"), hud = $(".lab3d-hud"), capB = $(".lab3d-cap b"), capT = $(".lab3d-cap span"), chips = $(".lab3d-chips"), marks = $(".lab3d-marks");
  const fill = $(".lab3d-fill"), clockEl = $(".lab3d-clock"), playBtn = $("[data-a=play]"), seek = $(".lab3d-seek"), flash = $(".lab3d-flash");
  const resetBtn = $(".lab3d-reset"), hint = $(".lab3d-hint"), loopBtn = $("[data-a=loop]"), speedBtn = $("[data-a=speed]"), fsBtn = $("[data-a=fullscreen]");
  const TOTAL = tl.duration() || 1;
  chips.innerHTML = steps.map((s, i) => `<button type="button" data-i="${i}" aria-label="Bước ${i + 1}: ${s.title}"><b>${i + 1}</b><span>${s.title}</span></button>`).join("");
  marks.innerHTML = steps.slice(1).map(s => `<i style="left:${(s.t / TOTAL * 100).toFixed(2)}%"></i>`).join("");
  const chipEls = [...chips.children];
  const reduceMotion = !!(globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Trạng thái điều khiển: autoPaused = tự dừng do khung ẩn / tab ẩn (sẽ tự tiếp tục)
  let dirty = true, loopOn = false, scrubbing = false, scrubResume = false, autoPaused = false, onScreen = true, tabVisible = !document.hidden;
  const playing = () => !tl.paused() && tl.progress() < 1;
  const poke = () => { dirty = true; };

  /* ---------- Camera: tự khung hình theo nhịp (chế độ Tự động); kéo/chạm xoay, cuộn/chụm thu phóng ---------- */
  let view = "dir", off = { th: 0, ph: 0, z: 1 }; const cs = { th: 0, ph: 0, d: 0, x: 0, y: 0, z: 0 }; let first = true;
  const vm = sim.volM, FX = sim.FX;
  const target = () => {
    const tm = tl.time(), asp = camera.aspect || 1.5;
    if (view === "mark") return vm ? [.12, 1.42, 14.5, FX, 12.6, 0] : sim.frame(tm, asp, { f: ["bal", "beaker"], a: [.28, 1.3, .28, 1.3], m: .78 });
    if (view === "all") return sim.frame(tm, asp, { f: FOCUS_ALL, a: [.42, 1.2, .42, 1.2], m: 1.08 });
    if (view === "top") return sim.frame(tm, asp, { f: FOCUS_ALL, a: [.3, .62, .3, .62], m: 1.08 });
    return sim.frame(tm, asp);
  };
  const viewMoved = () => Math.abs(off.th) > .03 || Math.abs(off.ph) > .03 || Math.abs(off.z - 1) > .03;
  const syncReset = () => { resetBtn.hidden = !viewMoved(); };
  const resetView = () => { off = { th: 0, ph: 0, z: 1 }; syncReset(); poke(); };
  /** trả về true nếu camera còn đang hội tụ (cần vẽ tiếp) */
  function updCam(dt, time) {
    const t = target(), k = first ? 1 : 1 - Math.exp(-4.4 * dt); first = false;
    let d2 = 0; const keys = ["th", "ph", "d", "x", "y", "z"];
    keys.forEach((key, i) => { const nv = lerp(cs[key], t[i], k); d2 = Math.max(d2, Math.abs(nv - cs[key]) + Math.abs(t[i] - nv) * .02); cs[key] = nv; });
    const sway = view === "dir" && !reduceMotion ? Math.sin(time * .33) * .02 : 0;   // nhịp thở rất nhẹ của máy quay
    const th = cs.th + off.th + sway, ph = clamp(cs.ph + off.ph, .12, 1.55), d = cs.d * off.z;
    camera.position.set(cs.x + d * Math.sin(ph) * Math.sin(th), Math.max(.6, cs.y + d * Math.cos(ph)), cs.z + d * Math.sin(ph) * Math.cos(th)); camera.lookAt(cs.x, cs.y, cs.z);
    return d2 > 5e-4 || sway !== 0 && playing();
  }

  // Con trỏ: 1 ngón kéo = xoay, 2 ngón = thu phóng, chạm (không di chuyển) = phát/tạm dừng
  const ptrs = new Map(); let pinch = 0, tap = null;
  canvas.style.touchAction = "none";
  const hideHint = () => hint.classList.remove("show");
  canvas.addEventListener("pointerdown", e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); hideHint(); tap = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), ok: true } : (tap && (tap.ok = false), tap); });
  canvas.addEventListener("pointermove", e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    if (tap && tap.ok && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap.ok = false;
    if (ptrs.size === 1) { off.th -= (e.clientX - prev.clientX) * .008; off.ph -= (e.clientY - prev.clientY) * .008; }
    ptrs.set(e.pointerId, e);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) off.z = clamp(off.z * pinch / d, .35, 2.2); pinch = d; }
    syncReset(); poke();
  });
  const up = e => { const was = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); pinch = 0; if (was && e.type === "pointerup" && tap && tap.ok && ptrs.size === 0 && performance.now() - tap.t < 450) togglePlay(true); if (!ptrs.size) tap = null; };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", e => { e.preventDefault(); off.z = clamp(off.z * Math.exp(e.deltaY * .001), .35, 2.2); hideHint(); syncReset(); poke(); }, { passive: false });
  canvas.addEventListener("dblclick", resetView);

  /* ---------- Giao diện: trạng thái ---------- */
  const stepAt = tm => sim.stepAt(tm);
  let lastStep = -1, lastLabel = "", lastClock = "";
  const ui = () => {
    const tm = tl.time(), i = stepAt(tm), done = tl.progress() >= 1;
    if (i !== lastStep) {
      lastStep = i; capB.textContent = `Bước ${i + 1}/${steps.length} · ${steps[i].title}`; capT.textContent = steps[i].cap;
      chipEls.forEach((b, k) => { b.classList.toggle("on", k === i); b.setAttribute("aria-current", k === i ? "step" : "false"); });
      chipEls[i]?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: reduceMotion ? "auto" : "smooth" });
    }
    chipEls.forEach((b, k) => b.classList.toggle("done", k < i));
    const frac = clamp(tm / TOTAL); fill.style.width = `${frac * 100}%`;
    if (!scrubbing) seek.value = Math.round(frac * 1000);
    const ck = `${clock(tm)} / ${clock(TOTAL)}`; if (ck !== lastClock) { lastClock = ck; clockEl.textContent = ck; }
    const label = done ? "↻ Phát lại" : tl.paused() ? "▶ Tiếp tục" : "⏸ Tạm dừng";
    if (label !== lastLabel) { lastLabel = label; playBtn.textContent = label; playBtn.setAttribute("aria-label", label.slice(2)); playBtn.classList.toggle("is-paused", label !== "⏸ Tạm dừng"); card.classList.toggle("is-paused", label !== "⏸ Tạm dừng"); }
    poke();
  };
  const hudText = () => {
    const a = anim, parts = [];
    if (sim.needBal) parts.push(["Cân", sim.lcdText() || "0,000 g"]);
    const vol = v => v < 1e-9 ? "0 mL" : fmtVol(v);
    if (sim.volM) parts.push([`Bình ${fmtVol(a.finalVolume)}`, vol(clamp(P.fFill, 0, 1.2) * a.finalVolume)]);
    if (!sim.solidM && sim.volM && P.tOn > .5) parts.push([{ micro: "Micropipet", pip: "Pipet", cyl: "Ống đong" }[sim.toolKind], vol(P.tFill * a.soluteVolume)]);   // thể tích đang chứa trong dụng cụ
    return parts;
  };
  const flashIcon = g => { flash.textContent = g; flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go"); };
  const go = i => { i = clamp(i, 0, steps.length - 1); tl.tweenTo("s" + i, { duration: clamp(Math.abs(tl.time() - steps[i].t) * .22, .3, 1.4), ease: "power2.inOut" }); };
  const pause = () => { tl.paused(true); autoPaused = false; ui(); };
  const resume = () => { if (tl.progress() >= 1) tl.restart(); else tl.paused(false); autoPaused = false; ui(); };
  const togglePlay = fb => { const was = playing(); if (!was) resume(); else pause(); if (fb) flashIcon(was ? "⏸" : "▶"); };
  const replay = () => { autoPaused = false; tl.restart(); ui(); };
  const prevStep = () => { tl.pause(); const i = stepAt(tl.time()); go(tl.time() - steps[i].t > .8 ? i : i - 1); ui(); };
  const nextStep = () => { tl.pause(); go(stepAt(tl.time()) + 1); ui(); };
  const toggleFS = () => { if (document.fullscreenElement === card) document.exitFullscreen?.(); else card.requestFullscreen?.().catch(() => {}); };
  const setSpeed = () => { const i = SPEEDS.indexOf(tl.timeScale()), s = SPEEDS[(i + 1) % SPEEDS.length]; tl.timeScale(s); speedBtn.textContent = fmtSpeed(s); speedBtn.setAttribute("aria-label", `Tốc độ phát: ${fmtSpeed(s)}`); };
  const setLoop = () => { loopOn = !loopOn; loopBtn.setAttribute("aria-pressed", String(loopOn)); loopBtn.classList.toggle("on", loopOn); };
  const setView = k => { view = k; resetView(); host.querySelectorAll(".lab3d-views button").forEach(x => { const on = x.dataset.v === k; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); }); };

  host.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) setView(b.dataset.v);
    else if (b.dataset.i != null) { tl.pause(); go(+b.dataset.i); ui(); }
    else if (b.dataset.a === "prev") prevStep();
    else if (b.dataset.a === "next") nextStep();
    else if (b.dataset.a === "play") togglePlay(false);
    else if (b.dataset.a === "speed") setSpeed();
    else if (b.dataset.a === "loop") setLoop();
    else if (b.dataset.a === "resetview") resetView();
    else if (b.dataset.a === "fullscreen") toggleFS();
  });

  // Thanh tua: tạm dừng khi kéo, tiếp tục khi thả nếu trước đó đang phát
  const seekStart = () => { if (scrubbing) return; scrubbing = true; scrubResume = playing(); tl.pause(); };
  const seekEnd = () => { if (!scrubbing) return; scrubbing = false; if (scrubResume && tl.progress() < 1) tl.paused(false); scrubResume = false; ui(); };
  seek.addEventListener("pointerdown", seekStart);
  seek.addEventListener("input", () => { seekStart(); tl.time(seek.value / 1000 * TOTAL, false); ui(); });
  seek.addEventListener("change", seekEnd); seek.addEventListener("pointerup", seekEnd); seek.addEventListener("pointercancel", seekEnd);

  // Phím tắt (khi khung đang được chọn)
  card.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onBtn = e.target.closest?.("button"), onSeek = e.target === seek, k = e.key.toLowerCase();
    if (e.key === " " || e.code === "Space") { if (onBtn) return; e.preventDefault(); togglePlay(true); }
    else if (e.key === "ArrowRight" && !onSeek) { e.preventDefault(); nextStep(); }
    else if (e.key === "ArrowLeft" && !onSeek) { e.preventDefault(); prevStep(); }
    else if (k === "f") { e.preventDefault(); toggleFS(); }
    else if (k === "r") { e.preventDefault(); replay(); }
    else if (k === "v") { e.preventDefault(); setView(VIEWS[(VIEWS.findIndex(v => v[0] === view) + 1) % VIEWS.length][0]); }
  });
  tl.eventCallback("onUpdate", ui);
  tl.eventCallback("onComplete", () => { if (loopOn) { tl.restart(); } ui(); });

  const view$ = $(".lab3d-view");
  const resize = () => { const w = view$.clientWidth || 380, h = view$.clientHeight || 230; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); first = true; poke(); };
  const ro = new ResizeObserver(resize); ro.observe(view$); resize();
  const onFullscreenChange = () => {
    const active = document.fullscreenElement === card;
    fsBtn.textContent = active ? "⤓" : "⛶"; fsBtn.setAttribute("aria-label", active ? "Thoát toàn màn hình" : "Toàn màn hình");
    requestAnimationFrame(resize);
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);

  // Tự tạm dừng khi khung ra khỏi màn hình hoặc tab bị ẩn; tự tiếp tục nếu trước đó đang phát
  const syncVisibility = () => {
    const vis = onScreen && tabVisible;
    if (!vis && playing()) { tl.paused(true); autoPaused = true; ui(); }
    else if (vis && autoPaused) { autoPaused = false; if (tl.progress() < 1) tl.paused(false); ui(); }
    if (vis) poke();
  };
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(en => { onScreen = en[en.length - 1].isIntersecting; syncVisibility(); }, { threshold: .05 }) : null;
  io?.observe(view$);
  const onVis = () => { tabVisible = !document.hidden; syncVisibility(); };
  document.addEventListener("visibilitychange", onVis);

  // Gợi ý thao tác: chỉ hiện một lần
  let hintTimer = 0;
  try { if (!localStorage.getItem("lab3dHint")) { localStorage.setItem("lab3dHint", "1"); hint.classList.add("show"); hintTimer = setTimeout(hideHint, 5000); } } catch (e) { hint.classList.add("show"); hintTimer = setTimeout(hideHint, 5000); }

  // Vòng lặp: đồng hồ hoạt ảnh riêng chỉ tiến khi mô phỏng đang chạy/tua (tạm dừng = đóng băng cả sóng & hơi nước); chỉ vẽ khi có thay đổi
  let raf = 0, last = performance.now(), dead = false, shown = "", animT = 0, lastTl = -1;
  const loop = now => {
    if (dead) return; raf = requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!onScreen || !tabVisible) return;
    const tm = tl.time(), moving = Math.abs(tm - lastTl) > 1e-6; lastTl = tm;
    const run = moving || playing(); if (run) animT += dt;
    let drew = false; if (run || dirty) { dirty = false; sim.apply(animT); drew = true; }
    const camMoving = updCam(dt, animT);
    if (!drew && !camMoving) return;                       // không có gì thay đổi → không vẽ (tiết kiệm pin)
    renderer.render(scene, camera);
    const h = hudText(), key = h.map(x => x.join("|")).join("#");
    if (key !== shown) { shown = key; hud.innerHTML = h.map(([k, v]) => `<span class="lab3d-chip"><em>${k}</em><b>${v}</b></span>`).join(""); }
  };
  tl.progress(0); ui(); raf = requestAnimationFrame(loop);
  if (!reduceMotion) tl.play(); else ui();
  return { destroy() { dead = true; cancelAnimationFrame(raf); clearTimeout(hintTimer); ro.disconnect(); io?.disconnect(); document.removeEventListener("fullscreenchange", onFullscreenChange); document.removeEventListener("visibilitychange", onVis); if (document.fullscreenElement === card) document.exitFullscreen?.(); tl.kill(); sim.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); host.innerHTML = ""; } };
}
