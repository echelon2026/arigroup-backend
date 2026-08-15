from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
import qrcode
from io import BytesIO
import uuid
from datetime import datetime
import json
import zipfile

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

MODELS_INDEX_PATH = os.path.join(UPLOAD_DIR, "models_index.json")


def persist_models_index():
    """Persist model metadata to disk so it can survive an in-process
    restart as long as the underlying disk is still around (Render's free
    tier spins the process down after ~15 min idle and loses all in-memory
    state on wake, which was silently breaking every previously-issued QR
    code)."""
    try:
        with open(MODELS_INDEX_PATH, 'w') as f:
            json.dump(models_db, f)
    except Exception as e:
        print(f"Warning: failed to persist models index: {e}")


def load_models_index():
    """Reload model metadata on startup. Also recovers metadata-less files
    found on disk (in case the index itself didn't survive a restart but
    the uploaded files did)."""
    if os.path.exists(MODELS_INDEX_PATH):
        try:
            with open(MODELS_INDEX_PATH, 'r') as f:
                loaded = json.load(f)
            for model_id, model in loaded.items():
                if os.path.exists(model.get("file_path", "")):
                    models_db[model_id] = model
        except Exception as e:
            print(f"Warning: failed to load models index: {e}")

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
    load_models_index()

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

def create_usda_content(glb_filename):
    """Create minimal USDA file that references the GLB"""
    return f"""#usda 1.0
(
    customLayerData = {{
        string creator = "arigroup-space"
    }}
    endTimeCode = 24
    metersPerUnit = 1
    startTimeCode = 0
    timeCodesPerSecond = 24
    upAxis = "Y"
)

over "Xform" {{
    over "Model" {{
        def Mesh "mesh0" {{
            uniform token[] faceVertexCounts = []
            uniform token[] faceVertexIndices = []
            rel material:binding = </Xform/Material>
            point3f[] points = []
            normal3f[] normals = []

            custom vector3d extentsHint = [(0, 0, 0), (1, 1, 1)]
        }}
    }}

    def "Material" (
        prepend references = @./{glb_filename}@
    )
    {{
    }}
}}
"""

def create_content_types_xml():
    """Create [Content_Types].xml required for USDZ"""
    return """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.usdz+xml"/>
  <Default Extension="xml" ContentType="application/vnd.usdz+xml"/>
  <Default Extension="usda" ContentType="text/plain"/>
  <Default Extension="glb" ContentType="application/octet-stream"/>
  <Override PartName="/model.usda" ContentType="text/plain"/>
</Types>
"""

def create_rels_xml():
    """Create root .rels file for USDZ"""
    return """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="StartSession" Type="http://schemas.pixar.com/usdz/v1/ar" Target="./model.usda"/>
  <Relationship Id="model" Type="http://schemas.pixar.com/usdz/v1/ref" Target="./model.glb"/>
</Relationships>
"""

