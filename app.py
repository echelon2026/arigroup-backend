from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
import os
from dotenv import load_dotenv
import qrcode
from io import BytesIO
import uuid
from datetime import datetime
import json

load_dotenv()

# ── Cloudflare R2 (S3-compatible) for persistent model file storage ───────────
try:
    import boto3
    from botocore.config import Config as BotoCfg
    _R2_ACCOUNT  = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
    _R2_KEY      = os.getenv("CLOUDFLARE_R2_ACCESS_KEY", "")
    _R2_SECRET   = os.getenv("CLOUDFLARE_R2_SECRET_KEY", "")
    _R2_BUCKET   = os.getenv("CLOUDFLARE_R2_BUCKET", "arigroup-models")
    _R2_DOMAIN   = os.getenv("CLOUDFLARE_R2_DOMAIN", "")  # e.g. ar.arigroup.space

    r2 = boto3.client(
        "s3",
        endpoint_url=f"https://{_R2_ACCOUNT}.r2.cloudflarestorage.com",
        aws_access_key_id=_R2_KEY,
        aws_secret_access_key=_R2_SECRET,
        config=BotoCfg(signature_version="s3v4"),
        region_name="auto"
    ) if (_R2_KEY and _R2_SECRET and _R2_ACCOUNT) else None
except Exception as _e:
    r2 = None
    print(f"R2 not available: {_e}")

def _r2_upload(key: str, data: bytes, content_type: str) -> bool:
    """Upload to R2; returns True on success."""
    if not r2:
        return False
    try:
        r2.put_object(Bucket=_R2_BUCKET, Key=key, Body=data, ContentType=content_type)
        return True
    except Exception as e:
        print(f"R2 upload error for {key}: {e}")
        return False

def _r2_fetch(key: str) -> bytes | None:
    """Download from R2; returns bytes or None."""
    if not r2:
        return None
    try:
        resp = r2.get_object(Bucket=_R2_BUCKET, Key=key)
        return resp["Body"].read()
    except Exception as e:
        print(f"R2 fetch error for {key}: {e}")
        return None

def _r2_save_meta(data: dict):
    _r2_upload("metadata/models.json", json.dumps(data).encode(), "application/json")

def _r2_load_meta() -> dict:
    if not r2:
        return {}
    try:
        resp = r2.get_object(Bucket=_R2_BUCKET, Key="metadata/models.json")
        return json.loads(resp["Body"].read())
    except Exception:
        return {}
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="ARIGroup API", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage (backed by JSON files for persistence across hot-reloads)
restaurants_db = {}
models_db = {}
qr_codes_db = {}
marketplace_posts_db = {}
marketplace_replies_db = {}

# File storage
UPLOAD_DIR = "/tmp/arigroup_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

MODELS_JSON = f"{UPLOAD_DIR}/models.json"
RESTAURANTS_JSON = f"{UPLOAD_DIR}/restaurants.json"

def _save_json(path, data):
    try:
        with open(path, 'w') as f:
            json.dump(data, f)
    except Exception as e:
        print(f"Warning: could not save {path}: {e}")

def _load_json(path, target_dict):
    if os.path.exists(path):
        try:
            with open(path, 'r') as f:
                target_dict.update(json.load(f))
        except Exception as e:
            print(f"Warning: could not load {path}: {e}")

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
        if restaurant["id"] not in restaurants_db:
            restaurants_db[restaurant["id"]] = restaurant

