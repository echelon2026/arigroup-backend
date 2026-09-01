"""
Cloudflare R2 storage integration for AR models
"""
import os
import boto3
from dotenv import load_dotenv

load_dotenv()

# Cloudflare R2 configuration
R2_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
R2_ACCESS_KEY = os.getenv("CLOUDFLARE_R2_ACCESS_KEY")
R2_SECRET_KEY = os.getenv("CLOUDFLARE_R2_SECRET_KEY")
R2_BUCKET_NAME = os.getenv("CLOUDFLARE_R2_BUCKET", "arigroup-models")
R2_CUSTOM_DOMAIN = os.getenv("CLOUDFLARE_R2_DOMAIN")  # e.g., models.arigroup.com

# Initialize R2 client
def get_r2_client():
    if not all([R2_ACCESS_KEY, R2_SECRET_KEY, R2_ACCOUNT_ID]):
        return None

    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY
    )

r2_client = get_r2_client()
R2_AVAILABLE = r2_client is not None


def upload_model_to_r2(file_path: str, restaurant_id: str, model_id: str, file_ext: str) -> str:
    """
    Upload model file to Cloudflare R2 and return the public URL

    Returns:
        Public URL of the uploaded file
    """
    if not R2_AVAILABLE:
        raise RuntimeError("Cloudflare R2 not configured - R2 credentials required")

    # Read file from disk
    with open(file_path, 'rb') as f:
        file_data = f.read()

    # Upload to R2
    r2_key = f"{restaurant_id}/{model_id}.{file_ext}"
    r2_client.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=r2_key,
        Body=file_data,
        ContentType=get_content_type(file_ext)
    )

    # Return public URL (either custom domain or R2 default)
    if R2_CUSTOM_DOMAIN:
        return f"https://{R2_CUSTOM_DOMAIN}/{r2_key}"
    else:
        return f"https://{R2_BUCKET_NAME}.{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{r2_key}"


def upload_usdz_to_r2(file_path: str, restaurant_id: str, model_id: str) -> str:
    """
    Upload a model's USDZ sibling to R2 under a fixed, predictable key
    (`{restaurant_id}/{model_id}.usdz`), independent of whatever format was
    uploaded as the model's primary file. This gives iOS Quick Look AR a
    stable URL to fetch regardless of whether the model was uploaded as
    GLB (then converted to USDZ) or as USDZ directly.

    Returns:
        Public URL of the uploaded USDZ file
    """
    return upload_model_to_r2(file_path, restaurant_id, model_id, "usdz")


def upload_usdz_to_r2_bytes(usdz_bytes: bytes, restaurant_id: str, model_id: str) -> str:
    """
    Upload USDZ bytes (from client-side conversion) to R2.
    Used when iOS frontend converts GLB→USDZ and uploads the result.

    Returns:
        Public URL of the uploaded USDZ file (no auth required)
    """
    if not R2_AVAILABLE:
        raise RuntimeError("Cloudflare R2 not configured - R2 credentials required")

    r2_key = f"{restaurant_id}/{model_id}.usdz"
    r2_client.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=r2_key,
        Body=usdz_bytes,
        ContentType="model/vnd.usdz+zip",
        # Important: ensure public access for iOS Quick Look
        # Quick Look doesn't use browser session/auth
        ACL="public-read"
    )

    # Use pub-{account}.r2.dev for public USDZ URLs
    # This ensures no auth required when Quick Look fetches the file
    if R2_CUSTOM_DOMAIN:
        public_url = f"https://{R2_CUSTOM_DOMAIN}/{r2_key}"
    else:
        # Use public R2 domain instead of authenticated endpoint
        public_url = f"https://pub-{R2_ACCOUNT_ID}.r2.dev/{r2_key}"

    print(f"✓ USDZ saved to public R2: {public_url}")
    return public_url


def get_content_type(file_ext: str) -> str:
    """Get correct content type for 3D model files"""
    content_types = {
        "glb": "model/gltf-binary",
        "gltf": "model/gltf+json",
        "usdz": "model/vnd.usdz+zip",
        "obj": "text/plain",
    }
    return content_types.get(file_ext.lower(), "application/octet-stream")


def upload_metadata_to_r2(model_id: str, metadata: dict) -> None:
    """Store a small JSON sidecar for a model's metadata in R2, under a flat
    `metadata/{model_id}.json` key (independent of restaurant_id). Render's
    free tier resets the backend's local disk (and in-memory models_db) on
    every redeploy and on every idle spin-down, which was silently making
    every previously issued QR code/link 404 with "Model not found" even
    though the GLB itself was still safely sitting in R2. This sidecar lets
    the backend reconstruct a model's metadata from R2 alone after a
    restart, instead of depending on ephemeral local state."""
    if not R2_AVAILABLE:
        raise RuntimeError("Cloudflare R2 not configured - R2 credentials required")

    import json
    r2_client.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=f"metadata/{model_id}.json",
        Body=json.dumps(metadata).encode("utf-8"),
        ContentType="application/json",
    )


def download_metadata_from_r2(model_id: str):
    """Fetch a model's metadata sidecar from R2. Returns None if it doesn't
    exist (e.g. the model was never uploaded, or predates this sidecar)."""
    if not R2_AVAILABLE:
        return None

    import json
    from botocore.exceptions import ClientError
    try:
        response = r2_client.get_object(Bucket=R2_BUCKET_NAME, Key=f"metadata/{model_id}.json")
        return json.loads(response["Body"].read())
    except ClientError:
        return None


def delete_model_from_r2(restaurant_id: str, model_id: str, file_ext: str) -> bool:
    """Delete model file from R2"""
    if not R2_AVAILABLE:
        return False

    try:
        r2_key = f"{restaurant_id}/{model_id}.{file_ext}"
        r2_client.delete_object(Bucket=R2_BUCKET_NAME, Key=r2_key)
        return True
    except Exception as e:
        print(f"Error deleting from R2: {e}")
        return False