def convert_glb_to_usdz(glb_file_path: str, usdz_file_path: str):
    """Convert GLB to USDZ by creating a ZIP archive with proper structure"""
    try:
        # Read GLB file
        with open(glb_file_path, 'rb') as f:
            glb_data = f.read()

        # Create USDZ ZIP
        with zipfile.ZipFile(usdz_file_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # Add USDA file
            usda_content = create_usda_content('model.glb')
            zf.writestr('model.usda', usda_content)

            # Add GLB file
            zf.writestr('model.glb', glb_data)

            # Add [Content_Types].xml
            content_types = create_content_types_xml()
            zf.writestr('[Content_Types].xml', content_types)

            # Add _rels/.rels
            rels_content = create_rels_xml()
            zf.writestr('_rels/.rels', rels_content)

        return True
    except Exception as e:
        print(f"Error converting GLB to USDZ: {e}")
        return False

@app.post("/models/upload")
async def upload_model(
    restaurant_id: str = Form(...),
    name: str = Form(...),
    description: str = Form(None),
    scale: float = Form(1.0),
    file: UploadFile = File(...)
):
    if not file.filename.lower().endswith(('.obj', '.gltf', '.glb')):
        raise HTTPException(status_code=400, detail="Only OBJ, glTF, and GLB files allowed")

    if restaurant_id not in restaurants_db:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    model_id = str(uuid.uuid4())
    file_ext = file.filename.split('.')[-1].lower()

    # Save file locally
    os.makedirs(f"{UPLOAD_DIR}/{restaurant_id}", exist_ok=True)
    file_path = f"{UPLOAD_DIR}/{restaurant_id}/{model_id}.{file_ext}"

    content = await file.read()
    with open(file_path, 'wb') as f:
        f.write(content)

    # Convert GLB to USDZ for iOS AR support
    usdz_path = None
    if file_ext.lower() == 'glb':
        usdz_path = f"{UPLOAD_DIR}/{restaurant_id}/{model_id}.usdz"
        if convert_glb_to_usdz(file_path, usdz_path):
            print(f"✓ Converted {model_id}.glb to USDZ")
        else:
            print(f"✗ Failed to convert {model_id}.glb to USDZ")
            usdz_path = None

    # Save metadata
    model_data = {
        "id": model_id,
        "restaurant_id": restaurant_id,
        "name": name,
        "description": description or "",
        "file_path": file_path,
        "file_type": file_ext,
        "file_size": len(content),
        "scale": scale,
        "created_at": datetime.utcnow().isoformat(),
        "usdz_path": usdz_path  # Track USDZ for iOS
    }

    models_db[model_id] = model_data
    persist_models_index()

    return {
        "id": model_id,
        "message": "Model uploaded successfully",
        "file_path": file_path,
        "usdz_path": usdz_path
    }

@app.get("/models/{restaurant_id}")
async def list_models(restaurant_id: str):
    return [m for m in models_db.values() if m["restaurant_id"] == restaurant_id]

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

@app.get("/model/{model_id}/info")
async def get_model_info(model_id: str):
    """Lightweight JSON metadata for a model. The AR viewer needs this to
    read the per-model `scale` that's been collected in the upload form
    (Dashboard/AdminDashboard) since the app's inception but was never
    actually served anywhere — the viewer only ever fetched the raw GLB
    from /model/{model_id}, so that field had zero effect on how big the
    model actually rendered. This is what was making uploaded models
    (e.g. the cube) show up oversized in AR regardless of what scale was
    set at upload time."""
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]
    return {
        "id": model["id"],
        "name": model.get("name"),
        "file_type": model.get("file_type"),
        "scale": model.get("scale", 1.0),
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

    # Map file types to correct media types. Scene Viewer / Quick Look /
    # model-viewer all sniff these, so using the generic
    # application/octet-stream (as before) can cause some AR handoffs to
    # reject the file.
    media_types = {
        "obj": "text/plain",
        "gltf": "model/gltf+json",
        "glb": "model/gltf-binary"
    }
    media_type = media_types.get(file_type, "application/octet-stream")
    file_size = os.path.getsize(file_path)

    # iOS Safari is stricter than Android/Chrome about CORS on binary
    # model downloads: it wants the CORS headers present directly on the
    # response for the actual GET (not just relying on the app-level
    # CORSMiddleware) and is picky about Content-Length being explicit
    # rather than left to chunked transfer. Spell everything out here so
    # Safari's fetch() for the .glb doesn't get silently rejected.
    #
    # Starlette's FileResponse already streams the file in chunks (rather
    # than buffering it all in memory) and, given a Range request header,
    # already serves a proper 206 partial response — both needed so a slow
    # connection (Render free tier + a large GLB, worse on iOS) gets bytes
    # incrementally instead of waiting on one huge buffered response.
    # Accept-Ranges is spelled out explicitly here (not just left to
    # FileResponse's own default) so clients — including model-viewer's own
    # loader and the app's independent reachability diagnostic — can see
    # from the headers alone that range/resumable requests are supported.
    from fastapi.responses import FileResponse
    return FileResponse(
        file_path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range",
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        }
    )


@app.get("/model/{model_id}/usdz")
async def get_model_usdz(model_id: str):
    """Serve pre-converted USDZ file for iOS AR"""
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]
    usdz_path = model.get("usdz_path")

    if not usdz_path or not os.path.exists(usdz_path):
        raise HTTPException(status_code=404, detail="USDZ not available for this model")

    file_size = os.path.getsize(usdz_path)

    from fastapi.responses import FileResponse
    return FileResponse(
        usdz_path,
        media_type="model/vnd.usdz+zip",
        headers={
            "Content-Disposition": f'inline; filename="{model_id}.usdz"',
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range",
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        }
    )


@app.options("/model/{model_id}")
async def options_model(model_id: str):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"allow": ["GET", "OPTIONS"]},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range",
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
