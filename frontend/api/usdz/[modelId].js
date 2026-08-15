// GLB served directly as a ".usdz" response, no server-side conversion.
//
// This is the "AR Code" pattern: instead of loading the full model-viewer/
// WebGL page and only *then* handing off to Quick Look (the previous
// approach, still kept as the iOS fallback in ARViewerModelViewer.js),
// iOS Safari is redirected straight to this URL. A response with a
// `model/vnd.usdz+zip` Content-Type is something Safari recognizes and
// opens directly in Quick Look on its own — no page render, no WebGL
// context, no camera permission dance in page JS. The OS owns the whole
// experience from here, which sidesteps the exact class of "black screen /
// camera init" bugs the web-based flow has needed so much defensive code to
// work around.
//
// NOTE: this endpoint does NOT actually convert GLB -> USDZ. It was
// previously doing a real conversion server-side via node-three-gltf +
// three.js's USDZExporter (see git history / ../_lib/usdzExporterNode.js),
// but that pulled in sharp (a native binary) plus three/node-three-gltf on
// the Vercel Node.js serverless runtime, which was crashing the function
// with FUNCTION_INVOCATION_FAILED (native binary mismatch on Vercel's
// build/runtime image, and/or missing deps in the deployed bundle).
//
// Since USDZ is a zip archive and GLB is not, this is NOT a spec-correct
// USDZ file — it's a bet that Quick Look on at least some iOS versions is
// lenient enough to open a glTF-binary payload served with the USDZ
// Content-Type. If/when this turns out to be insufficient, the options are:
//   (a) reintroduce server-side conversion using a pure-JS USDZ exporter
//       that doesn't need sharp/native binaries, or run it on a runtime
//       that supports native deps reliably, or
//   (b) drop this endpoint and rely solely on the existing client-side
//       model-viewer + on-device prepareUSDZ() flow (the `usdz=failed`
//       fallback already wired up in ARViewerModelViewer.js).
const API_URL = process.env.REACT_APP_API_URL || 'https://arigroup-api.onrender.com';

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
  // Kept on Node (rather than moved to Edge) since this is the same
  // execution environment the real conversion previously needed, and
  // keeping this endpoint's runtime stable minimizes the diff if server-side
  // conversion is reintroduced later.
  maxDuration: 30,
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

    const arrayBuffer = await glbRes.arrayBuffer();

    res.writeHead(200, {
      'Content-Type': 'model/vnd.usdz+zip',
      'Content-Disposition': `inline; filename="${modelId}.usdz"`,
      'Content-Length': arrayBuffer.byteLength,
      // Upstream GLB is immutable per modelId — safe to cache client-side/
      // CDN-side across repeat scans of the same QR code.
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(`[usdz] Fetch failed for ${modelId}:`, err);
    redirectToFallback();
  }
}
