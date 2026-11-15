/* Intro LABMANA: nền không gian đen sâu, logo trắng ở giữa, một ngôi sao băng sáng rực lướt qua.
 * Script thường (không phải module) để chạy NGAY khi trang vừa dựng, không phải chờ Firebase/CDN.
 * Chỉ chạy ở phiên mới (cờ html.intro-on do đoạn script nhỏ trong <head> đặt). Xong thì app.js chuyển sang tab Quy trình. */
(() => {
  const root = document.documentElement, el = document.getElementById("intro");
  if (!el || !root.classList.contains("intro-on")) return;
  const cv = el.querySelector("canvas"), ctx = cv.getContext("2d"), logo = el.querySelector(".intro-logo");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN = reduce ? 1200 : 3400, MAX = 9000, C0 = 900, CD = 1700;   // ms: tối thiểu, tối đa, lúc sao băng xuất hiện, thời gian lướt
  let w = 0, h = 0, dpr = 1, stars = [], sparks = [], appReady = false, loaded = document.readyState === "complete", finished = false, raf = 0;
  let resolve; window.__intro = new Promise(r => { resolve = r; });
  window.__introAppReady = () => { appReady = true; };
  addEventListener("load", () => { loaded = true; });

  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2); w = innerWidth; h = innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(260, Math.max(110, w * h / 5200)));
    stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: .3 + Math.random() ** 3 * 1.5, a: .3 + Math.random() * .7,
      f: .0008 + Math.random() * .002, p: Math.random() * 6.28, vx: -(.004 + Math.random() * .012), tint: Math.random() < .2 ? "200,215,255" : Math.random() < .15 ? "255,230,200" : "255,255,255" }));
  }
  size(); addEventListener("resize", size);

  const A = () => ({ x: -.12 * w, y: .72 * h }), B = () => ({ x: 1.12 * w, y: .3 * h });
  const ease = u => .65 * u + .35 * (u * u * (3 - 2 * u));
  let last = null;
  function comet(u, now) {
    const a = A(), b = B(), e = ease(u), x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, L = Math.min(w, 900) * .34;
    ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
    const N = 28;
    for (let i = 0; i < N; i++) {                                    // đuôi: thon dần, mờ dần
      const k0 = i / N, k1 = (i + 1) / N, al = Math.pow(1 - k0, 2.2);
      ctx.strokeStyle = `rgba(185,212,255,${(.9 * al).toFixed(3)})`; ctx.lineWidth = 7 * (1 - k0) + .6;
      ctx.beginPath(); ctx.moveTo(x - ux * L * k0, y - uy * L * k0); ctx.lineTo(x - ux * L * k1, y - uy * L * k1); ctx.stroke();
      ctx.strokeStyle = `rgba(120,170,255,${(.25 * al).toFixed(3)})`; ctx.lineWidth = 22 * (1 - k0) + 1;
      ctx.beginPath(); ctx.moveTo(x - ux * L * k0, y - uy * L * k0); ctx.lineTo(x - ux * L * k1, y - uy * L * k1); ctx.stroke();
    }
    const R = 46, g = ctx.createRadialGradient(x, y, 0, x, y, R);    // quầng sáng rực ở đầu
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.18, "rgba(235,244,255,.95)"); g.addColorStop(.5, "rgba(130,180,255,.35)"); g.addColorStop(1, "rgba(90,140,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.2832); ctx.fill();
    for (const [vx, vy] of [[1, 0], [0, 1]]) {                       // tia lấp lánh 4 cánh
      const fl = ctx.createLinearGradient(x - vx * 70, y - vy * 70, x + vx * 70, y + vy * 70);
      fl.addColorStop(0, "rgba(255,255,255,0)"); fl.addColorStop(.5, "rgba(255,255,255,.9)"); fl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = fl; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - vx * 70, y - vy * 70); ctx.lineTo(x + vx * 70, y + vy * 70); ctx.stroke();
    }
    if (!reduce) for (let i = 0; i < 2; i++) sparks.push({ x, y, vx: -ux * (.02 + Math.random() * .06) + (Math.random() - .5) * .05, vy: -uy * (.02 + Math.random() * .06) + (Math.random() - .5) * .05, born: now, life: 500 + Math.random() * 500 });
    return Math.hypot(x - w / 2, y - h / 2);
  }

  function frame(now) {
    if (finished) return;
    raf = requestAnimationFrame(frame);
    if (last === null) last = now; const t = now - (frame.t0 ??= now); last = now;
    ctx.globalCompositeOperation = "source-over"; ctx.clearRect(0, 0, w, h);
    for (const s of stars) {                                         // sao nền lấp lánh, trôi chậm
      const x = ((s.x + t * s.vx) % w + w) % w, tw = .55 + .45 * Math.sin(t * s.f * 6 + s.p);
      ctx.fillStyle = `rgba(${s.tint},${(s.a * tw).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, s.y, s.r, 0, 6.2832); ctx.fill();
    }
    let glow = 0;
    const u = (t - C0) / CD;
    if (!reduce && u > 0 && u < 1) { const d = comet(u, now); glow = Math.exp(-((d / (.2 * w)) ** 2)); }
    ctx.globalCompositeOperation = "lighter";
    sparks = sparks.filter(p => now - p.born < p.life);
    for (const p of sparks) { const k = (now - p.born) / p.life; ctx.fillStyle = `rgba(210,228,255,${((1 - k) * .8).toFixed(3)})`; ctx.beginPath();
      ctx.arc(p.x + p.vx * (now - p.born), p.y + p.vy * (now - p.born), 1.6 * (1 - k) + .3, 0, 6.2832); ctx.fill(); }
    logo.style.setProperty("--g", glow.toFixed(3));                  // logo bừng sáng khi sao băng lướt qua
    if (t >= MIN && ((appReady && loaded) || t >= MAX)) finish();
  }

  function finish() {
    if (finished) return; finished = true;
    el.classList.add("out"); resolve();                              // app.js chuyển sang tab Quy trình ngay dưới lớp mờ dần
    setTimeout(() => { cancelAnimationFrame(raf); removeEventListener("resize", size); root.classList.remove("intro-on"); el.remove(); }, 700);
  }
  raf = requestAnimationFrame(frame);
})();
