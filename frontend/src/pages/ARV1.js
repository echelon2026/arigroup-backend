import { useEffect } from 'react';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>AR v1 — model-viewer</title>
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#111}
model-viewer{width:100%;height:100%}
#back{position:fixed;top:16px;left:16px;z-index:99;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:20px;padding:8px 16px;font:700 13px sans-serif;cursor:pointer}
#label{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:6px 16px;border-radius:20px;font:600 12px sans-serif;white-space:nowrap}
</style>
</head>
<body>
<div id="label">1 — Google model-viewer</div>
<button id="back" onclick="history.back()">← Back</button>
<model-viewer
  src="https://arigroup-web.vercel.app/models/astronaut.glb"
  alt="Astronaut"
  ar
  ar-modes="scene-viewer webxr quick-look"
  ar-scale="fixed"
  camera-controls
  auto-rotate
  shadow-intensity="1"
  style="background:#111">
  <button slot="ar-button"
    style="position:absolute;bottom:32px;left:50%;transform:translateX(-50%);
    background:#e37400;color:#fff;border:none;border-radius:12px;
    padding:14px 32px;font:700 16px sans-serif;cursor:pointer">
    View in your space
  </button>
</model-viewer>
</body>
</html>`;

export default function ARV1() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
