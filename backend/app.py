from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
import qrcode
from io import BytesIO
import uuid
from datetime import datetime
import json

load_dotenv()

app = FastAPI(title="ARIGroup API", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for demo (no Supabase needed)
restaurants_db = {}
models_db = {}
qr_codes_db = {}

# File storage
UPLOAD_DIR = "/tmp/arigroup_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Initialize test data
def init_test_data():
    """Create test restaurants for development"""
    test_restaurants = [
        {
            "id": "pasta-paradise-id",
            "name": "Pasta Paradise",
            "email": "pasta@example.com",
            "phone": "020 1234 5678",
            "address": "123 Main Street",
            "city": "London",
            "created_at": datetime.utcnow().isoformat(),
            "subscription_active": True
        },
        {
            "id": "rosie-1-id",
            "name": "ROSIE MAY LARWOOD",
            "email": "rosie1@example.com",
            "phone": "020 9876 5432",
            "address": "1 Cargreen Road",
            "city": "London",
            "created_at": datetime.utcnow().isoformat(),
            "subscription_active": True
        },
        {
            "id": "rosie-2-id",
            "name": "ROSIE MAY LARWOOD",
            "email": "rosie2@example.com",
            "phone": "020 5555 5555",
            "address": "1 Cargreen Road",
            "city": "London",
            "created_at": datetime.utcnow().isoformat(),
            "subscription_active": True
        }
    ]
    for restaurant in test_restaurants:
        restaurants_db[restaurant["id"]] = restaurant

@app.on_event("startup")
async def startup_event():
    init_test_data()

@app.get("/")
def read_root():
    return {"message": "ARIGroup API", "version": "1.0.0"}

@app.post("/restaurants")
async def create_restaurant(
    name: str = Form(...),
    email: str = Form(...),
    phone: str = Form(None),
    address: str = Form(None),
    city: str = Form(None)
):
    restaurant_id = str(uuid.uuid4())

    restaurant = {
        "id": restaurant_id,
        "name": name,
        "email": email,
        "phone": phone or "",
        "address": address or "",
        "city": city or "",
        "created_at": datetime.utcnow().isoformat(),
        "subscription_active": True
    }

    restaurants_db[restaurant_id] = restaurant
    return restaurant

@app.get("/restaurants/{restaurant_id}")
async def get_restaurant(restaurant_id: str):
    if restaurant_id not in restaurants_db:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return restaurants_db[restaurant_id]

@app.post("/models/upload")
async def upload_model(
    restaurant_id: str = Form(...),
    name: str = Form(...),
    description: str = Form(None),
    scale: float = Form(1.0),
    file: UploadFile = File(...),
    ios_file: UploadFile = File(None)
):
    if not file.filename.lower().endswith(('.obj', '.gltf', '.glb')):
        raise HTTPException(status_code=400, detail="Only OBJ, glTF, and GLB files allowed for the main model")

    if ios_file and ios_file.filename and not ios_file.filename.lower().endswith('.usdz'):
        raise HTTPException(status_code=400, detail="iOS model must be a .usdz file")

    if restaurant_id not in restaurants_db:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    model_id = str(uuid.uuid4())
    file_ext = file.filename.split('.')[-1].lower()

    os.makedirs(f"{UPLOAD_DIR}/{restaurant_id}", exist_ok=True)
    file_path = f"{UPLOAD_DIR}/{restaurant_id}/{model_id}.{file_ext}"

    content = await file.read()
    with open(file_path, 'wb') as f:
        f.write(content)

    usdz_path = None
    if ios_file and ios_file.filename:
        usdz_content = await ios_file.read()
        usdz_path = f"{UPLOAD_DIR}/{restaurant_id}/{model_id}.usdz"
        with open(usdz_path, 'wb') as f:
            f.write(usdz_content)

    model_data = {
        "id": model_id,
        "restaurant_id": restaurant_id,
        "name": name,
        "description": description or "",
        "file_path": file_path,
        "file_type": file_ext,
        "file_size": len(content),
        "scale": scale,
        "usdz_path": usdz_path,
        "has_ios": usdz_path is not None,
        "created_at": datetime.utcnow().isoformat()
    }

    models_db[model_id] = model_data

    return {
        "id": model_id,
        "message": "Model uploaded successfully",
        "file_path": file_path,
        "has_ios": usdz_path is not None
    }

@app.get("/models/{restaurant_id}")
async def list_models(restaurant_id: str):
    models = [m for m in models_db.values() if m["restaurant_id"] == restaurant_id]
    return [
        {
            "id": m["id"],
            "restaurant_id": m["restaurant_id"],
            "name": m["name"],
            "description": m.get("description", ""),
            "file_type": m["file_type"],
            "file_size": m.get("file_size", 0),
            "scale": m.get("scale", 1.0),
            "has_ios": m.get("has_ios", False),
            "created_at": m["created_at"]
        }
        for m in models
    ]

@app.post("/qr/{model_id}")
async def generate_qr(model_id: str):
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]
    restaurant_id = model["restaurant_id"]

    # Create QR code URL pointing to production frontend
    frontend_url = os.getenv("FRONTEND_URL", "https://arigroup.space")
    qr_url = f"{frontend_url}/view/{model_id}"

    # Generate QR code image
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(qr_url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")

    # Save QR image locally
    qr_id = str(uuid.uuid4())
    os.makedirs(f"{UPLOAD_DIR}/qr/{restaurant_id}", exist_ok=True)
    qr_image_path = f"{UPLOAD_DIR}/qr/{restaurant_id}/{qr_id}.png"

    img.save(qr_image_path)

    # Save metadata
    qr_data = {
        "id": qr_id,
        "restaurant_id": restaurant_id,
        "model_id": model_id,
        "code_url": qr_url,
        "qr_image_path": qr_image_path,
        "created_at": datetime.utcnow().isoformat()
    }

    qr_codes_db[qr_id] = qr_data

    return {
        "qr_id": qr_id,
        "qr_url": qr_url,
        "qr_image_url": f"data:image/png;base64,{__import__('base64').b64encode(open(qr_image_path, 'rb').read()).decode()}"
    }

@app.get("/model/{model_id}")
async def get_model_file(model_id: str):
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]
    file_path = model["file_path"]
    file_type = model["file_type"].lower()

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Model file not found")

    media_types = {
        "obj": "text/plain",
        "gltf": "application/json",
        "glb": "model/gltf-binary"
    }
    media_type = media_types.get(file_type, "application/octet-stream")

    from fastapi.responses import FileResponse
    return FileResponse(file_path, media_type=media_type)

