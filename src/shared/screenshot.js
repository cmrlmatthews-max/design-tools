/* ==========================================================================
   SHARED: screenshot
   Capture a three.js view at higher resolution, annotate it on a 2D canvas,
   and deliver the PNG (share sheet on iPad, download elsewhere).

   No dependency on three: the renderer is only used through its public API.
   Does not need preserveDrawingBuffer (the frame is copied in the same task
   it is rendered in).
   ========================================================================== */

const FONT_STACK = '-apple-system, "SF Pro Text", "Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Total pixel budget. iOS Safari limits a canvas to 16,777,216 px (4096 x 4096). */
export const DEFAULT_MAX_PIXELS = 16000000;

/* Duck-typed targets so we do not need THREE.Vector2 / Vector4. */
function vec2() { return { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } }; }
function vec4() {
  return {
    x: 0, y: 0, z: 0, w: 0,
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; },
  };
}

/** Largest scale <= requested that fits the GPU and canvas limits. */
function fitScale(renderer, baseW, baseH, scale, maxPixels) {
  let s = scale;
  let maxDim = Infinity;
  try {
    const gl = renderer.getContext();
    maxDim = Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || Infinity,
      gl.getParameter(gl.MAX_TEXTURE_SIZE) || Infinity
    );
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    if (vp) maxDim = Math.min(maxDim, vp[0], vp[1]);
  } catch (e) { /* ignore */ }
  maxDim = Math.min(maxDim, 16384);
  s = Math.min(s, maxDim / baseW, maxDim / baseH);
  const px = baseW * baseH;
  if (px * s * s > maxPixels) s = Math.sqrt(maxPixels / px);
  return Math.max(s, 1 / Math.max(baseW, baseH));     // never zero
}

/**
 * Renders the scene at `scale` x the renderer's current drawing-buffer size and
 * returns a PNG Blob with the overlay drawn on top.
 *
 * @param {object}   o
 * @param {object}   o.renderer  THREE.WebGLRenderer
 * @param {object}   o.scene
 * @param {object}   o.camera
 * @param {number}   [o.scale=2]
 * @param {object}   [o.overlay]  { title?, date?, metrics?: Array<[label,value]>, mark?: "CMRLM", theme?: "light"|"dark" }
 *                                 date: string | Date | true (today)
 * @param {Function} [o.render]  optional (renderer, scene, camera) => void replacing renderer.render
 *                               (for custom viewports); called at the capture size and again after restore
 * @param {number}   [o.maxPixels=16000000]  scale is reduced to stay within this budget and GPU limits
 * @returns {Promise<Blob>} image/png. blob.captureInfo = { width, height, scale, requestedScale }
 */
export async function captureView({ renderer, scene, camera, scale = 2, overlay, render, maxPixels = DEFAULT_MAX_PIXELS } = {}) {
  if (!renderer || !scene || !camera) throw new Error("captureView needs renderer, scene and camera.");

  const canvas3d = renderer.domElement;
  const draw = typeof render === "function"
    ? () => render(renderer, scene, camera)
    : () => renderer.render(scene, camera);

  /* ---- remember everything we will change ---- */
  const size = renderer.getSize(vec2());
  const cssW = size.x, cssH = size.y;
  const pr = renderer.getPixelRatio();
  const baseW = canvas3d.width, baseH = canvas3d.height;        // current drawing-buffer size
  const viewport = renderer.getViewport(vec4());
  const scissor = renderer.getScissor(vec4());
  const scissorTest = renderer.getScissorTest();
  const aspect = camera.isPerspectiveCamera ? camera.aspect : null;

  const eff = fitScale(renderer, baseW, baseH, scale, maxPixels);
  const W = Math.max(1, Math.round(baseW * eff));
  const H = Math.max(1, Math.round(baseH * eff));

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas for the screenshot.");

  const setBuffer = (w, h, ratio) => {
    // pixel ratio 1 with an explicit size gives an exact W x H buffer; style is never touched
    if (typeof renderer.setDrawingBufferSize === "function") renderer.setDrawingBufferSize(w, h, ratio);
    else { renderer.setPixelRatio(ratio); renderer.setSize(w, h, false); }
  };

  try {
    setBuffer(W, H, 1);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    if (aspect !== null) { camera.aspect = W / H; camera.updateProjectionMatrix(); }

    draw();
    // Copy NOW, in the same task as the render (works without preserveDrawingBuffer).
    ctx.drawImage(canvas3d, 0, 0, W, H);
  } finally {
    /* ---- restore everything, then repaint the live view ---- */
    setBuffer(cssW, cssH, pr);
    renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
    renderer.setScissor(scissor.x, scissor.y, scissor.z, scissor.w);
    renderer.setScissorTest(scissorTest);
    if (aspect !== null) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
    try { draw(); } catch (e) { /* the app's own loop will repaint */ }
  }

  /* ---- overlay, sized in "CSS pixels of the original view" so it matches the app's look ---- */
  if (overlay) drawOverlay(ctx, W, H, W / Math.max(1, cssW), overlay);

  const blob = await canvasToBlob(out);
  try { blob.captureInfo = { width: W, height: H, scale: eff, requestedScale: scale }; } catch (e) { /* ignore */ }
  return blob;
}

