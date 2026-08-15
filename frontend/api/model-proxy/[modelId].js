export const config = {
  runtime: 'edge',
};

const API_URL = 'https://arigroup-api.onrender.com';

export default async (request) => {
  const { modelId } = request.query;

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
