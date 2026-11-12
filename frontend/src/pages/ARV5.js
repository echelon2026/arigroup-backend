import { useEffect } from 'react';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>AR v5 — MindAR Image Tracking</title>
<script src="https://aframe.io/releases/1.4.0/aframe.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
#topbar{position:fixed;top:0;left:0;right:0;z-index:999;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:10px 60px;gap:10px}
#topbar span{color:#fff;font:600 12px sans-serif}
#back{position:fixed;top:9px;left:12px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:20px;padding:8px 14px;font:700 12px sans-serif;cursor:pointer;z-index:1000}
#show-target{background:#0d9f6e;color:#fff;border:none;border-radius:8px;padding:5px 12px;font:700 11px sans-serif;cursor:pointer}
#loading{position:fixed;inset:0;z-index:998;background:#0a0a0a;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#fff}
#loading.hidden{display:none}
.spinner{width:40px;height:40px;border:3px solid #333;border-top-color:#0d9f6e;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#modal{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);align-items:center;justify-content:center;flex-direction:column;gap:14px}
#modal.open{display:flex}
#modal img{width:min(80vw,300px);border-radius:8px}
#modal p{color:#fff;font:400 13px sans-serif;text-align:center;padding:0 20px}
#close-modal{background:#0d9f6e;color:#fff;border:none;padding:10px 24px;border-radius:8px;font:700 13px sans-serif;cursor:pointer}
#label{position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,.5);color:#888;padding:4px 10px;border-radius:10px;font:600 10px sans-serif;z-index:999}
</style>
</head>
<body>
<div id="topbar">
  <span>5 — MindAR · Point at the target card</span>
  <button id="show-target" onclick="document.getElementById('modal').classList.add('open')">Show target</button>
</div>
<button id="back" onclick="history.back()">← Back</button>
<div id="label">5 — MindAR Image</div>

<div id="loading">
  <div class="spinner"></div>
  <p style="font-size:13px;color:#aaa">Loading MindAR tracker…</p>
</div>

<div id="modal">
  <img src="https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/examples/image-tracking/assets/card-example/card.png" alt="Target"/>
  <p>Point your camera at this card — the astronaut will appear on it</p>
  <button id="close-modal" onclick="document.getElementById('modal').classList.remove('open')">Close &amp; point camera</button>
</div>

<a-scene
  mindar-image="imageTargetSrc:https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/examples/image-tracking/assets/card-example/card.mind;autoStart:true;uiLoading:no;uiError:no;uiScanning:no;"
  color-space="sRGB"
  renderer="colorManagement:true;physicallyCorrectLights:true;"
  vr-mode-ui="enabled:false"
  device-orientation-permission-ui="enabled:false">
  <a-assets>
    <a-asset-item id="model" src="https://arigroup-web.vercel.app/models/astronaut.glb"></a-asset-item>
  </a-assets>
  <a-camera position="0 0 0" look-controls="enabled:false"></a-camera>
  <a-entity mindar-image-target="targetIndex:0">
    <a-gltf-model
      src="#model"
      position="0 0 0.1"
      scale="0.18 0.18 0.18"
      rotation="-90 0 0"
      animation="property:rotation;from:-90 0 0;to:-90 360 0;loop:true;dur:6000;easing:linear">
    </a-gltf-model>
  </a-entity>
</a-scene>

<script>
const scene = document.querySelector('a-scene');
scene.addEventListener('arReady', ()=> document.getElementById('loading').classList.add('hidden'));
scene.addEventListener('loaded', ()=> setTimeout(()=> document.getElementById('loading').classList.add('hidden'), 3000));
</script>
</body>
</html>`;

export default function ARV5() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
