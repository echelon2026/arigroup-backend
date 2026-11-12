import { useEffect } from 'react';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>AR v2 — WebXR hit-test</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
#info{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.72);color:#fff;padding:9px 20px;border-radius:20px;font:600 13px sans-serif;white-space:nowrap;z-index:10;pointer-events:none}
#start{position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:#e37400;color:#fff;border:none;border-radius:12px;padding:14px 40px;font:700 16px sans-serif;cursor:pointer;z-index:10;display:none}
#back{position:fixed;top:16px;left:16px;background:rgba(0,0,0,.65);color:#fff;border:none;border-radius:20px;padding:8px 16px;font:700 13px sans-serif;cursor:pointer;z-index:10}
#label{position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,.5);color:#888;padding:4px 10px;border-radius:10px;font:600 10px sans-serif}
</style>
</head>
<body>
<div id="info">Loading…</div>
<button id="start">Start AR</button>
<button id="back" onclick="history.back()">← Back</button>
<div id="label">2 — WebXR hit-test</div>
<script type="module">
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/loaders/GLTFLoader.js';

const MODEL = 'https://arigroup-web.vercel.app/models/astronaut.glb';
const info  = document.getElementById('info');
const startBtn = document.getElementById('start');
const setInfo = t => info.textContent = t;

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff,0x888888,2));
const dl = new THREE.DirectionalLight(0xffffff,1.5); dl.position.set(1,3,2); scene.add(dl);

const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.01, 20);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.07,0.09,32).rotateX(-Math.PI/2),
  new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide})
);
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

let model = null;
setInfo('Loading model…');
new GLTFLoader().load(MODEL, gltf => {
  model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const mx = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  if(mx>0) model.scale.setScalar(0.3/mx);
  model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(0.3/mx));
  model.visible = false; scene.add(model);

  navigator.xr?.isSessionSupported('immersive-ar').then(ok => {
    if(ok){ setInfo('Ready — tap Start AR'); startBtn.style.display='block'; }
    else  { setInfo('WebXR not supported on this device'); }
  }).catch(()=> setInfo('WebXR check failed'));
}, null, e => setInfo('Model error: '+e.message));

startBtn.addEventListener('click', async () => {
  startBtn.style.display='none';
  try{
    const session = await navigator.xr.requestSession('immersive-ar',{
      requiredFeatures:['hit-test'],
      optionalFeatures:['dom-overlay'],
      domOverlay:{ root:document.body }
    });
    renderer.xr.setSession(session);

    let hitSrc=null, requested=false, placed=false;

    session.addEventListener('select', ()=>{
      if(!model||!reticle.visible) return;
      model.position.setFromMatrixPosition(reticle.matrix);
      model.visible = true; placed = true;
      setInfo('Placed — tap to move');
    });
    session.addEventListener('end', ()=>{
      requested=false; hitSrc=null;
      renderer.setAnimationLoop(null);
      setInfo('Session ended'); startBtn.style.display='block';
    });

    renderer.setAnimationLoop((_,frame)=>{
      if(!frame) return;
      const ref = renderer.xr.getReferenceSpace();
      const ses = renderer.xr.getSession();
      if(!requested){
        ses.requestReferenceSpace('viewer').then(vs=>
          ses.requestHitTestSource({space:vs}).then(s=>{ hitSrc=s; })
        );
        requested=true;
      }
      if(hitSrc){
        const hits = frame.getHitTestResults(hitSrc);
        if(hits.length){
          reticle.visible=true;
          reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix);
          if(!placed) setInfo('Surface found — tap to place');
        } else { reticle.visible=false; if(!placed) setInfo('Move slowly over a flat surface…'); }
      }
      renderer.render(scene, camera);
    });
  } catch(e){ setInfo('Error: '+e.message); startBtn.style.display='block'; }
});

window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});
</script>
</body>
</html>`;

export default function ARV2() {
  useEffect(() => { document.open(); document.write(HTML); document.close(); }, []);
  return null;
}