@app.on_event("startup")
async def startup_event():
    # Load from R2 first (durable across Render restarts), then overlay local JSON
    remote = _r2_load_meta()
    if remote:
        models_db.update(remote)
        print(f"Loaded {len(remote)} models from R2")
    _load_json(MODELS_JSON, models_db)
    _load_json(RESTAURANTS_JSON, restaurants_db)
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
    _save_json(RESTAURANTS_JSON, restaurants_db)
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

    # Upload to R2 (persistent storage); files also kept locally as hot-path cache
    _ct_map = {"glb": "model/gltf-binary", "gltf": "model/gltf+json", "obj": "text/plain"}
    r2_key = f"models/{restaurant_id}/{model_id}.{file_ext}"
    _r2_upload(r2_key, content, _ct_map.get(file_ext, "application/octet-stream"))

    usdz_path = None
    r2_usdz_key = None
    if ios_file and ios_file.filename:
        usdz_content = await ios_file.read()
        usdz_path = f"{UPLOAD_DIR}/{restaurant_id}/{model_id}.usdz"
        with open(usdz_path, 'wb') as f:
            f.write(usdz_content)
        r2_usdz_key = f"models/{restaurant_id}/{model_id}.usdz"
        _r2_upload(r2_usdz_key, usdz_content, "model/vnd.usdz+zip")

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
        "has_ios": (usdz_path is not None),
        "r2_key": r2_key,          # R2 object key for the main model
        "r2_usdz_key": r2_usdz_key, # R2 object key for USDZ (or None)
        "created_at": datetime.utcnow().isoformat()
    }

    models_db[model_id] = model_data
    _save_json(MODELS_JSON, models_db)
    _r2_save_meta(models_db)

    return {
        "id": model_id,
        "message": "Model uploaded successfully",
        "has_ios": usdz_path is not None,
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
    file_type = model["file_type"].lower()
    media_types = {"obj": "text/plain", "gltf": "model/gltf+json", "glb": "model/gltf-binary"}
    ct = media_types.get(file_type, "application/octet-stream")

    # 1. Try local disk (fast path — file may still exist in this container session)
    file_path = model.get("file_path", "")
    if file_path and os.path.exists(file_path):
        return FileResponse(file_path, media_type=ct)

    # 2. Fetch from R2 and stream (survives Render restarts)
    r2_key = model.get("r2_key")
    if r2_key:
        data = _r2_fetch(r2_key)
        if data:
            # Re-cache locally for subsequent requests
            try:
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                with open(file_path, "wb") as fh:
                    fh.write(data)
            except Exception:
                pass
            return Response(content=data, media_type=ct)

    raise HTTPException(status_code=404, detail="Model file unavailable; please re-upload")

@app.get("/model-ios/{model_id}")
async def get_model_ios(model_id: str):
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]

    usdz_path = model.get("usdz_path", "")
    if usdz_path and os.path.exists(usdz_path):
        return FileResponse(usdz_path, media_type="model/vnd.usdz+zip", filename=f"{model_id}.usdz")

    r2_usdz_key = model.get("r2_usdz_key")
    if r2_usdz_key:
        data = _r2_fetch(r2_usdz_key)
        if data:
            try:
                os.makedirs(os.path.dirname(usdz_path), exist_ok=True)
                with open(usdz_path, "wb") as fh:
                    fh.write(data)
            except Exception:
                pass
            return Response(content=data, media_type="model/vnd.usdz+zip",
                            headers={"Content-Disposition": f'attachment; filename="{model_id}.usdz"'})

    raise HTTPException(status_code=404, detail="iOS USDZ model not available")

@app.get("/model-info/{model_id}")
async def get_model_info(model_id: str):
    if model_id not in models_db:
        raise HTTPException(status_code=404, detail="Model not found")

    model = models_db[model_id]
    api_base = os.getenv("API_URL", "https://arigroup-api.onrender.com")

    return {
        "id": model["id"],
        "name": model["name"],
        "description": model.get("description", ""),
        "file_type": model["file_type"],
        "scale": model.get("scale", 1.0),
        "has_ios": model.get("has_ios", False),
        # Always the Render API URL — backend proxies from R2 transparently
        "model_url": f"{api_base}/model/{model_id}",
        "ios_url": f"{api_base}/model-ios/{model_id}" if model.get("has_ios") else None,
        "created_at": model["created_at"]
    }

# ── Marketplace ──────────────────────────────────────────────────────────────

@app.get("/marketplace/posts")
async def list_posts(limit: int = 50, offset: int = 0):
    posts = sorted(marketplace_posts_db.values(), key=lambda p: p["created_at"], reverse=True)
    result = []
    for p in posts[offset:offset + limit]:
        reply_count = sum(1 for r in marketplace_replies_db.values() if r["post_id"] == p["id"])
        result.append({**p, "reply_count": reply_count})
    return result

@app.post("/marketplace/posts")
async def create_post(
    title: str = Form(...),
    body: str = Form(...),
    author_name: str = Form(...),
    category: str = Form("general"),
    restaurant_id: str = Form(None),
):
    post_id = str(uuid.uuid4())
    post = {
        "id": post_id,
        "title": title.strip(),
        "body": body.strip(),
        "author_name": author_name.strip(),
        "category": category,
        "restaurant_id": restaurant_id,
        "created_at": datetime.utcnow().isoformat(),
    }
    marketplace_posts_db[post_id] = post
    return {**post, "reply_count": 0}

@app.get("/marketplace/posts/{post_id}")
async def get_post(post_id: str):
    if post_id not in marketplace_posts_db:
        raise HTTPException(status_code=404, detail="Post not found")
    post = marketplace_posts_db[post_id]
    replies = sorted(
        [r for r in marketplace_replies_db.values() if r["post_id"] == post_id],
        key=lambda r: r["created_at"]
    )
    return {**post, "replies": replies, "reply_count": len(replies)}

@app.post("/marketplace/posts/{post_id}/replies")
async def create_reply(
    post_id: str,
    body: str = Form(...),
    author_name: str = Form(...),
):
    if post_id not in marketplace_posts_db:
        raise HTTPException(status_code=404, detail="Post not found")
    reply_id = str(uuid.uuid4())
    reply = {
        "id": reply_id,
        "post_id": post_id,
        "body": body.strip(),
        "author_name": author_name.strip(),
        "created_at": datetime.utcnow().isoformat(),
    }
    marketplace_replies_db[reply_id] = reply
    return reply

@app.delete("/marketplace/posts/{post_id}")
async def delete_post(post_id: str):
    if post_id not in marketplace_posts_db:
        raise HTTPException(status_code=404, detail="Post not found")
    del marketplace_posts_db[post_id]
    # Remove replies too
    for rid in [rid for rid, r in marketplace_replies_db.items() if r["post_id"] == post_id]:
        del marketplace_replies_db[rid]
    return {"ok": True}

# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
