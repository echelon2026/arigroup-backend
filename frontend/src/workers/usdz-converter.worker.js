/* Web Worker for GLB → USDZ conversion using Three.js
 * Runs in background thread so UI stays responsive
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

let scene, camera, renderer;

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(256, 256);
  renderer.setClearColor(0x000000, 0);
}

self.onmessage = async (event) => {
  const { type, data } = event.data;

  try {
    if (type === 'CONVERT_TO_USDZ') {
      const { glbArrayBuffer, modelId } = data;

      if (!scene) initScene();

      // Load GLB into scene
      self.postMessage({ type: 'STATUS', status: 'Loading GLB...' });
      const glbBlob = new Blob([glbArrayBuffer], { type: 'model/gltf-binary' });
      const glbUrl = URL.createObjectURL(glbBlob);

      // Use THREE's GLTFLoader to load the model
      const loader = new THREE.GLTFLoader();
      const gltf = await new Promise((resolve, reject) => {
        loader.load(glbUrl, resolve, undefined, reject);
      });

      // Clear scene and add loaded model
      while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
      }
      scene.add(gltf.scene);

      // Adjust camera
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5;
      camera.position.z = cameraZ;
      camera.lookAt(scene.position);

      // Export to USDZ
      self.postMessage({ type: 'STATUS', status: 'Converting to USDZ...' });
      const exporter = new USDZExporter();
      const usdzBlob = await exporter.parse(gltf.scene);

      // Convert blob to ArrayBuffer
      const arrayBuffer = await usdzBlob.arrayBuffer();

      self.postMessage({
        type: 'CONVERSION_COMPLETE',
        data: {
          modelId,
          usdzArrayBuffer: arrayBuffer,
          size: arrayBuffer.byteLength
        }
      });

      URL.revokeObjectURL(glbUrl);
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      error: error.message || 'Conversion failed'
    });
  }
};
