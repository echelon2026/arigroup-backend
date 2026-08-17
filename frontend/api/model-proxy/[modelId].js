export const config = {
  runtime: 'edge',
};

const API_URL = 'https://arigroup-api.onrender.com';

export default async (request) => {
  let modelId;
  try {
    const url = new URL(request.url);
    modelId = url.pathname.split('/').pop();

    if (!modelId) {
      return new Response('Model ID required', { status: 400 });
    }
  } catch (parseErr) {
    console.error('URL parse error:', parseErr);
    return new Response(`URL parse failed: ${parseErr.message}`, { status: 400 });
  }

  try {
    const modelUrl = `${API_URL}/model/${modelId}`;

    const reqHeaders = {};
    const range = request.headers.get('range');
    if (range) {
      reqHeaders['range'] = range;
    }

    const upstream = await fetch(modelUrl, {
      headers: reqHeaders,
    });

    const respHeaders = {};
    if (upstream.headers.get('content-type')) {
      respHeaders['content-type'] = upstream.headers.get('content-type');
    }
    if (upstream.headers.get('content-length')) {
      respHeaders['content-length'] = upstream.headers.get('content-length');
    }
    if (upstream.headers.get('accept-ranges')) {
      respHeaders['accept-ranges'] = upstream.headers.get('accept-ranges');
    }
    if (upstream.headers.get('cache-control')) {
      respHeaders['cache-control'] = upstream.headers.get('cache-control');
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    console.error(`[model-proxy] Error fetching model ${modelId}:`, err.message);
    return new Response(`Failed to fetch model: ${err.message}`, {
      status: 500,
      headers: { 'content-type': 'text/plain' }
    });
  }
};
