// LabMana — Service Worker (offline-first). Pre-cache vỏ ứng dụng + thư viện CDN (KaTeX, Three.js, GSAP, font).
const VERSION = "labmana-v4-3d-5";
const SHELL = [
  "./", "index.html", "formbaocao.html", "css/style.css",
  "js/app.js", "js/store.js", "js/utils.js", "js/firebase.js", "js/drive.js", "js/chem-logic.js", "js/plan-logic.js",
  "js/step-editor.js", "js/ai-compose.js", "js/lab-animator.js",
  "js/tabs/planner.js", "js/tabs/sop.js", "js/tabs/calc.js", "js/tabs/ai.js", "js/tabs/settings.js"
];
const CDN = [
  "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js",   // Three.js (r149, bản build không-module)
  "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",       // GSAP 3
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/mhchem.min.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
];
const CACHEABLE_HOSTS = new Set(["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"]);

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => c.add(u)));
    await Promise.allSettled(CDN.map(u => c.add(new Request(u, { mode: "cors", credentials: "omit" }))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k.startsWith("labmana-")) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), same = url.origin === self.location.origin;
  if (!same && !CACHEABLE_HOSTS.has(url.hostname)) return;   // Firebase / Drive / Apps Script: để trình duyệt tự xử lý
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (same) { // cùng origin: ưu tiên mạng (luôn mới khi online), rơi về cache khi offline
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
      catch { return (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await cache.match("index.html") : Response.error()); }
    }
    const hit = await cache.match(req);                      // CDN: cache-first (URL đã ghim phiên bản)
    if (hit) return hit;
    try { const res = await fetch(req); if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }
    catch { return Response.error(); }
  })());
});
