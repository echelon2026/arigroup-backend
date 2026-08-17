export const config = {
  runtime: 'edge',
};

const API_URL = 'https://arigroup-api.onrender.com';

export default async (request) => {
  let modelId = null;

  // Vercel Edge Functions: use nextUrl (Vercel's enhancement to Web API)
  if (request.nextUrl?.pathname) {
    const segments = request.nextUrl.pathname.split('/');
    modelId = segments[segments.length - 1];
  }

  // Fallback: parse from request.url directly
  if (!modelId) {
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split('/');
      modelId = segments[segments.length - 1];
    } catch (e) {
      // continue to error below
    }
  }

  if (!modelId) {
    return new Response('Model ID required', { status: 400 });
  }

  try {
    const modelUrl = `${API_URL}/model/${modelId}`;

    // Forward Range header if present (for chunked loading)
    const headers = {};
    const range = request.headers.get('range');
    if (range) {
      headers['range'] = range;
    }

    const upstream = await fetch(modelUrl, {
      headers,
      // Follow redirects, don't error on non-2xx
    });

    // Return upstream response with its headers intact
    // This preserves Content-Type, Content-Length, Content-Range, ETag, etc.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (err) {
    console.error(`[model-proxy] Error fetching model ${modelId}:`, err);
    return new Response(`Failed to fetch model: ${err.message}`, {
      status: 500
    });
  }
};
