#!/bin/bash
set -e

echo "🔧 Installing Python dependencies..."
pip install -r requirements.txt

echo "🔧 Installing Node.js dependencies for gltf-transform..."
if command -v npm &> /dev/null; then
    echo "✓ npm found, installing gltf-transform globally..."
    npm install -g @gltf-transform/core @gltf-transform/extensions 2>/dev/null || echo "⚠ npm install had issues, but continuing..."
    gltf-transform --version 2>/dev/null && echo "✓ gltf-transform installed" || echo "⚠ gltf-transform not found in PATH"
else
    echo "⚠ npm not found in PATH - gltf-transform won't be available for local conversion"
    echo "  ℹ USDZ conversion will still work via external API if configured"
fi

echo "✓ Build complete!"
