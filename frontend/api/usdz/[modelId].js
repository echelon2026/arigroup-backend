// GLB -> USDZ conversion, served as a direct file URL.
//
// This is the "AR Code" pattern: instead of loading the full model-viewer/
// WebGL page and only *then* handing off to Quick Look (the previous
// approach, still kept as the iOS fallback in ARViewerModelViewer.js),
// iOS Safari is redirected straight to this URL. A `.usdz` response with
// the right Content-Type is something Safari recognizes and opens directly
// in Quick Look on its own — no page render, no WebGL context, no camera
// permission dance in page JS. The OS owns the whole experience from here,
// which sidesteps the exact class of "black screen / camera init" bugs the
// web-based flow has needed so much defensive code to work around.
//
// Deliberately NOT an Edge Function (unlike model-proxy) — the conversion
// below needs `sharp` (native binary) and meaningfully more CPU/memory than
// Edge allows, so this runs on the standard Vercel Node.js runtime.
//
// Runs the exact same conversion model-viewer's own prepareUSDZ() does on
// individual phones (three.js's USDZExporter) — see ../_lib/usdzExporterNode.js
// for why that couldn't be used completely unmodified in Node — except this
// path pays the cost once, server-side, instead of on every visitor's
// device (a real concern for older/lower-memory iPhones converting a large,
// texture-heavy scan).
import { GLTFLoader } from 'node-three-gltf';
import { Box3, Vector3 } from 'three';
import { USDZExporterNode } from '../_lib/usdzExporterNode.js';

const API_URL = process.env.REACT_APP_API_URL || 'https://arigroup-api.onrender.com';

// Mirrors MAX_AR_METERS in src/pages/ARViewerModelViewer.js — keep these in
// sync. This is the same last-resort real-world size cap applied there,
// just computed here instead of via model-viewer's getDimensions() since
// there's no renderer in this path to ask.
const MAX_AR_METERS = 0.1;

// Render's free tier can take 30-60s to wake from a cold start (see the
// comments in ARViewerModelViewer.js). Budgeted generously, but bounded —
// an upstream that never responds must not hang this function forever.
const UPSTREAM_TIMEOUT_MS = 45000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export const config = {
  // Plain Vercel Serverless Function (Node.js runtime) — no `runtime: 'edge'`
  // export here, unlike model-proxy/[modelId].js, is what puts this on Node.
  maxDuration: 60,
  memory: 1024,
};

export default async function handler(req, res) {
  const { modelId } = req.query;

  if (!modelId || Array.isArray(modelId)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Model ID required');
    return;
  }

  // Any failure below falls back to the existing, already-working
  // client-side flow (model-viewer + on-device prepareUSDZ) rather than
  // leaving the visitor on a dead link — see the `usdz=failed` check in
  // ARViewerModelViewer.js's iOS redirect effect.
  const fallbackUrl = `/view/${encodeURIComponent(modelId)}?usdz=failed`;
  const redirectToFallback = () => {
    res.writeHead(302, { Location: fallbackUrl });
    res.end();
  };

  try {
    const glbRes = await fetchWithTimeout(`${API_URL}/model/${modelId}`, UPSTREAM_TIMEOUT_MS);

    if (!glbRes.ok) {
      console.error(`[usdz] Upstream GLB fetch failed for ${modelId}: HTTP ${glbRes.status}`);
      redirectToFallback();
      return;
    }

    // Best-effort, matching the client-side metadata fetch — a slow/dead
    // metadata endpoint should not block or fail the whole conversion.
    let scale = 1;
    try {
      const infoRes = await fetchWithTimeout(`${API_URL}/model/${modelId}/info`, 8000);
      if (infoRes.ok) {
        const info = await infoRes.json();
        if (Number.isFinite(info?.scale) && info.scale > 0) {
          scale = info.scale;
        }
      }
    } catch (err) {
      console.warn(`[usdz] Metadata fetch failed for ${modelId}, continuing with scale=1:`, err?.message || err);
    }

    const arrayBuffer = await glbRes.arrayBuffer();

    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    const scene = gltf.scene;
    scene.scale.set(scale, scale, scale);
    scene.updateMatrixWorld(true);

    // AR-safe scale cap — same idea as applyArSafeScale() client-side:
    // apply the uploaded model's scale, measure the real size, and shrink
    // further if it's still bigger than a sane tabletop/handheld object.
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (Number.isFinite(maxDim) && maxDim > MAX_AR_METERS) {
      const corrected = scale * (MAX_AR_METERS / maxDim);
      scene.scale.set(corrected, corrected, corrected);
      scene.updateMatrixWorld(true);
    }

    const exporter = new USDZExporterNode();
    const usdzBuffer = await exporter.parseAsync(scene, { quickLookCompatible: true });

    res.writeHead(200, {
      'Content-Type': 'model/vnd.usdz+zip',
      'Content-Disposition': `inline; filename="${modelId}.usdz"`,
      'Content-Length': usdzBuffer.length,
      // Conversion output is deterministic for a given upload — safe to
      // cache client-side/CDN-side across repeat scans of the same QR code.
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(Buffer.from(usdzBuffer));
  } catch (err) {
    console.error(`[usdz] Conversion failed for ${modelId}:`, err);
    redirectToFallback();
  }
}
