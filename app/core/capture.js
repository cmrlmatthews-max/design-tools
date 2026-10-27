/* ==========================================================================
   CORE: capture (app/CONTRACT.md section 8)
   Pictures of the shared view through src/shared/screenshot.js.

   captureImage(scene, { aiReady, title, rows, hooks, scale, mark, date }) -> Promise<Blob>
   - Normal image: the view as it is (no overlay group, no panel offset), with a title, date, metric rows and the
     CMRLM mark drawn on top (dark panels).
   - AI-ready image (aiReady true): every hook(true) runs first (the layers recolor: hero amber, the rest white), then the
     grid, the scale figure, the overlay group and the site boundary and north arrow hide, the sky and ground go plain
     light, and the frame is drawn and copied. Then every hook(false) runs and everything comes back. No overlay text.
   deliver(blob, name) -> 'shared' | 'cancelled' | 'downloaded'   (share sheet on iPad, download elsewhere)
   ========================================================================== */
import { captureView, deliverImage, screenshotFilename } from '../../src/shared/screenshot.js';

const runHooks = (hooks, on) => {
  for (const fn of Array.isArray(hooks) ? hooks : []) {
    try { if (typeof fn === 'function') fn(on); } catch (e) { console.error(e); }
  }
};

export async function captureImage(scene, { aiReady = false, title = '', rows = [], hooks = [], scale = 2, mark = 'CMRLM', date = true } = {}) {
  if (!scene || !scene.renderer) throw new Error('The 3D view is not available.');
  let restore = null;
  let pending;
  if (aiReady) runHooks(hooks, true);
  try {
    restore = scene.prepareCapture({ aiReady });
    const overlay = aiReady ? undefined : {
      theme: 'dark',
      title: title ? String(title) : undefined,
      date: date || undefined,
      metrics: (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && r.length >= 2).slice(0, 8),
      mark: mark || undefined,
    };
    // captureView draws and copies the frame before its first await, so the scene can come back straight away.
    pending = captureView({ renderer: scene.renderer, scene: scene.scene, camera: scene.camera(), scale, overlay });
  } finally {
    if (restore) { try { restore(); } catch (e) { console.error(e); } }
    if (aiReady) runHooks(hooks, false);
    try { scene.requestRender(); } catch (e) { /* no scene */ }
  }
  return await pending;
}

/** Shares (iPad) or downloads the image as `<name>-YYYY-MM-DD.png`. */
export async function deliver(blob, name) {
  return deliverImage(blob, screenshotFilename(name || 'view'));
}