@app.get("/model-ios/{model_id}")
async def get_model_ios(model_id: str):
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]
    usdz_path = model.get("usdz_path")

    if not usdz_path or not os.path.exists(usdz_path):
        raise HTTPException(status_code=404, detail="iOS USDZ model not available")

    from fastapi.responses import FileResponse
    return FileResponse(usdz_path, media_type="model/vnd.usdz+zip", filename=f"{model_id}.usdz")

@app.get("/model-info/{model_id}")
async def get_model_info(model_id: str):
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]
    return {
        "id": model["id"],
        "name": model["name"],
        "description": model.get("description", ""),
        "file_type": model["file_type"],
        "scale": model.get("scale", 1.0),
        "has_ios": model.get("has_ios", False),
        "created_at": model["created_at"]
    }

AR_VIEWER_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>ARIGroup AR</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:transparent}
#overlay{
  position:fixed;inset:0;z-index:10;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:#000;font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  color:#fff;gap:16px;padding:24px;
}
#overlay.hidden{display:none}
#overlay h2{font-size:20px;font-weight:700;text-align:center}
#overlay p{font-size:13px;color:#aaa;text-align:center;max-width:300px;line-height:1.5}
#start-btn{
  background:#e37400;color:#fff;border:none;border-radius:12px;
  padding:14px 40px;font:700 16px sans-serif;cursor:pointer;
}
#start-btn:disabled{opacity:.4;cursor:default}
#err{
  display:none;max-width:320px;max-height:40vh;overflow:auto;
  background:#3a0d0d;border:1px solid #a33;color:#ffb4b4;border-radius:10px;
  padding:10px 12px;font:12px/1.45 monospace;text-align:left;
  white-space:pre-wrap;word-break:break-word;
}
#info{
  position:fixed;bottom:50px;left:50%;transform:translateX(-50%);
  background:rgba(0,0,0,.72);color:#fff;padding:9px 20px;border-radius:20px;
  font:600 13px sans-serif;white-space:nowrap;z-index:10;pointer-events:none;display:none;
}
#exit-btn{
  position:fixed;top:20px;right:20px;z-index:20;
  background:rgba(0,0,0,.65);color:#fff;border:none;border-radius:20px;
  padding:9px 18px;font:700 13px sans-serif;cursor:pointer;display:none;
}
/* TEMP DEBUG: hit-test diagnostics overlay */
#dbg{
  position:fixed;top:8px;left:8px;z-index:30;max-width:70vw;
  background:rgba(0,0,0,.7);color:#0f0;padding:6px 8px;border-radius:6px;
  font:11px/1.4 monospace;white-space:pre-wrap;word-break:break-word;
  pointer-events:none;display:none;
}
</style>
</head>
<body>
<div id="overlay">
  <h2>AR Viewer</h2>
  <p id="status-p">Loading page...</p>
  <button id="start-btn" disabled>Start AR</button>
  <div id="err"></div>
