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


def get_content_type(file_ext: str) -> str:
    """Get correct content type for 3D model files"""
    content_types = {
        "glb": "model/gltf-binary",
        "gltf": "model/gltf+json",
        "usdz": "model/vnd.usdz+zip",
        "obj": "text/plain",
    }
    return content_types.get(file_ext.lower(), "application/octet-stream")


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
