from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
import os
from dotenv import load_dotenv
import qrcode
from io import BytesIO
import base64
import uuid
from datetime import datetime
import json
import tempfile
from model_converter import get_or_create_dual_format
from r2_storage import upload_model_to_r2, upload_usdz_to_r2, upload_usdz_to_r2_bytes, upload_metadata_to_r2, download_metadata_from_r2, R2_AVAILABLE

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
        print(f"📁 Converting {file_ext.upper()} model {model_id}...")
        formats = get_or_create_dual_format(temp_file_path, restaurant_id, model_id, temp_dir)
        print(f"📦 Formats after conversion: {formats}")

        # Determine, from the *original* upload's extension (not the
        # dual-format dict alone, which fills in a same-path fallback even
        # when conversion silently no-ops), whether a genuine USDZ sibling
        # exists to persist alongside the primary file.
        usdz_source_path = None
        if file_ext == "usdz":
            usdz_source_path = temp_file_path
        elif file_ext == "glb":
            candidate = formats.get("usdz_path")
            if (
                candidate
                and candidate != formats.get("glb_path")
                and os.path.exists(candidate)
                and os.path.getsize(candidate) > 0
            ):
                usdz_source_path = candidate
        # else: OBJ/glTF primary uploads - get_or_create_dual_format doesn't
        # attempt a real conversion for these, so there's nothing genuine to
        # persist as USDZ.

        # Upload the primary file to R2 or fall back to local storage
        primary_ext = file_ext
        if R2_AVAILABLE:
            try:
                primary_file = formats.get("glb_path") or temp_file_path
                primary_ext = os.path.splitext(primary_file)[1].lstrip('.') or file_ext
                file_url = upload_model_to_r2(primary_file, restaurant_id, model_id, primary_ext)
                storage_type = "Cloudflare R2 (persistent CDN)"
            except Exception as e:
                print(f"⚠️  R2 upload failed: {e}, falling back to local storage")
                file_url = temp_file_path
                primary_ext = file_ext
                storage_type = "temporary local storage"
        else:
            # Fall back to local temp storage if R2 not configured
            file_url = temp_file_path
            storage_type = "temporary local storage (R2 not configured)"

        # Persist the USDZ sibling to R2 too, under its own predictable key
        # (`{restaurant_id}/{model_id}.usdz`), so /model/{id}/usdz -- and
        # therefore iOS Quick Look AR -- works for every model that has one,
        # not just models that happened to be uploaded as USDZ directly.
        # Without this, get_or_create_dual_format()'s generated USDZ lived
        # only in `temp_dir`, which is deleted in the `finally` block below
        # before any client could ever fetch it.
        usdz_r2_url = None
        if usdz_source_path and R2_AVAILABLE:
            if usdz_source_path == temp_file_path and primary_ext == "usdz":
                # The primary upload above already put this exact USDZ file
                # in R2 (happens when USDZ was uploaded directly and GLB
                # conversion failed/was skipped) - reuse that URL instead of
                # uploading the same bytes twice.
                usdz_r2_url = file_url
            else:
                try:
                    usdz_r2_url = upload_usdz_to_r2(usdz_source_path, restaurant_id, model_id)
                except Exception as e:
                    print(f"Warning: failed to upload USDZ variant to R2: {e}")

        # file_url only actually contains GLB bytes when the primary upload
        # resolved to a .glb file (see primary_ext above) - surface that
        # explicitly so /model/{id}/info can report it distinctly from the
        # legacy file_path/file_type pair, which reflects the *originally
        # uploaded* format rather than what ended up at that URL.
        glb_r2_url = file_url if primary_ext == "glb" else None

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
            "glb_path": glb_r2_url,
            "usdz_path": usdz_r2_url,
            "created_at": datetime.utcnow().isoformat()
        }

        models_db[model_id] = model_data
        persist_models_index()

        if R2_AVAILABLE:
            try:
                upload_metadata_to_r2(model_id, model_data)
            except Exception as e:
                # Non-fatal: the model still works until this backend
                # instance restarts, it just won't survive that restart.
                print(f"Warning: failed to upload metadata sidecar to R2: {e}")

        return {
            "id": model_id,
            "message": f"Model uploaded successfully to {storage_type}",
            "file_url": file_url,
            "formats": formats,
            "storage": storage_type,
            "glb_path": glb_r2_url,
            "usdz_path": usdz_r2_url,
            "usdz_available": usdz_r2_url is not None,
        }
    finally:
        # Clean up temp directory
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)