</div>
<div id="info">Move phone over a surface...</div>
<button id="exit-btn">Exit</button>
<div id="dbg"></div>

<!-- 1. Bootstrap: runs before any CDN script so the status always changes and errors are always visible -->
<script>
var statusP = document.getElementById('status-p');
var errEl   = document.getElementById('err');
function setStatus(msg) { statusP.textContent = msg; }
function showError(msg) {
  errEl.style.display = 'block';
  errEl.textContent = (errEl.textContent ? errEl.textContent + String.fromCharCode(10) : '') + msg;
  document.getElementById('overlay').classList.remove('hidden');
}
window.addEventListener('error', function(e) {
  var t = e.target;
  if (t && t.tagName === 'SCRIPT' && t.src) {
    showError('Script failed to load: ' + t.src);
  } else {
    showError('JS error: ' + (e.message || 'unknown') + (e.lineno ? ' (line ' + e.lineno + ')' : ''));
  }
}, true);
window.addEventListener('unhandledrejection', function(e) {
  var r = e.reason;
  showError('Error: ' + (r && r.message ? r.message : String(r)));
});
setStatus('Loading 3D engine...');
</script>

<!-- 2. UMD builds, no ES module imports. r147 is the last release that ships examples/js (removed in r148+) -->
<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js"></script>

