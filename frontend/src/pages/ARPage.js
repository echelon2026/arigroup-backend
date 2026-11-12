import { useEffect } from 'react';

/*
  Replaces the entire document with a standalone AR HTML page.
  Runs at the same HTTPS origin so camera + WebXR permissions work.
  Based directly on the Three.js webxr_ar_hittest.html example.
*/

const MODEL_URL = new URLSearchParams(window.location.search).get('model')
  || 'https://arigroup-web.vercel.app/models/astronaut.glb';

const AR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"/>
<title>ARIGroup AR Viewer</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;overflow:hidden;background:#000}
  #info{
    position:fixed;top:16px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,.72);color:#fff;padding:9px 20px;
    border-radius:20px;font:600 13px/-apple-system,sans-serif;
    white-space:nowrap;z-index:10;pointer-events:none;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  }
  #ar-btn{
    position:fixed;bottom:60px;left:50%;transform:translateX(-50%);
    background:#e37400;color:#fff;border:none;border-radius:12px;
    font:700 16px/-apple-system,sans-serif;padding:14px 40px;
    cursor:pointer;z-index:10;display:none;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  }
  #back-btn{
    position:fixed;top:16px;left:16px;
    background:rgba(0,0,0,.65);color:#fff;border:none;border-radius:20px;
    font:700 13px/-apple-system,sans-serif;padding:8px 16px;
    cursor:pointer;z-index:10;display:none;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  }
</style>
</head>
<body>
<div id="info">Loading…</div>
<button id="ar-btn">Start AR</button>
<button id="back-btn" onclick="history.back()">← Back</button>
<script type="module">
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/loaders/GLTFLoader.js';

const MODEL = new URLSearchParams(location.search).get('model')
  || '${MODEL_URL}';

const info   = document.getElementById('info');
const arBtn  = document.getElementById('ar-btn');
const back   = document.getElementById('back-btn');

function setInfo(t){ info.textContent = t; }

// ── Scene setup ───────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1,3,2); scene.add(sun);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.01, 20);

// ── Reticle ───────────────────────────────────────────────────────────────────
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI/2),
  new THREE.MeshBasicMaterial({ color:0xffffff, side:THREE.DoubleSide })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ── Load model ────────────────────────────────────────────────────────────────
let model = null;
setInfo('Loading model…');

new GLTFLoader().load(
  MODEL,
  gltf => {
    model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const sz  = box.getSize(new THREE.Vector3());
    const mx  = Math.max(sz.x, sz.y, sz.z);
    if(mx>0) model.scale.setScalar(0.3/mx);
    const c = box.getCenter(new THREE.Vector3());
    model.position.sub(c.multiplyScalar(0.3/mx));
    model.visible = false;
    scene.add(model);

    if(navigator.xr){
      navigator.xr.isSessionSupported('immersive-ar').then(ok => {
        if(ok){
          setInfo('Model ready — tap Start AR');
          arBtn.style.display = 'block';
        } else {
          setInfo('WebXR not supported — trying camera fallback…');
          startCameraFallback();
        }
      }).catch(()=>{ startCameraFallback(); });
    } else {
      setInfo('No WebXR — camera fallback');
      startCameraFallback();
    }
    back.style.display = 'block';
  },
  xhr => {
    if(xhr.total>0) setInfo('Loading model… ' + Math.round(xhr.loaded/xhr.total*100) + '%');
  },
  err => {
    setInfo('Model error: ' + (err.message||'unknown'));
    back.style.display = 'block';
  }
);

// ── WebXR path ────────────────────────────────────────────────────────────────
arBtn.addEventListener('click', async () => {
  arBtn.style.display = 'none';
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    });
    renderer.xr.setSession(session);

    let hitSrc = null, requested = false, placed = false;

    session.addEventListener('select', () => {
      if(!model || !reticle.visible) return;
      model.position.setFromMatrixPosition(reticle.matrix);
      model.visible = true;
      placed = true;
      setInfo('Placed! Tap to move');
    });

    session.addEventListener('end', () => {
      requested = false; hitSrc = null;
      renderer.setAnimationLoop(null);
      setInfo('AR session ended');
      arBtn.style.display = 'block';
    });

    renderer.setAnimationLoop((_, frame) => {
      if(!frame) return;
      const ref = renderer.xr.getReferenceSpace();
      const ses = renderer.xr.getSession();

      if(!requested){
        ses.requestReferenceSpace('viewer').then(vs =>
          ses.requestHitTestSource({ space: vs }).then(s => { hitSrc = s; })
        );
        requested = true;
      }

      if(hitSrc){
        const hits = frame.getHitTestResults(hitSrc);
        if(hits.length > 0){
          reticle.visible = true;
          reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix);
          if(!placed) setInfo('Surface found — tap to place');
        } else {
          reticle.visible = false;
          if(!placed) setInfo('Move phone slowly over a surface…');
        }
      }
      renderer.render(scene, camera);
    });

  } catch(e) {
    setInfo('AR error: ' + e.message);
    arBtn.style.display = 'block';
  }
});

// ── Camera fallback (no WebXR) ────────────────────────────────────────────────
function startCameraFallback(){
  if(model){ model.visible = true; model.position.set(0,0,-1.5); }

  navigator.mediaDevices.getUserMedia({
    video:{ facingMode:'environment' }, audio:false
  }).then(stream => {
    const vid = document.createElement('video');
    vid.autoplay = true; vid.muted = true; vid.playsInline = true;
    vid.srcObject = stream; vid.play();
    scene.background = new THREE.VideoTexture(vid);
  }).catch(()=>{});

  let a0=null, b0=null;
  window.addEventListener('deviceorientation', e => {
    if(a0===null){ a0=e.alpha; b0=e.beta; }
    camera.rotation.set(
      THREE.MathUtils.degToRad((e.beta-b0)*0.5),
      THREE.MathUtils.degToRad(-(e.alpha-a0)*0.5),
      0, 'YXZ'
    );
  });

  renderer.setAnimationLoop(() => {
    if(model) model.rotation.y += 0.009;
    renderer.render(scene, camera);
  });

  setInfo('Gyroscope mode — model in front of you');
  back.style.display = 'block';
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
</script>
</body>
</html>`;

export default function ARPage() {
  useEffect(() => {
    document.open();
    document.write(AR_HTML);
    document.close();
  }, []);
  return null;
}