@app.get("/models/{restaurant_id}")
async def list_models(restaurant_id: str):
    return [m for m in models_db.values() if m["restaurant_id"] == restaurant_id]

def get_qr_target_url(model_id: str) -> str:
    """The public AR viewer URL a model's QR code should point at."""
    frontend_url = os.getenv("FRONTEND_URL", "https://arigroup.space").rstrip("/")
    return f"{frontend_url}/view/{model_id}"


# In-memory cache of generated QR PNGs, keyed by model_id. The image is
# fully determined by model_id + FRONTEND_URL, so there's no reason to
# re-run QR generation on every scan or dashboard refresh.
_qr_png_cache: dict[str, bytes] = {}


def render_qr_png(target_url: str) -> bytes:
    """Render a QR code PNG for the given URL. Uses error-correction level H
    (the highest level - tolerates up to ~30% damage/obstruction) since
    these codes get printed, laminated, taped to surfaces, and scanned by
    ordinary phone cameras under imperfect real-world lighting."""
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,  # spec-minimum quiet zone; keeps scanners happy
    )
    qr.add_data(target_url)
    qr.make(fit=True)  # auto-picks the smallest version that fits the URL

    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def get_qr_png_for_model(model_id: str) -> bytes:
    cached = _qr_png_cache.get(model_id)
    if cached is not None:
        return cached
    png_bytes = render_qr_png(get_qr_target_url(model_id))
    _qr_png_cache[model_id] = png_bytes
    return png_bytes


@app.get("/qr/{model_id}")
async def get_qr_code(model_id: str):
    """Return a QR code PNG pointing at this model's public AR viewer URL
    (https://arigroup.space/view/{model_id}, or FRONTEND_URL if set).
    Meant to be used directly as an <img src>/download target - e.g. via
    the qr_code_url returned from /model/{model_id}/info."""
    get_model_or_404(model_id)
    png_bytes = get_qr_png_for_model(model_id)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f"inline; filename={model_id}.png",
        },
    )