<!-- 3. App -->
<script>
(function() {
  if (typeof THREE === 'undefined') {
    setStatus('Could not load the 3D engine.');
    showError('three.min.js did not load from the CDN. Check the connection and reload.');
    return;
  }

  var MODEL = new URLSearchParams(location.search).get('model')
    || 'https://arigroup-web.vercel.app/models/astronaut.glb';
  var MODEL_SIZE = 0.3;   // largest dimension in metres
  var MAX_PLACED = 30;

  var overlay  = document.getElementById('overlay');
  var startBtn = document.getElementById('start-btn');
  var infoEl   = document.getElementById('info');
  var exitBtn  = document.getElementById('exit-btn');

  var xrSupported = false;
  var modelState  = 'loading';   // loading | ready | failed
  var modelPct    = 0;
  var xrSession   = null;

  function refreshStatus() {
    if (xrSession) return;
    if (!xrSupported) return;   // XR check owns the message until it passes
    if (modelState === 'loading') {
      setStatus('AR ready. Loading model' + (modelPct ? ' ' + modelPct + '%' : '') + '... you can start now.');
    } else if (modelState === 'ready') {
      setStatus('Ready. Tap Start AR.');
    } else {
      setStatus('AR ready, but the model failed to load. A placeholder box will be used.');
    }
  }

  // ---------- Renderer / scene ----------
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  // three defaults to 'local-floor', which is NOT in requiredFeatures and would be rejected.
  renderer.xr.setReferenceSpaceType('local');
  renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1';
  document.body.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2));
  var sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(1, 3, 2);
  scene.add(sun);
  var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  var reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // ---------- Model ----------
  // The template is a wrapper Group. The wrapper receives the reticle matrix on placement;
  // the inner object keeps its own scale/offset so the model stays normalised in size.
  var modelTemplate = null;
  var placed = [];

  function makeFallback() {
    var g = new THREE.Group();
    var s = MODEL_SIZE * 0.5;
    var box = new THREE.Mesh(
      new THREE.BoxGeometry(s, s, s),
      new THREE.MeshStandardMaterial({ color: 0xe37400 })
    );
    box.position.y = s / 2;
    g.add(box);
    return g;
  }

  if (typeof THREE.GLTFLoader !== 'function') {
    modelState = 'failed';
    modelTemplate = makeFallback();
    showError('GLTFLoader did not load from the CDN, so the model cannot be loaded.');
  } else {
    try {
      var loader = new THREE.GLTFLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(MODEL, function(gltf) {
        var inner = gltf.scene;
        var box = new THREE.Box3().setFromObject(inner);
        var sz  = box.getSize(new THREE.Vector3());
        var mx  = Math.max(sz.x, sz.y, sz.z);
        var k   = mx > 0 ? MODEL_SIZE / mx : 1;
        var c   = box.getCenter(new THREE.Vector3());
        inner.scale.multiplyScalar(k);
        // centre on X/Z, sit the base on the surface (Y)
        inner.position.x -= c.x * k;
        inner.position.z -= c.z * k;
        inner.position.y -= box.min.y * k;
        var wrap = new THREE.Group();
        wrap.add(inner);
        modelTemplate = wrap;
        modelState = 'ready';
        refreshStatus();
      }, function(ev) {
        if (ev && ev.lengthComputable && ev.total > 0) {
          modelPct = Math.round(ev.loaded / ev.total * 100);
          refreshStatus();
        }
      }, function(e) {
        modelState = 'failed';
        modelTemplate = makeFallback();
        var why = (e && e.message) ? e.message : 'network or CORS error';
        showError('Model failed to load: ' + why + String.fromCharCode(10) + MODEL +
          String.fromCharCode(10) + 'The model host must be reachable over HTTPS and send Access-Control-Allow-Origin.');
        refreshStatus();
      });
    } catch (e) {
      modelState = 'failed';
      modelTemplate = makeFallback();
      showError('Model loader error: ' + e.message);
    }
  }

  // ---------- WebXR support check (independent of the model load) ----------
  setStatus('Checking AR support...');
  if (!window.isSecureContext) {
    setStatus('AR needs a secure (https) page.');
  } else if (!navigator.xr) {
    setStatus('WebXR is not available in this browser. Open this page in Chrome on an ARCore-supported Android phone.');
  } else {
    navigator.xr.isSessionSupported('immersive-ar').then(function(ok) {
      if (ok) {
        xrSupported = true;
        startBtn.disabled = false;
        refreshStatus();
      } else {
        setStatus('WebXR AR is not supported on this device. Make sure Google Play Services for AR is installed.');
      }
    }).catch(function(e) {
      setStatus('Could not check AR support.');
      showError('isSessionSupported failed: ' + (e && e.message ? e.message : String(e)));
    });
  }

  // ---------- Session ----------
  var xrRefSpace      = null;   // 'local'  : objects are placed in this space so they stay put
  var xrViewerSpace   = null;   // 'viewer' : only used as the hit-test ray source
  var xrHitTestSource = null;

  // ---------- TEMP DEBUG: hit-test diagnostics ----------
  var dbgEl = document.getElementById('dbg');
  var NL = String.fromCharCode(10);
  var dbg = { frames: 0, hits: 0, poses: 0, htsState: 'null', lastError: '', lastLog: 0 };
  function dbgError(where, e) {
    dbg.lastError = where + ': ' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
    console.log('[AR dbg] error ' + dbg.lastError);
  }
  function dbgText() {
    return 'Frames: ' + dbg.frames + NL +
      'Hits: ' + dbg.hits + '  Poses: ' + dbg.poses + NL +
      'HTS: ' + (xrHitTestSource ? 'ready' : dbg.htsState) + '  RS: ' + (xrRefSpace ? 'ready' : 'null') + NL +
      'Err: ' + (dbg.lastError || 'none');
  }
  function dbgRender(t) {
    dbgEl.textContent = dbgText();
    if (t - dbg.lastLog >= 1000) {
      dbg.lastLog = t;
      console.log('[AR dbg] frames=' + dbg.frames + ' hits=' + dbg.hits + ' poses=' + dbg.poses +
        ' hts=' + (xrHitTestSource ? 'ready' : dbg.htsState) + ' rs=' + (xrRefSpace ? 'ready' : 'null') +
        ' err=' + (dbg.lastError || 'none'));
    }
  }

  // Requested from inside the first XRFrame callback (some Android Chrome builds return
  // empty results for a source requested before the first frame). Retries after a failure.
  var htsRequesting = false;
  function ensureHitTestSource(session) {
    if (xrHitTestSource || htsRequesting || !session) return;
    htsRequesting = true;
    dbg.htsState = 'requesting';
    session.requestReferenceSpace('viewer').then(function(vs) {
      xrViewerSpace = vs;
      return session.requestHitTestSource({ space: vs });
    }).then(function(hts) {
      htsRequesting = false;
      if (session !== xrSession) { try { hts.cancel(); } catch (e) {} return; }
      xrHitTestSource = hts;
      dbg.htsState = 'ready';
      console.log('[AR dbg] hit-test source ready at frame ' + dbg.frames);
    }).catch(function(e) {
      dbg.htsState = 'null';
      dbgError('requestHitTestSource', e);
      // retry in ~1s rather than every frame
      setTimeout(function() { htsRequesting = false; }, 1000);
    });
  }

  function onSessionEnd() {
    if (xrHitTestSource) { try { xrHitTestSource.cancel(); } catch (e) {} }
    xrHitTestSource = null;
    xrRefSpace = null;
    xrViewerSpace = null;
    xrSession = null;
    reticle.visible = false;
    renderer.setAnimationLoop(null);
    infoEl.style.display = 'none';
    exitBtn.style.display = 'none';
    dbgEl.style.display = 'none';
    htsRequesting = false;
    overlay.classList.remove('hidden');
    setStatus('Session ended. Tap Start AR to go again.');
    startBtn.disabled = false;
  }

  startBtn.addEventListener('click', function() {
    startBtn.disabled = true;
    setStatus('Starting AR...');
    navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local', 'hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    }).then(function(session) {
      xrSession = session;
      session.addEventListener('end', onSessionEnd);
      // setSession requests the 'local' reference space (set above) and resolves when it is ready
      return renderer.xr.setSession(session).then(function() {
        xrRefSpace = renderer.xr.getReferenceSpace();
        // The hit-test source is NOT requested here: onXRFrame requests it on the first XRFrame.
        dbg.frames = 0; dbg.hits = 0; dbg.poses = 0; dbg.lastError = ''; dbg.lastLog = 0;
        dbg.htsState = 'null';
        htsRequesting = false;
        frameErrorShown = false;
        session.addEventListener('select', onSelect);
        overlay.classList.add('hidden');
        infoEl.textContent = 'Move phone over a surface...';
        infoEl.style.display = 'block';
        exitBtn.style.display = 'block';
        dbgEl.style.display = 'block';
        dbgEl.textContent = dbgText();
        renderer.setAnimationLoop(onXRFrame);
      });
    }).catch(function(e) {
      var msg = (e && e.message) ? e.message : String(e);
      dbgError('session start', e);
      if (xrSession) { try { xrSession.end(); } catch (x) {} }
      overlay.classList.remove('hidden');
      setStatus('AR failed to start.');
      showError('AR failed: ' + (e && e.name ? e.name + ': ' : '') + msg);
      startBtn.disabled = false;
    });
  });

  exitBtn.addEventListener('beforexrselect', function(ev) { ev.preventDefault(); });
  exitBtn.addEventListener('click', function() {
    if (xrSession) { xrSession.end(); } else { history.back(); }
  });

  function onSelect() {
    if (!reticle.visible || !modelTemplate) return;
    var clone = modelTemplate.clone();
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(reticle.matrix);
    clone.matrixWorldNeedsUpdate = true;
    scene.add(clone);
    placed.push(clone);
    if (placed.length > MAX_PLACED) scene.remove(placed.shift());
    infoEl.textContent = 'Tap again to place another';
  }

  var frameErrorShown = false;
  function onXRFrame(t, frame) {
    if (!frame) return;
    dbg.frames++;
    if (!xrRefSpace) { dbgRender(t); return; }
    // First-frame (and retry) hit-test source init
    if (!xrHitTestSource) ensureHitTestSource(frame.session);
    try {
      reticle.visible = false;
      if (xrHitTestSource) {
        var hits = frame.getHitTestResults(xrHitTestSource);
        if (hits.length > 0) dbg.hits++;
        var pose = hits.length > 0 ? hits[0].getPose(xrRefSpace) : null;
        if (pose) {
          dbg.poses++;
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          if (placed.length === 0) infoEl.textContent = 'Surface found. Tap to place';
        } else if (placed.length === 0) {
          infoEl.textContent = 'Move phone over a surface...';
        }
      }
    } catch (e) {
      dbgError('frame', e);
      if (!frameErrorShown) { frameErrorShown = true; infoEl.textContent = 'Frame error: ' + e.message; }
    }
    dbgRender(t);
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', function() {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();
</script>
</body>
</html>"""


@app.get("/ar-viewer", response_class=HTMLResponse)
async def ar_viewer(request: Request):
    return HTMLResponse(content=AR_VIEWER_HTML)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
