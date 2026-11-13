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
html,body{width:100%;height:100%;overflow:hidden;background:#000}
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
</style>
</head>
<body>
<div id="overlay">
  <h2>AR Viewer</h2>
  <p id="status-p">Loading...</p>
  <button id="start-btn" disabled>Start AR</button>
</div>
<div id="info">Move phone over a surface...</div>
<button id="exit-btn">Exit</button>

<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js"></script>

<script>
var statusP  = document.getElementById('status-p');
var overlay  = document.getElementById('overlay');
var startBtn = document.getElementById('start-btn');
var infoEl   = document.getElementById('info');
var exitBtn  = document.getElementById('exit-btn');

var MODEL = new URLSearchParams(location.search).get('model')
  || 'https://arigroup-web.vercel.app/models/astronaut.glb';
var MAX_PLACED = 30;

// Three.js — renderer.xr handles the WebXR base layer and framebuffer correctly
var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:1';

var scene  = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 20);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
var sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 3, 2);
scene.add(sun);

// Reticle — flat white ring on the detected surface
var reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

var modelTemplate = null;
var placed = [];

// Load model
statusP.textContent = 'Loading model...';
new THREE.GLTFLoader().load(MODEL, function(gltf) {
  var obj = gltf.scene;
  var box = new THREE.Box3().setFromObject(obj);
  var sz  = box.getSize(new THREE.Vector3());
  var mx  = Math.max(sz.x, sz.y, sz.z);
  if (mx > 0) {
    var k = 0.3 / mx;
    obj.scale.setScalar(k);
    obj.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(k));
    obj.position.y -= box.min.y * k;
  }
  modelTemplate = obj;
  checkARSupport();
}, undefined, function() {
  // Model failed — use orange box placeholder
  var g = new THREE.Group();
  var box = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xe37400 }));
  box.position.y = 0.075;
  g.add(box);
  modelTemplate = g;
  checkARSupport();
});

function checkARSupport() {
  if (!navigator.xr) {
    statusP.textContent = 'WebXR not available. Use Chrome on Android.';
    return;
  }
  navigator.xr.isSessionSupported('immersive-ar').then(function(ok) {
    if (ok) {
      statusP.textContent = 'Ready — tap Start AR';
      startBtn.disabled = false;
    } else {
      statusP.textContent = 'AR not supported on this device.';
    }
  });
}

// XR hit-test state
var xrHitTestSource = null;
var xrSession = null;

startBtn.addEventListener('click', function() {
  overlay.classList.add('hidden');
  navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local', 'hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body }
  }).then(function(session) {
    xrSession = session;

    session.addEventListener('end', function() {
      if (xrHitTestSource) { xrHitTestSource.cancel(); xrHitTestSource = null; }
      xrSession = null;
      reticle.visible = false;
      infoEl.style.display = 'none';
      exitBtn.style.display = 'none';
      overlay.classList.remove('hidden');
      statusP.textContent = 'Session ended - tap Start AR to go again';
      startBtn.disabled = false;
      renderer.setAnimationLoop(null);
    });

    session.addEventListener('select', onSelect);

    // setSession sets up updateRenderState (base layer) internally.
    // Hit-test source MUST be requested AFTER updateRenderState — matching
    // the immersive-web sample which calls updateRenderState synchronously first.
    return renderer.xr.setSession(session);

  }).then(function() {
    var session = xrSession;
    // Base layer is now set up — safe to request hit-test source
    return session.requestReferenceSpace('viewer').then(function(viewerSpace) {
      return session.requestHitTestSource({ space: viewerSpace });
    }).then(function(hts) {
      xrHitTestSource = hts;
      infoEl.style.display = 'block';
      exitBtn.style.display = 'block';
      renderer.setAnimationLoop(onXRFrame);
    });

  }).catch(function(e) {
    overlay.classList.remove('hidden');
    statusP.textContent = 'AR failed: ' + (e.message || e);
    startBtn.disabled = false;
  });
});

exitBtn.addEventListener('click', function() {
  if (xrSession) xrSession.end();
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

function onXRFrame(t, frame) {
  if (!frame || !xrHitTestSource) return;
  // Use renderer.xr.getReferenceSpace() — the same 'local' space Three.js uses internally
  var refSpace = renderer.xr.getReferenceSpace();
  if (!refSpace) return;

  var hits = frame.getHitTestResults(xrHitTestSource);
  if (hits.length > 0) {
    var hitPose = hits[0].getPose(refSpace);
    if (hitPose) {
      reticle.visible = true;
      reticle.matrix.fromArray(hitPose.transform.matrix);
      reticle.matrixWorldNeedsUpdate = true;
      if (placed.length === 0) infoEl.textContent = 'Surface found — tap to place';
    }
  } else {
    reticle.visible = false;
    if (placed.length === 0) infoEl.textContent = 'Move phone over a surface...';
  }
  renderer.render(scene, camera);
}
</script>
</body>
</html>"""


@app.get("/ar-viewer", response_class=HTMLResponse)
async def ar_viewer(request: Request):
    return HTMLResponse(content=AR_VIEWER_HTML)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