@app.post("/qr/{model_id}")
async def generate_qr(model_id: str):
    """Legacy JSON-wrapped variant for the admin dashboard, which embeds the
    PNG as a base64 data URL for direct <img src> use client-side without a
    second request. New integrations should just use GET /qr/{model_id}."""
    get_model_or_404(model_id)
    qr_url = get_qr_target_url(model_id)
    png_bytes = get_qr_png_for_model(model_id)

    qr_id = str(uuid.uuid4())
    qr_codes_db[qr_id] = {
        "id": qr_id,
        "model_id": model_id,
        "code_url": qr_url,
        "created_at": datetime.utcnow().isoformat(),
    }

    return {
        "qr_id": qr_id,
        "qr_url": qr_url,
        "qr_image_url": f"data:image/png;base64,{base64.b64encode(png_bytes).decode()}",
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

def get_model_or_404(model_id: str) -> dict:
    """Look up a model's metadata, falling back to R2's metadata sidecar
    (see r2_storage.upload_metadata_to_r2) when it's missing from the
    in-memory/local-disk models_db -- which happens after every Render
    free-tier restart, since that store is ephemeral and previously was
    the *only* place model metadata lived. Repopulates models_db on a
    successful fallback so subsequent lookups in this process are fast."""
    model = models_db.get(model_id)
    if model is not None:
        return model

    if R2_AVAILABLE:
        model = download_metadata_from_r2(model_id)
        if model is not None:
            models_db[model_id] = model
            persist_models_index()
            return model

    raise HTTPException(status_code=404, detail="Model not found")


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
    model = get_model_or_404(model_id)
    return {
        "id": model["id"],
        "name": model.get("name"),
        "file_type": model.get("file_type"),
        "scale": model.get("scale", 1.0),
        # Explicit per-variant R2 URLs, persisted at upload time (see
        # /models/upload) - None when that variant isn't available for this
        # model (e.g. an OBJ upload has neither, an old model uploaded
        # before this field existed has no usdz_path).
        "glb_path": model.get("glb_path"),
        "usdz_path": model.get("usdz_path"),
        # The iOS AR viewer needs to know, before it tries anything, whether
        # a USDZ (the only format AR Quick Look accepts) actually exists for
        # this model.
        "usdz_available": bool(model.get("usdz_path")),
        # Relative path to this model's QR code PNG (GET /qr/{model_id}),
        # pointing at its public AR viewer URL. Relative so callers combine
        # it with whatever base URL they're already using for this API.
        "qr_code_url": f"/qr/{model_id}",
    }

@app.get("/model/{model_id}/usdz")
async def get_model_usdz(model_id: str):
    """Serve this model's USDZ variant for iOS AR Quick Look.

    Quick Look identifies AR content strictly by file extension/content
    type, and the primary /model/{model_id} endpoint serves whatever format
    was originally uploaded (usually GLB) behind an extension-less URL --
    which Quick Look cannot open. This gives iOS clients an unambiguous
    USDZ URL to point `ios-src`/`rel="ar"` at.

    /models/upload persists a real USDZ sibling to R2 (under
    `{restaurant_id}/{model_id}.usdz`) for every model where one is
    available -- whether it was uploaded directly or converted from GLB by
    get_or_create_dual_format() -- and records that URL as `usdz_path` on
    the model's metadata. This 404s (cleanly, so the frontend can fall back
    instead of showing a broken AR button) only when no USDZ variant is
    available at all, e.g. an OBJ upload, or a model uploaded before this
    field existed.
    """
    model = get_model_or_404(model_id)
    usdz_location = model.get("usdz_path")
    if not usdz_location:
        raise HTTPException(
            status_code=404,
            detail="No USDZ variant available for this model yet",
        )
    return await serve_model_variant(usdz_location, "usdz", model_id)


@app.post("/model/{model_id}/convert-usdz")
async def convert_model_to_usdz(model_id: str, glb_file: UploadFile = File(...)):
    """Convert GLB to USDZ on-demand when iOS user requests AR.

    Triggered by the iOS viewer when user clicks 'View in AR' and USDZ isn't available.
    Tries multiple conversion methods and returns the USDZ file directly.
    """
    try:
        # Read GLB file
        glb_content = await glb_file.read()
        if not glb_content:
            raise HTTPException(status_code=400, detail="GLB file is empty")

        print(f"🔄 Converting {glb_file.filename} to USDZ ({len(glb_content)} bytes)...")

        # Try conversion methods in order
        usdz_content = None

        # Method 1: Try gltf-transform if available
        import tempfile
        import subprocess
        with tempfile.TemporaryDirectory() as tmpdir:
            glb_path = os.path.join(tmpdir, f"{model_id}.glb")
            usdz_path = os.path.join(tmpdir, f"{model_id}.usdz")

            # Write GLB to temp file
            with open(glb_path, 'wb') as f:
                f.write(glb_content)

            # Try gltf-transform
            try:
                result = subprocess.run(
                    ['gltf-transform', 'convert', glb_path, usdz_path],
                    capture_output=True,
                    timeout=30
                )
                if result.returncode == 0 and os.path.exists(usdz_path):
                    with open(usdz_path, 'rb') as f:
                        usdz_content = f.read()
                    print(f"✓ Converted using gltf-transform ({len(usdz_content)} bytes)")
            except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                print(f"⚠ gltf-transform not available: {e}")

            # Method 2: Try npx gltf-transform
            if not usdz_content:
                try:
                    result = subprocess.run(
                        ['npx', 'gltf-transform', 'convert', glb_path, usdz_path],
                        capture_output=True,
                        timeout=30
                    )
                    if result.returncode == 0 and os.path.exists(usdz_path):
                        with open(usdz_path, 'rb') as f:
                            usdz_content = f.read()
                        print(f"✓ Converted using npx gltf-transform ({len(usdz_content)} bytes)")
                except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                    print(f"⚠ npx gltf-transform not available: {e}")

        # Method 4: Fallback to online conversion service
        if not usdz_content:
            print("⚠ gltf-transform not available - trying online converter...")
            try:
                # Use Babylon.js Playground's converter as fallback
                # Format: send GLB, get USDZ back
                import requests
                converter_url = "https://www.babylonjs-playground.com/api/convertToUSDZ"

                files = {'file': ('model.glb', glb_content, 'model/gltf-binary')}
                response = requests.post(converter_url, files=files, timeout=45)

                if response.status_code == 200:
                    usdz_content = response.content
                    print(f"✓ Converted using online service ({len(usdz_content)} bytes)")
                else:
                    print(f"⚠ Online converter returned {response.status_code}")
            except Exception as e:
                print(f"⚠ Online converter failed: {e}")

        # Final fallback: if still no USDZ, return error with instructions
        if not usdz_content:
            print("✗ All conversion methods exhausted")
            raise HTTPException(
                status_code=503,
                detail="USDZ conversion temporarily unavailable. Please try again in a moment or contact support."
            )

        # Return USDZ file
        return Response(
            content=usdz_content,
            media_type="model/vnd.usdz+zip",
            headers={"Content-Disposition": f"inline; filename={model_id}.usdz"}
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Conversion error: {e}")
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@app.post("/model/{model_id}/save-usdz")
async def save_model_usdz(model_id: str, usdz_file: UploadFile = File(...)):
    """Save a USDZ file that was converted on the client (iOS viewer).

    When iOS user requests AR, the frontend converts GLB→USDZ in the browser,
    then uploads it here to be persisted in R2 for future use.
    """
    model = get_model_or_404(model_id)
    restaurant_id = model.get("restaurant_id")

    try:
        # Read USDZ file content
        usdz_content = await usdz_file.read()

        if not usdz_content:
            raise HTTPException(status_code=400, detail="USDZ file is empty")

        # Upload to R2
        if R2_AVAILABLE:
            try:
                usdz_url = upload_usdz_to_r2_bytes(usdz_content, restaurant_id, model_id)

                # Update model metadata to record USDZ path
                model["usdz_path"] = usdz_url
                models_db[model_id] = model
                persist_models_index()

                try:
                    upload_metadata_to_r2(model_id, model)
                except Exception as e:
                    print(f"Warning: failed to update metadata sidecar: {e}")

                print(f"✓ USDZ saved for {model_id}: {usdz_url}")
                return {
                    "success": True,
                    "model_id": model_id,
                    "usdz_url": usdz_url,
                    "message": "USDZ file saved successfully"
                }
            except Exception as e:
                print(f"✗ Failed to upload USDZ to R2: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to save USDZ: {str(e)}"
                )
        else:
            raise HTTPException(
                status_code=503,
                detail="R2 storage not available"
            )

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Unexpected error saving USDZ: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

MODEL_MEDIA_TYPES = {
    "obj": "text/plain",
    "gltf": "model/gltf+json",
    "glb": "model/gltf-binary",
    "usdz": "model/vnd.usdz+zip"
}


async def serve_model_variant(file_location: str, file_type: str, model_id: str):
    """Shared file-serving logic for a single model variant (primary file,
    or a specific format like USDZ): fetches from R2 with authentication if
    `file_location` is an R2 URL, redirects for other https:// URLs, or
    serves from local disk as a fallback. Used by both /model/{id} (the
    model's primary/original format) and /model/{id}/usdz (its persisted
    USDZ sibling, if any)."""
    file_type = (file_type or "glb").lower()
    media_type = MODEL_MEDIA_TYPES.get(file_type, "application/octet-stream")

    # If it's an R2 URL, fetch with authentication and serve
    if file_location.startswith("https://") and "r2.cloudflarestorage.com" in file_location:
        from fastapi.responses import StreamingResponse
        try:
            response = await download_from_r2(file_location)
            return StreamingResponse(
                iter([response]),
                media_type=media_type,
                headers={"Content-Disposition": f"inline; filename={model_id}.{file_type}"}
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch from R2: {str(e)}")

    # If it's another HTTPS URL, redirect
    if file_location.startswith("https://"):
        return RedirectResponse(url=file_location, status_code=307)

    # Otherwise serve from local disk (fallback)
    if not os.path.exists(file_location):
        raise HTTPException(status_code=404, detail="Model file not found")

    from fastapi.responses import FileResponse
    file_size = os.path.getsize(file_location)

    return FileResponse(
        file_location,
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


@app.get("/model/{model_id}")
async def get_model_file(model_id: str):
    model = get_model_or_404(model_id)
    return await serve_model_variant(model["file_path"], model.get("file_type", "glb"), model_id)


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
