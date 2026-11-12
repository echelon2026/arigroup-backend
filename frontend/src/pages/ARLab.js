import { useEffect } from 'react';

/*  Landing page — links to 5 different Android AR approaches  */

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>AR Lab — Pick a viewer</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d0d;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh;padding:24px 16px 40px}
h1{font-size:22px;font-weight:800;margin-bottom:4px}
p.sub{font-size:13px;color:#888;margin-bottom:28px}
.card{background:#1a1a1a;border-radius:14px;padding:18px 16px;margin-bottom:14px;display:flex;flex-direction:column;gap:8px}
.card h2{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}
.badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;text-transform:uppercase}
.b-green{background:#0d3d1f;color:#34d058}
.b-orange{background:#3d2200;color:#e37400}
.b-blue{background:#0d1f3d;color:#4a9eff}
.b-purple{background:#1f0d3d;color:#a67cff}
.b-red{background:#3d0d0d;color:#ff6b6b}
.card p{font-size:12px;color:#999;line-height:1.5}
a.btn{display:inline-block;margin-top:4px;background:#e37400;color:#fff;text-decoration:none;padding:10px 22px;border-radius:10px;font-size:13px;font-weight:700}
</style>
</head>
<body>
<h1>AR Viewer Lab</h1>
<p class="sub">Test each approach — tell us which works on your phone</p>

<div class="card">
  <h2>1 — Google model-viewer <span class="badge b-green">most reliable</span></h2>
  <p>Google's official web component. Tap "View in your space" — opens Scene Viewer (pre-installed on Android). Best chance of surface tracking working out of the box.</p>
  <a class="btn" href="/ar-v1">Open →</a>
</div>

<div class="card">
  <h2>2 — WebXR hit-test <span class="badge b-orange">surface tracking</span></h2>
  <p>Three.js + WebXR API. Camera opens in-browser, white ring appears on detected surfaces, tap to place model. Needs Google Play Services for AR (pre-installed on most phones).</p>
  <a class="btn" href="/ar-v2">Open →</a>
</div>

<div class="card">
  <h2>3 — A-Frame WebXR <span class="badge b-orange">surface tracking</span></h2>
  <p>Same WebXR hit-test but via A-Frame. Slightly different rendering pipeline — worth testing if v2 fails.</p>
  <a class="btn" href="/ar-v3">Open →</a>
</div>

<div class="card">
  <h2>4 — AR.js Hiro marker <span class="badge b-blue">always works</span></h2>
  <p>100% works without any downloads. Point camera at the Hiro marker shown on screen. Model appears anchored to the marker.</p>
  <a class="btn" href="/ar-v4">Open →</a>
</div>

<div class="card">
  <h2>5 — MindAR image target <span class="badge b-purple">image tracking</span></h2>
  <p>Point camera at a target card. No marker needed — just an image. Works without downloads. Good for restaurant menus (put target on menu).</p>
  <a class="btn" href="/ar-v5">Open →</a>
</div>

</body>
</html>`;

export default function ARLab() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
