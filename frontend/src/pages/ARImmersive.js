import { useEffect } from 'react';

/*
  Exact replica of immersive-web/webxr-samples hit-test.html
  — same WebXR session setup (local + hit-test reference spaces)
  — same tap-to-place logic (multiple placements, up to 30)
  — Three.js for rendering + our GLB model

  Key fix vs previous attempts:
    requiredFeatures: ['local', 'hit-test']
    local refSpace for rendering/placement (anchors model to world)
    viewer refSpace only for the hit-test ray source
*/

const MODEL_URL = new URLSearchParams(window.location.search).get('model')
  || 'https://arigroup-web.vercel.app/models/astronaut.glb';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>ARIGroup AR</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
#overlay{
  position:fixed;inset:0;z-index:10;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:#000;
  font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  color:#fff;gap:16px;padding:24px;
}
#overlay.hidden{display:none}
#overlay h2{font-size:20px;font-weight:700;text-align:center}
#overlay p{font-size:13px;color:#888;text-align:center;max-width:280px;line-height:1.5}
#start-btn{
  background:#e37400;color:#fff;border:none;border-radius:12px;
  padding:14px 40px;font:700 16px sans-serif;cursor:pointer;
}
#start-btn:disabled{opacity:.4;cursor:default}
#info{
  position:fixed;bottom:50px;left:50%;transform:translateX(-50%);
  background:rgba(0,0,0,.72);color:#fff;
  padding:9px 20px;border-radius:20px;
  font:600 13px sans-serif;white-space:nowrap;
  z-index:10;pointer-events:none;
  display:none;
}
#exit-btn{
  position:fixed;top:20px;right:20px;z-index:20;
  background:rgba(0,0,0,.65);color:#fff;border:none;
  border-radius:20px;padding:9px 18px;
  font:700 13px sans-serif;cursor:pointer;
  display:none;
}
</style>
</head>
<body>
<div id="overlay">
  <h2>AR Viewer</h2>
  <p id="status-p">Checking device…</p>
  <button id="start-btn" disabled>Start AR</button>
</div>

<div id="info">Move phone over a surface…</div>
<button id="exit-btn">✕ Exit</button>

<script type="module">
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/loaders/GLTFLoader.js';

const overlay   = document.getElementById('overlay');
const statusP   = document.getElementById('status-p');
const startBtn  = document.getElementById('start-btn');
const infoEl    = document.getElementById('info');
const exitBtn   = document.getElementById('exit-btn');
const MODEL     = new URLSearchParams(location.search).get('model') || '${MODEL_URL}';

const MAX_PLACED = 30;

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cssText =
  'position:fixed;inset:0;width:100%;height:100%;z-index:1';

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 3, 2); scene.add(sun);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 20);

// ── Reticle (ring on detected surface) ───────────────────────────────────────
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ── Load model template ───────────────────────────────────────────────────────
let modelTemplate = null;
let placed = [];

statusP.textContent = 'Loading model…';
new GLTFLoader().load(MODEL, gltf => {
  modelTemplate = gltf.scene;
  // Normalise to 0.3 m tall
  const box = new THREE.Box3().setFromObject(modelTemplate);
  const sz  = box.getSize(new THREE.Vector3());
  const mx  = Math.max(sz.x, sz.y, sz.z);
  if (mx > 0) modelTemplate.scale.setScalar(0.3 / mx);
  const c = box.getCenter(new THREE.Vector3());
  modelTemplate.position.sub(c.multiplyScalar(0.3 / mx));
  modelTemplate.visible = false;
  scene.add(modelTemplate);

  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(ok => {
      if (ok) {
        statusP.textContent = 'Ready — tap Start AR';
        startBtn.disabled = false;
      } else {
        statusP.textContent = 'WebXR AR not supported on this device.';
      }
    }).catch(() => { statusP.textContent = 'Could not check AR support.'; });
  } else {
    statusP.textContent = 'WebXR not available in this browser.';
  }
}, null, e => { statusP.textContent = 'Model failed: ' + (e.message || e); });

// ── XR state ─────────────────────────────────────────────────────────────────
let xrRefSpace   = null;   // LOCAL — anchors objects to world
let xrViewerSpace = null;  // VIEWER — used only for hit-test ray
let xrHitTestSource = null;

// ── Start session ─────────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  overlay.classList.add('hidden');
  try {
    // EXACT same session request as immersive-web sample
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local', 'hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    });

    renderer.xr.setSession(session);
    infoEl.style.display = 'block';
    exitBtn.style.display = 'block';

    session.addEventListener('end', () => {
      xrHitTestSource?.cancel();
      xrHitTestSource = null;
      infoEl.style.display = 'none';
      exitBtn.style.display = 'none';
      overlay.classList.remove('hidden');
      statusP.textContent = 'Session ended — tap to restart';
      startBtn.disabled = false;
      renderer.setAnimationLoop(null);
    });

    // Viewer space — only for the hit-test ray direction
    xrViewerSpace = await session.requestReferenceSpace('viewer');
    xrHitTestSource = await session.requestHitTestSource({ space: xrViewerSpace });

    // LOCAL space — objects placed here stay fixed in the real world
    xrRefSpace = await session.requestReferenceSpace('local');

    session.addEventListener('select', onSelect);

    renderer.setAnimationLoop(onXRFrame);

  } catch (e) {
    overlay.classList.remove('hidden');
    statusP.textContent = 'AR failed: ' + e.message;
    startBtn.disabled = false;
  }
});

exitBtn.addEventListener('click', () => {
  renderer.xr.getSession()?.end();
});

// ── Tap to place ──────────────────────────────────────────────────────────────
function onSelect() {
  if (!reticle.visible || !modelTemplate) return;

  // Clone model and place at reticle's world matrix
  const clone = modelTemplate.clone();
  clone.visible = true;
  clone.matrix.copy(reticle.matrix);
  clone.matrixAutoUpdate = false;
  scene.add(clone);

  placed.push(clone);
  if (placed.length > MAX_PLACED) {
    scene.remove(placed.shift());
  }

  infoEl.textContent = 'Tap again to place another';
}

// ── Frame loop ────────────────────────────────────────────────────────────────
function onXRFrame(t, frame) {
  if (!frame) return;

  // Get viewer pose in LOCAL space (needed for rendering)
  const pose = frame.getViewerPose(xrRefSpace);
  reticle.visible = false;

  if (xrHitTestSource && pose) {
    const hits = frame.getHitTestResults(xrHitTestSource);
    if (hits.length > 0) {
      // getPose relative to LOCAL space — this is why the model stays put
      const hitPose = hits[0].getPose(xrRefSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(hitPose.transform.matrix);
      infoEl.textContent = 'Surface found — tap to place';
    } else {
      infoEl.textContent = 'Move phone over a surface…';
    }
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
</script>
</body>
</html>`;

export default function ARImmersive() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
