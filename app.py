from fastapi import FastAPI, UploadFile, File, HTTPException, Form
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
    _load_json(MODELS_JSON, models_db)
    _load_json(RESTAURANTS_JSON, restaurants_db)
    init_test_data()  # adds test restaurants only if not already present

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
    _save_json(MODELS_JSON, models_db)

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
