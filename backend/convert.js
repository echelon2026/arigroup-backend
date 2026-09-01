#!/usr/bin/env node

/**
 * Convert GLB to USDZ using gltf-transform
 * Usage: node convert.js <input.glb> <output.usdz>
 */

const fs = require('fs');
const path = require('path');

async function convertGLBToUSDZ(inputPath, outputPath) {
  try {
    const { NodeIO, Extension } = await import('@gltf-transform/core');
    const { KHRONOS_EXTENSIONS } = await import('@gltf-transform/extensions');

    // Check input file exists
    if (!fs.existsSync(inputPath)) {
      console.error(`Input file not found: ${inputPath}`);
      process.exit(1);
    }

    const io = new NodeIO()
      .registerExtensions(KHRONOS_EXTENSIONS);

    // Read the GLB file
    const glbData = fs.readFileSync(inputPath);
    const document = await io.readBinary(glbData);

    // Write as USDZ
    const usdzData = await io.writeUSDZ(document);
    fs.writeFileSync(outputPath, usdzData);

    console.log(`✓ Converted ${inputPath} to ${outputPath}`);
    process.exit(0);
  } catch (error) {
    console.error('Conversion failed:', error.message);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node convert.js <input.glb> <output.usdz>');
  process.exit(1);
}

convertGLBToUSDZ(args[0], args[1]);
