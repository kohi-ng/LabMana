/* Intro LABMANA: nền không gian xanh thẫm sâu, sao nhỏ lấp lánh, logo trắng ở giữa.
 * Script thường (không phải module) để chạy NGAY khi trang vừa dựng, không phải chờ Firebase/CDN.
 * Chỉ chạy ở phiên mới (cờ html.intro-on do đoạn script nhỏ trong <head> đặt). Xong thì app.js chuyển sang tab Quy trình. */
(() => {
  const root = document.documentElement, el = document.getElementById("intro");
  if (!el || !root.classList.contains("intro-on")) return;
  const cv = el.querySelector("canvas"), ctx = cv.getContext("2d"), logo = el.querySelector(".intro-logo");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN = reduce ? 1200 : 3000, MAX = 9000;   // ms: thời gian tối thiểu / tối đa
  let w = 0, h = 0, dpr = 1, stars = [], appReady = false, loaded = document.readyState === "complete", finished = false, raf = 0;
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

  function frame(now) {
    if (finished) return;
    raf = requestAnimationFrame(frame);
    const t = now - (frame.t0 ??= now);
    ctx.globalCompositeOperation = "source-over"; ctx.clearRect(0, 0, w, h);
    for (const s of stars) {                                         // sao nền lấp lánh, trôi chậm
      const x = ((s.x + t * s.vx) % w + w) % w, tw = .55 + .45 * Math.sin(t * s.f * 6 + s.p);
      ctx.fillStyle = `rgba(${s.tint},${(s.a * tw).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, s.y, s.r, 0, 6.2832); ctx.fill();
    }
    logo.style.setProperty("--g", (.3 + .22 * Math.sin(t / 520)).toFixed(3));   // logo "thở" sáng nhẹ
    if (t >= MIN && ((appReady && loaded) || t >= MAX)) finish();
  }

  function finish() {
    if (finished) return; finished = true;
    el.classList.add("out"); resolve();                              // app.js chuyển sang tab Quy trình ngay dưới lớp mờ dần
    setTimeout(() => { cancelAnimationFrame(raf); removeEventListener("resize", size); root.classList.remove("intro-on"); el.remove(); }, 700);
  }
  raf = requestAnimationFrame(frame);
})();
