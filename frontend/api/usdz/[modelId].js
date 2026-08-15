// Serve pre-converted USDZ from backend for iOS AR
//
// When GLB models are uploaded to the backend, they're automatically converted
// to USDZ at upload time (not on-the-fly). This endpoint simply proxies the
// pre-converted USDZ file from the backend to the client, with proper headers
// for iOS Quick Look recognition.

const API_URL = process.env.REACT_APP_API_URL || 'https://arigroup-api.onrender.com';
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
  maxDuration: 30,
};

export default async function handler(req, res) {
  const { modelId } = req.query;

  if (!modelId || Array.isArray(modelId)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Model ID required');
    return;
  }

  // Fallback to web-based AR if USDZ unavailable
  const fallbackUrl = `/view/${encodeURIComponent(modelId)}?usdz=failed`;
  const redirectToFallback = () => {
    res.writeHead(302, { Location: fallbackUrl });
    res.end();
  };

  try {
    // Fetch pre-converted USDZ from backend
    const usdzRes = await fetchWithTimeout(
      `${API_URL}/model/${modelId}/usdz`,
      UPSTREAM_TIMEOUT_MS
    );

    if (!usdzRes.ok) {
      console.error(`[usdz-proxy] Backend USDZ fetch failed for ${modelId}: HTTP ${usdzRes.status}`);
      redirectToFallback();
      return;
    }

    const usdzBuffer = await usdzRes.arrayBuffer();

    res.writeHead(200, {
      'Content-Type': 'model/vnd.usdz+zip',
      'Content-Disposition': `inline; filename="${modelId}.usdz"`,
      'Content-Length': usdzBuffer.byteLength,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(Buffer.from(usdzBuffer));
  } catch (err) {
    console.error(`[usdz-proxy] Fetch failed for ${modelId}:`, err);
    redirectToFallback();
  }
}
