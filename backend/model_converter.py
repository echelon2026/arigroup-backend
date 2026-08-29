"""
Model format conversion utilities for dual-platform AR support.
Converts between GLB (web/Android) and USDZ (iOS) formats.
"""

import os
import subprocess
from pathlib import Path


def is_glb(file_path: str) -> bool:
    """Check if file is GLB format."""
    return file_path.lower().endswith('.glb')


def is_usdz(file_path: str) -> bool:
    """Check if file is USDZ format."""
    return file_path.lower().endswith('.usdz')


def convert_glb_to_usdz(glb_path: str, usdz_path: str) -> bool:
    """
    Convert GLB to USDZ format for iOS native AR.
    Falls back gracefully if conversion tools unavailable.

    Returns:
        True if conversion succeeded, False if skipped
    """
    try:
        # Try using gltf-transform if available
        result = subprocess.run(
            ['npx', 'gltf-transform', 'convert', glb_path, usdz_path],
            capture_output=True,
            timeout=30
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        # Conversion tool not available - model-viewer will fallback to GLB for iOS
        return False


def convert_usdz_to_glb(usdz_path: str, glb_path: str) -> bool:
    """
    Convert USDZ to GLB format for web/Android AR.
    Falls back gracefully if conversion tools unavailable.

    Returns:
        True if conversion succeeded, False if skipped
    """
    try:
        # Try using gltf-transform if available
        result = subprocess.run(
            ['npx', 'gltf-transform', 'convert', usdz_path, glb_path],
            capture_output=True,
            timeout=30
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        # Conversion tool not available - fallback to original
        return False


def get_or_create_dual_format(
    uploaded_file_path: str,
    restaurant_id: str,
    model_id: str,
    upload_dir: str
) -> dict:
    """
    Ensure both GLB and USDZ versions exist for a model.

    Returns:
        dict with 'glb_path' and 'usdz_path', or just original if conversion fails
    """
    base_path = os.path.join(upload_dir, restaurant_id, model_id)
    # The conversion subprocess writes its output to `{base_path}.{ext}`,
    # but nothing else ever creates the `{upload_dir}/{restaurant_id}/`
    # directory it lives in - without this, every conversion attempt fails
    # with ENOENT and silently looks like "conversion tool unavailable"
    # (ie. ends up on the graceful-fallback path below regardless of
    # whether gltf-transform itself is actually installed).
    os.makedirs(os.path.dirname(base_path), exist_ok=True)

    if is_glb(uploaded_file_path):
        glb_path = uploaded_file_path
        usdz_path = f"{base_path}.usdz"

        # Try to create USDZ for iOS
        convert_glb_to_usdz(glb_path, usdz_path)

        return {
            "glb_path": glb_path,
            "usdz_path": usdz_path if os.path.exists(usdz_path) else glb_path,
            "primary_format": "glb"
        }

    elif is_usdz(uploaded_file_path):
        usdz_path = uploaded_file_path
        glb_path = f"{base_path}.glb"

        # Try to create GLB for web/Android
        convert_usdz_to_glb(usdz_path, glb_path)

        return {
            "glb_path": glb_path if os.path.exists(glb_path) else usdz_path,
            "usdz_path": usdz_path,
            "primary_format": "usdz"
        }

    else:
        # OBJ or other format - just return as GLB path
        return {
            "glb_path": uploaded_file_path,
            "usdz_path": uploaded_file_path,
            "primary_format": "other"
        }
