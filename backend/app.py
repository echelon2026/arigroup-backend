from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
import os
from dotenv import load_dotenv
import qrcode
from io import BytesIO
import uuid
from datetime import datetime
import json
import tempfile
from model_converter import get_or_create_dual_format
from r2_storage import upload_model_to_r2, R2_AVAILABLE

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

@app.post("/models/upload")
async def upload_model(
    restaurant_id: str = Form(...),
    name: str = Form(...),
    description: str = Form(None),
    scale: float = Form(1.0),
    file: UploadFile = File(...)
):
    if not file.filename.lower().endswith(('.obj', '.gltf', '.glb', '.usdz')):
        raise HTTPException(status_code=400, detail="Only OBJ, glTF, GLB, and USDZ files allowed")

    if restaurant_id not in restaurants_db:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    model_id = str(uuid.uuid4())
    file_ext = file.filename.split('.')[-1].lower()

    # Save file temporarily for processing
    temp_dir = tempfile.mkdtemp(prefix="arigroup_")
    temp_file_path = os.path.join(temp_dir, f"{model_id}.{file_ext}")

    content = await file.read()
    with open(temp_file_path, 'wb') as f:
        f.write(content)

    try:
        # Convert to dual-format (GLB + USDZ) for cross-platform AR
        formats = get_or_create_dual_format(temp_file_path, restaurant_id, model_id, temp_dir)

        # Upload to R2 or fall back to local storage
        if R2_AVAILABLE:
            try:
                primary_file = formats.get("glb_path") or temp_file_path
                primary_ext = os.path.splitext(primary_file)[1].lstrip('.')
                file_url = upload_model_to_r2(primary_file, restaurant_id, model_id, primary_ext)
                storage_type = "Cloudflare R2 (persistent CDN)"
            except Exception as e:
                print(f"⚠️  R2 upload failed: {e}, falling back to local storage")
                file_url = temp_file_path
                storage_type = "temporary local storage"
        else:
            # Fall back to local temp storage if R2 not configured
            file_url = temp_file_path
            storage_type = "temporary local storage (R2 not configured)"

        # Save metadata
        model_data = {
            "id": model_id,
            "restaurant_id": restaurant_id,
            "name": name,
            "description": description or "",
            "file_path": file_url,
            "file_type": file_ext,
            "file_size": len(content),
            "scale": scale,
            "formats": formats,
            "created_at": datetime.utcnow().isoformat()
        }

        models_db[model_id] = model_data
        persist_models_index()

        return {
            "id": model_id,
            "message": f"Model uploaded successfully to {storage_type}",
            "file_url": file_url,
            "formats": formats,
            "storage": storage_type
        }
    finally:
        # Clean up temp directory
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)

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

async def download_from_r2(r2_url: str):
    """Download file from R2 with authentication"""
    from r2_storage import r2_client
    if not r2_client:
        raise RuntimeError("R2 not configured")

    # Parse R2 URL to get bucket and key
    # URL format: https://{account}.r2.cloudflarestorage.com/{bucket}/{key}
    parts = r2_url.replace("https://", "").split("/", 1)
    if len(parts) != 2:
        raise ValueError("Invalid R2 URL")

    key = parts[1]
    bucket = os.getenv("CLOUDFLARE_R2_BUCKET", "arigroup-models")

    # Download from R2
    response = r2_client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()

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

    # If it's an R2 URL, fetch with authentication and serve
    if file_path.startswith("https://") and "r2.cloudflarestorage.com" in file_path:
        from fastapi.responses import StreamingResponse
        try:
            # Download from R2 with authentication
            response = await download_from_r2(file_path)
            media_types = {
                "obj": "text/plain",
                "gltf": "model/gltf+json",
                "glb": "model/gltf-binary",
                "usdz": "model/vnd.usdz+zip"
            }
            file_type = model.get("file_type", "glb").lower()
            media_type = media_types.get(file_type, "application/octet-stream")

            return StreamingResponse(
                iter([response]),
                media_type=media_type,
                headers={"Content-Disposition": f"inline; filename={model_id}.{file_type}"}
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch from R2: {str(e)}")

    # If it's another HTTPS URL, redirect
    if file_path.startswith("https://"):
        return RedirectResponse(url=file_path, status_code=307)

    # Otherwise serve from local disk (fallback)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Model file not found")

    from fastapi.responses import FileResponse
    media_types = {
        "obj": "text/plain",
        "gltf": "model/gltf+json",
        "glb": "model/gltf-binary",
        "usdz": "model/vnd.usdz+zip"
    }
    file_type = model.get("file_type", "glb").lower()
    media_type = media_types.get(file_type, "application/octet-stream")
    file_size = os.path.getsize(file_path)

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