/* ---------- overlay ---------- */

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatDate(d) {
  if (d === true) d = new Date();
  if (d instanceof Date) {
    try { return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  return String(d);
}

/** Draw text with manual letter spacing (canvas letterSpacing is not in every Safari). */
function spacedWidth(ctx, text, tracking) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}
function drawSpaced(ctx, text, x, y, tracking) {
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
}

function drawOverlay(ctx, W, H, u, overlay) {
  const dark = overlay.theme === "dark";
  const panel = dark ? "rgba(23, 27, 31, 0.86)" : "rgba(255, 255, 255, 0.88)";
  const edge = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(16, 20, 26, 0.14)";
  const ink = dark ? "#e7eaee" : "#1b1f24";
  const ink2 = dark ? "#a5adb7" : "#4e5763";
  const m = 16 * u;           // outer margin
  const pad = 10 * u;         // panel padding
  const radius = 8 * u;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = Math.max(1, u);

  const box = (x, y, w, h) => {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = panel; ctx.fill();
    ctx.strokeStyle = edge; ctx.stroke();
  };

  /* title + date, top-left */
  const title = overlay.title ? String(overlay.title) : "";
  const date = overlay.date ? formatDate(overlay.date) : "";
  if (title || date) {
    const tSize = 17 * u, dSize = 12 * u;
    ctx.font = `600 ${tSize}px ${FONT_STACK}`;
    const tw = title ? ctx.measureText(title).width : 0;
    ctx.font = `400 ${dSize}px ${FONT_STACK}`;
    const dw = date ? ctx.measureText(date).width : 0;
    const w = Math.max(tw, dw) + pad * 2;
    const h = pad * 2 + (title ? tSize : 0) + (title && date ? 5 * u : 0) + (date ? dSize : 0);
    box(m, m, w, h);
    let y = m + pad;
    if (title) {
      y += tSize * 0.82;
      ctx.font = `600 ${tSize}px ${FONT_STACK}`;
      ctx.fillStyle = ink; ctx.fillText(title, m + pad, y);
      y += tSize * 0.18 + 5 * u;
    }
    if (date) {
      y += dSize * 0.82;
      ctx.font = `400 ${dSize}px ${FONT_STACK}`;
      ctx.fillStyle = ink2; ctx.fillText(date, m + pad, y);
    }
  }

  /* metrics, bottom-left */
  const rows = Array.isArray(overlay.metrics) ? overlay.metrics.filter((r) => Array.isArray(r) && r.length >= 2) : [];
  if (rows.length) {
    const size = 12.5 * u, rowH = 19 * u, gap = 18 * u;
    ctx.font = `400 ${size}px ${FONT_STACK}`;
    let lw = 0;
    for (const [l] of rows) lw = Math.max(lw, ctx.measureText(String(l)).width);
    ctx.font = `600 ${size}px ${FONT_STACK}`;
    let vw = 0;
    for (const [, v] of rows) vw = Math.max(vw, ctx.measureText(String(v)).width);
    const w = pad * 2 + lw + gap + vw;
    const h = pad * 2 + rowH * rows.length - (rowH - size);
    const x = m, y = H - m - h;
    box(x, y, w, h);
    rows.forEach(([l, v], i) => {
      const by = y + pad + size * 0.9 + i * rowH;
      ctx.textAlign = "left";
      ctx.font = `400 ${size}px ${FONT_STACK}`;
      ctx.fillStyle = ink2; ctx.fillText(String(l), x + pad, by);
      ctx.textAlign = "right";
      ctx.font = `600 ${size}px ${FONT_STACK}`;
      ctx.fillStyle = ink; ctx.fillText(String(v), x + w - pad, by);
    });
    ctx.textAlign = "left";
  }

  /* mark, bottom-right */
  if (overlay.mark) {
    const text = String(overlay.mark).toUpperCase();
    const size = 11 * u, tracking = 3 * u, padX = 10 * u, padY = 7 * u;
    ctx.font = `600 ${size}px ${FONT_STACK}`;
    const tw = spacedWidth(ctx, text, tracking);
    const w = tw + padX * 2, h = size + padY * 2;
    const x = W - m - w, y = H - m - h;
    box(x, y, w, h);
    ctx.fillStyle = ink2;
    drawSpaced(ctx, text, x + padX, y + padY + size * 0.82, tracking);
  }

  ctx.restore();
}

/* ---------- output ---------- */

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    const fallback = () => {
      try {
        const url = canvas.toDataURL("image/png");
        const bin = atob(url.split(",")[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type: "image/png" }));
      } catch (e) {
        reject(new Error("The screenshot could not be created (image too large for this device)."));
      }
    };
    try {
      canvas.toBlob((b) => (b ? resolve(b) : fallback()), "image/png");
    } catch (e) { fallback(); }
  });
}

function isTouchApple() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS reports a Mac user agent; it is the only "Mac" with a touch screen
  return /Mac/.test(navigator.platform || ua) && (navigator.maxTouchPoints || 0) > 1;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);   // revoking sooner can break iOS downloads
}

/**
 * iPad (touch Apple device): share sheet with the PNG file. Everything else, or
 * if sharing is unavailable/fails: download through a temporary <a download>.
 * A cancelled share sheet (AbortError) does nothing.
 *
 * @param {Blob}   blob
 * @param {string} filename
 * @param {object} [opts]  { share: "auto" | "always" | "never" }  "auto" = only on iPad/iPhone
 * @returns {Promise<"shared"|"cancelled"|"downloaded">}
 */
export async function deliverImage(blob, filename, { share = "auto" } = {}) {
  const useShare = share === "always" || (share === "auto" && isTouchApple());
  if (useShare && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      const file = new File([blob], filename, { type: blob.type || "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      }
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
      // NotAllowedError (user activation expired) or anything else: fall through to download
    }
  }
  download(blob, filename);
  return "downloaded";
}

/** `title-YYYY-MM-DD.png`, safe for file systems. */
export function screenshotFilename(name = "tower", date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const slug = String(name).trim().replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "view";
  return `${slug}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.png`;
}
