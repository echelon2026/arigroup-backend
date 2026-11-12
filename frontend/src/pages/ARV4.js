import { useEffect } from 'react';

// AR.js existing code, served as React route
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>AR v4 — AR.js Hiro Marker</title>
<script src="https://aframe.io/releases/1.4.0/aframe.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.5/aframe/build/aframe-ar.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
#topbar{position:fixed;top:0;left:0;right:0;z-index:999;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:10px 60px;gap:10px}
#topbar span{color:#fff;font:600 12px sans-serif}
#back{position:fixed;top:9px;left:12px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:20px;padding:8px 14px;font:700 12px sans-serif;cursor:pointer;z-index:1000}
#show-marker{background:#e37400;color:#fff;border:none;border-radius:8px;padding:5px 12px;font:700 11px sans-serif;cursor:pointer}
#modal{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);align-items:center;justify-content:center;flex-direction:column;gap:14px}
#modal.open{display:flex}
#modal img{width:min(80vw,300px);border:8px solid #fff;border-radius:8px}
#modal p{color:#fff;font:400 13px sans-serif;text-align:center;padding:0 20px}
#close-modal{background:#555;color:#fff;border:none;padding:10px 24px;border-radius:8px;font:700 13px sans-serif;cursor:pointer}
#label{position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,.5);color:#888;padding:4px 10px;border-radius:10px;font:600 10px sans-serif;z-index:999}
</style>
</head>
<body>
<div id="topbar">
  <span>4 — AR.js · Point at the Hiro marker</span>
  <button id="show-marker" onclick="document.getElementById('modal').classList.add('open')">Show marker</button>
</div>
<button id="back" onclick="history.back()">← Back</button>
<div id="label">4 — AR.js Hiro</div>

<div id="modal">
  <img src="https://raw.githubusercontent.com/AR-js-org/AR.js/master/data/images/hiro.png" alt="Hiro"/>
  <p>Show this on another screen and point your camera at it</p>
  <button id="close-modal" onclick="document.getElementById('modal').classList.remove('open')">Close &amp; start</button>
</div>

<a-scene
  embedded
  arjs="sourceType:webcam;debugUIEnabled:false;detectionMode:mono_and_matrix;matrixCodeType:3x3;"
  vr-mode-ui="enabled:false"
  renderer="logarithmicDepthBuffer:true;precision:medium;">
  <a-assets>
    <a-asset-item id="model" src="https://arigroup-web.vercel.app/models/astronaut.glb"></a-asset-item>
  </a-assets>
  <a-marker preset="hiro">
    <a-entity
      gltf-model="#model"
      scale="0.4 0.4 0.4"
      position="0 0.2 0"
      animation="property:rotation;to:0 360 0;loop:true;dur:6000;easing:linear">
    </a-entity>
  </a-marker>
  <a-entity camera></a-entity>
</a-scene>
</body>
</html>`;

export default function ARV4() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
