import { useEffect } from 'react';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>AR v3 — A-Frame WebXR</title>
<script src="https://aframe.io/releases/1.5.0/aframe.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
#ui{position:fixed;top:0;left:0;right:0;z-index:999;pointer-events:none}
#info{background:rgba(0,0,0,.72);color:#fff;text-align:center;padding:9px 20px;font:600 13px sans-serif;white-space:nowrap}
#back{position:fixed;top:14px;left:16px;background:rgba(0,0,0,.65);color:#fff;border:none;border-radius:20px;padding:8px 16px;font:700 13px sans-serif;cursor:pointer;z-index:1000;pointer-events:all}
#start{position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:#e37400;color:#fff;border:none;border-radius:12px;padding:14px 40px;font:700 16px sans-serif;cursor:pointer;z-index:1000;display:none}
#label{position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,.5);color:#888;padding:4px 10px;border-radius:10px;font:600 10px sans-serif;z-index:1000}
</style>
</head>
<body>
<div id="ui">
  <div id="info">Loading A-Frame…</div>
</div>
<button id="back" onclick="history.back()">← Back</button>
<button id="start">Start AR</button>
<div id="label">3 — A-Frame WebXR</div>

<a-scene
  id="scene"
  embedded
  vr-mode-ui="enabled:false"
  xr-mode-ui="XRMode:ar"
  webxr="requiredFeatures:hit-test;optionalFeatures:dom-overlay;overlayElement:#ui"
  renderer="colorManagement:true;physicallyCorrectLights:true"
  style="display:none">

  <a-assets>
    <a-asset-item id="model" src="https://arigroup-web.vercel.app/models/astronaut.glb"></a-asset-item>
  </a-assets>

  <a-camera position="0 0 0" look-controls="enabled:false" wasd-controls="enabled:false"></a-camera>

  <a-entity id="reticle"
    geometry="primitive:ring;radiusInner:0.07;radiusOuter:0.09"
    material="color:white;shader:flat;side:double"
    rotation="-90 0 0"
    visible="false">
  </a-entity>

  <a-entity id="placed-model" visible="false">
    <a-entity
      gltf-model="#model"
      scale="0 0 0"
      id="the-model">
    </a-entity>
  </a-entity>

</a-scene>

<script>
const infoEl = document.getElementById('info');
const startBtn = document.getElementById('start');
const sceneEl = document.getElementById('scene');

function setInfo(t){ infoEl.textContent = t; }

// Check WebXR support first
if(navigator.xr){
  navigator.xr.isSessionSupported('immersive-ar').then(ok => {
    if(ok){
      setInfo('A-Frame ready — tap Start AR');
      startBtn.style.display = 'block';
    } else {
      setInfo('WebXR AR not supported on this device');
    }
  }).catch(()=> setInfo('WebXR check failed'));
} else {
  setInfo('WebXR not available in this browser');
}

startBtn.addEventListener('click', () => {
  startBtn.style.display = 'none';
  sceneEl.style.display = 'block';
  setInfo('Starting A-Frame AR…');

  sceneEl.addEventListener('loaded', () => {
    setInfo('Loading model…');
  });

  // Wait for model to load
  const modelAsset = document.getElementById('model');
  modelAsset.addEventListener('loaded', () => {
    setInfo('Model loaded — entering AR…');
    // Auto-enter XR
    setTimeout(() => {
      sceneEl.enterAR().then(() => {
        setInfo('Move phone over a surface…');
        setupHitTest();
      }).catch(e => {
        setInfo('AR failed: ' + e.message);
        startBtn.style.display = 'block';
      });
    }, 500);
  });
  modelAsset.addEventListener('error', e => setInfo('Model error'));
});

function setupHitTest(){
  const reticle = document.getElementById('reticle');
  const placedModel = document.getElementById('placed-model');
  const theModel = document.getElementById('the-model');
  let placed = false;
  let hitTestSource = null;
  let hitTestSourceRequested = false;

  const session = sceneEl.renderer.xr.getSession();
  const refSpacePromise = session.requestReferenceSpace('local');

  refSpacePromise.then(refSpace => {
    session.requestReferenceSpace('viewer').then(viewerSpace => {
      session.requestHitTestSource({ space: viewerSpace }).then(source => {
        hitTestSource = source;
      });
    });

    // Scale model to proper size
    const box = new THREE.Box3().setFromObject(theModel.object3D);
    const sz = box.getSize(new THREE.Vector3());
    const mx = Math.max(sz.x, sz.y, sz.z);
    if(mx > 0) {
      const s = 0.3 / mx;
      theModel.setAttribute('scale', s+' '+s+' '+s);
    }

    sceneEl.renderer.setAnimationLoop((time, frame) => {
      if(!frame) return;
      if(hitTestSource){
        const hits = frame.getHitTestResults(hitTestSource);
        if(hits.length > 0){
          const pose = hits[0].getPose(refSpace);
          const p = pose.transform.position;
          const q = pose.transform.orientation;
          reticle.setAttribute('visible', true);
          reticle.setAttribute('position', p.x+' '+p.y+' '+p.z);
          if(!placed) setInfo('Surface found — tap to place');
        } else {
          reticle.setAttribute('visible', false);
          if(!placed) setInfo('Move slowly over a flat surface…');
        }
      }
      sceneEl.renderer.render(sceneEl.object3D, sceneEl.camera);
    });
  });

  session.addEventListener('select', () => {
    const pos = reticle.getAttribute('position');
    if(!pos || !reticle.getAttribute('visible')) return;
    placedModel.setAttribute('position', pos.x+' '+pos.y+' '+pos.z);
    placedModel.setAttribute('visible', true);
    placed = true;
    setInfo('Placed — tap to move');
  });

  session.addEventListener('end', () => {
    setInfo('AR session ended');
    startBtn.style.display = 'block';
  });
}
</script>
</body>
</html>`;

export default function ARV3() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
