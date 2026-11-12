import { useEffect } from 'react';

const MODEL = 'https://arigroup-web.vercel.app/models/astronaut.glb';

// Direct links to REAL existing AR viewers, plus model-viewer as hosted page
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>AR Viewers — Test on Android</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d0d;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:20px 16px 48px}
h1{font-size:20px;font-weight:800;margin-bottom:4px}
.sub{font-size:12px;color:#666;margin-bottom:24px}
.card{background:#181818;border-radius:14px;padding:16px;margin-bottom:12px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.name{font-size:14px;font-weight:700}
.badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;text-transform:uppercase;white-space:nowrap}
.g{background:#0d3d1f;color:#34d058}
.o{background:#3d2200;color:#e37400}
.b{background:#0d1f3d;color:#4a9eff}
.p{background:#1f0d3d;color:#a67cff}
.desc{font-size:11px;color:#888;margin-bottom:12px;line-height:1.5}
a.btn{display:block;text-align:center;background:#e37400;color:#fff;text-decoration:none;padding:11px;border-radius:10px;font:700 13px sans-serif}
a.btn.grey{background:#2a2a2a;color:#ccc}
</style>
</head>
<body>
<h1>AR Viewers — Test Each</h1>
<p class="sub">Open each on your Android phone in Chrome. Tell me which ones work.</p>

<div class="card">
  <div class="row">
    <span class="name">1. Google model-viewer</span>
    <span class="badge g">official</span>
  </div>
  <p class="desc">Google's own web component — taps into Scene Viewer (pre-installed on Android). Tap "View in your space". Most reliable AR path on Android.</p>
  <a class="btn" href="/ar-v1">Open with astronaut →</a>
</div>

<div class="card">
  <div class="row">
    <span class="name">2. TeamZLab AR Viewer</span>
    <span class="badge o">live tool</span>
  </div>
  <p class="desc">Real existing tool — model-viewer based, supports iOS + Android. Opens our astronaut GLB directly via URL param.</p>
  <a class="btn" href="https://tool.teamzlab.com/ar/ar-model-viewer/?model=${encodeURIComponent(MODEL)}" target="_blank">Open with astronaut →</a>
</div>

<div class="card">
  <div class="row">
    <span class="name">3. Geometry Viewer</span>
    <span class="badge o">live tool</span>
  </div>
  <p class="desc">Free online GLB viewer with AR mode. Upload or paste a URL. Paste our model URL when prompted.</p>
  <a class="btn" href="https://geometryviewer.com/glb-viewer" target="_blank">Open (paste model URL) →</a>
</div>

<div class="card">
  <div class="row">
    <span class="name">4. Three.js WebXR live demo</span>
    <span class="badge b">official demo</span>
  </div>
  <p class="desc">Official Three.js WebXR AR hit-test example. Uses their own model but confirms if WebXR surface tracking works on your device at all.</p>
  <a class="btn" href="https://threejs.org/examples/webxr_ar_hittest.html" target="_blank">Open Three.js demo →</a>
</div>

<div class="card">
  <div class="row">
    <span class="name">5. Immersive Web hit-test</span>
    <span class="badge b">Google/W3C</span>
  </div>
  <p class="desc">Official WebXR sample from the W3C Immersive Web group (backed by Google). Tests if hit-test AR works on your device.</p>
  <a class="btn" href="https://immersive-web.github.io/webxr-samples/hit-test.html" target="_blank">Open WebXR sample →</a>
</div>

<div class="card">
  <div class="row">
    <span class="name">6. BASE BROS AR viewer</span>
    <span class="badge p">WebXR based</span>
  </div>
  <p class="desc">Browser-based AR viewer using WebXR. No app download. Upload the GLB to test.</p>
  <a class="btn" href="https://basebros.com/ar.html" target="_blank">Open BASE AR →</a>
</div>

<div class="card">
  <div class="row">
    <span class="name">7. arview.space</span>
    <span class="badge p">free tool</span>
  </div>
  <p class="desc">Free AR viewer, no app needed. Upload the astronaut GLB to place it in your room.</p>
  <a class="btn" href="https://arview.space/free-ar-viewer" target="_blank">Open arview.space →</a>
</div>

<p style="font-size:11px;color:#444;margin-top:24px;text-align:center">
  Model URL (paste where needed):<br/>
  <span style="color:#666;word-break:break-all;font-size:10px">${MODEL}</span>
</p>
</body>
</html>`;

export default function ARLab() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
