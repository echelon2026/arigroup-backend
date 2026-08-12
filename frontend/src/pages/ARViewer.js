import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import '../styles/ARViewer.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function ARViewer() {
  const { modelId } = useParams();
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const modelRef = useRef(null);
  const sessionRef = useRef(null);
  const [status, setStatus] = useState('Ready to start');
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    // Auto-start AR when component mounts
    if (modelId && !permissionGranted) {
      const autoStart = async () => {
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for DOM to be ready
        initializeAR();
      };
      autoStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, permissionGranted]);

  const initializeAR = async () => {
    try {
      setStatus('📷 Accessing camera...');
      console.log('Starting AR initialization...');

      // Request camera permission IMMEDIATELY
      console.log('Requesting camera permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      console.log('Camera permission granted, stream:', stream);

      // Start displaying camera feed right away
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error('Video play error:', e));
      }

      setPermissionGranted(true);
      setStatus('⏳ Loading 3D model...');

      // Setup Three.js scene
      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
      );

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        canvas: canvasRef.current,
        preserveDrawingBuffer: true
      });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      rendererRef.current = renderer;

      // Lighting
      const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
      scene.add(light);

      // Load model
      await loadModelAsync(scene, `${API_URL}/model/${modelId}`);
      setModelLoaded(true);
      setStatus('✓ Tap to place object');

      // Check for WebXR support
      if (navigator.xr) {
        try {
          const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
          if (isSupported) {
            setStatus('📱 Point camera at a flat surface');
            initWebXR(scene, renderer, camera, stream);
            return;
          }
        } catch (e) {
          console.log('WebXR not available, using camera-based mode');
        }
      }

      // Fallback: Camera mode with simple placement
      initCameraMode(scene, renderer, camera, stream);

    } catch (error) {
      console.error('AR initialization error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);

      if (error.name === 'NotAllowedError') {
        setPermissionDenied(true);
        setStatus('❌ Camera permission was denied. Please allow camera access.');
      } else if (error.name === 'NotFoundError') {
        setStatus('❌ No camera found on this device.');
      } else if (error.name === 'SecurityError') {
        setStatus('❌ Camera access blocked (HTTPS required on some browsers)');
      } else if (error.name === 'TypeError') {
        setStatus('❌ Camera API not supported. Try a modern browser.');
      } else {
        setStatus(`❌ Error: ${error.name} - ${error.message}`);
      }
    }
  };

  const loadModelAsync = (scene, modelUrl) => {
    return new Promise((resolve, reject) => {
      loadModel(scene, modelUrl, () => resolve(), reject);
    });
  };

  const loadModel = async (scene, modelUrl, onSuccess, onError) => {
    try {
      const response = await fetch(modelUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const contentType = response.headers.get('content-type');
      const isGLTF = contentType?.includes('application/json') || contentType?.includes('gltf');

      if (isGLTF) {
        const loader = new GLTFLoader();
        loader.load(url, (gltf) => {
          const model = gltf.scene;
          model.scale.set(0.5, 0.5, 0.5);
          model.position.set(0, 0, -1);
          model.visible = false;
          scene.add(model);
          modelRef.current = model;
          onSuccess?.();
        }, undefined, onError);
      } else {
        const loader = new OBJLoader();
        loader.load(url, (obj) => {
          obj.scale.set(0.5, 0.5, 0.5);
          obj.position.set(0, 0, -1);
          obj.visible = false;
          scene.add(obj);
          modelRef.current = obj;
          onSuccess?.();
        }, undefined, onError);
      }
    } catch (error) {
      onError?.(error);
    }
  };

  const initWebXR = async (scene, renderer, camera, stream) => {
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay', 'dom-overlay-for-handheld-ar'],
        optionalFeatures: ['light-estimation'],
        domOverlay: { root: document.body }
      });

      sessionRef.current = session;
      renderer.xr.setSession(session);
      setArActive(true);

      const space = await session.requestReferenceSpace('viewer');
      const hitTestSource = await session.requestHitTestSource({ space });

      let placed = false;
      let surfaceDetected = false;
      const reticle = createReticle(scene);

      const onXRFrame = (time, frame) => {
        const hitTestResults = frame.getHitTestResults(hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const hitPose = hit.getPose(space);

          if (hitPose) {
            reticle.visible = true;
            reticle.matrix.fromArray(hitPose.transform.matrix);
            reticle.matrixAutoUpdate = false;

            // Update surface detection status
            if (!surfaceDetected) {
              surfaceDetected = true;
              setStatus('✅ Flat surface found! Auto-placing model...');
            }

            // Auto-place model on first flat surface detection
            if (modelRef.current && !placed) {
              const position = new THREE.Vector3().setFromMatrixPosition(
                new THREE.Matrix4().fromArray(hitPose.transform.matrix)
              );
              modelRef.current.position.copy(position);
              modelRef.current.visible = true;
              placed = true;

              setStatus('✓ Model placed! Rotate device to view from different angles.');
              console.log('✓ Model auto-placed on flat surface');
            }
          }
        } else {
          reticle.visible = false;
          if (!placed && surfaceDetected) {
            surfaceDetected = false;
            setStatus('📱 Point camera at a flat surface');
          }
        }

        renderer.render(scene, camera);
      };

      renderer.xr.setAnimationLoop((time, frame) => onXRFrame(time, frame));
    } catch (error) {
      console.log('WebXR session failed, using camera mode:', error);
      initCameraMode(scene, renderer, camera, stream);
    }
  };

  const initCameraMode = (scene, renderer, camera, stream) => {
    setArActive(false);
    setStatus('📱 Camera Mode: Tap to place the model');

    let placed = false;
    let rotationY = 0;

    const handleCanvasClick = () => {
      if (modelRef.current && !placed) {
        modelRef.current.position.set(0, 0, -1.5);
        modelRef.current.visible = true;
        placed = true;
        setStatus('✓ Model placed! Pinch to zoom, drag to rotate.');
      }
    };

    if (canvasRef.current) {
      canvasRef.current.addEventListener('click', handleCanvasClick);
    }

    const animate = () => {
      requestAnimationFrame(animate);

      if (modelRef.current) {
        if (!placed) {
          modelRef.current.rotation.y += 0.003;
          modelRef.current.visible = true;
        } else {
          rotationY += 0.001;
          modelRef.current.rotation.y = rotationY;
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      if (canvasRef.current) {
        canvasRef.current.removeEventListener('click', handleCanvasClick);
      }
    };
  };

  const createReticle = (scene) => {
    const geometry = new THREE.RingGeometry(0.15, 0.2, 32);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x999999,
      emissiveIntensity: 0.5
    });
    const reticle = new THREE.Mesh(geometry, material);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
    return reticle;
  };

  const handleExitAR = () => {
    if (sessionRef.current) {
      sessionRef.current.end();
    }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    window.location.href = '/';
  };

  return (
    <div className="ar-viewer">
      {/* Camera feed background */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 0,
          transform: 'scaleX(-1)' // Mirror for selfie view
        }}
      />

      {/* Three.js canvas overlay */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1
        }}
      />

      {/* Container for scene */}
      <div
        ref={containerRef}
        className="ar-container"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 0
        }}
      />

      {/* UI Overlay */}
      <div className="ar-ui" style={{ zIndex: 10 }}>
        <div className="status-box">
          <p>{status}</p>
        </div>

        {!permissionGranted && (
          <div style={{
            position: 'fixed',
            bottom: '50px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.95)',
            color: 'white',
            padding: '30px',
            borderRadius: '15px',
            textAlign: 'center',
            zIndex: 20,
            maxWidth: '90%',
            width: '280px'
          }}>
            <p style={{ fontSize: '14px', marginBottom: '10px' }}>
              {permissionDenied
                ? '❌ Camera access denied. Tap to retry.'
                : '⏳ Loading camera...'}
            </p>
            {permissionDenied && (
              <button
                onClick={() => {
                  setPermissionDenied(false);
                  initializeAR();
                }}
                style={{
                  padding: '12px 30px',
                  fontSize: '14px',
                  background: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  width: '100%',
                  marginTop: '10px'
                }}
              >
                Try Again
              </button>
            )}
          </div>
        )}

        {permissionGranted && modelLoaded && (
          <button
            className="exit-btn"
            onClick={handleExitAR}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              zIndex: 20
            }}
          >
            ✕ Exit
          </button>
        )}

        {permissionGranted && !modelLoaded && (
          <div style={{
            position: 'absolute',
            bottom: '50px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.6)',
            color: 'white',
            padding: '15px 30px',
            borderRadius: '25px',
            zIndex: 20
          }}>
            <p>Loading 3D model...</p>
          </div>
        )}

        {arActive && modelLoaded && (
          <div style={{
            position: 'absolute',
            bottom: '50px',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            zIndex: 20
          }}>
            <div style={{
              fontSize: '14px',
              color: 'white',
              textShadow: '0 0 10px rgba(0,0,0,0.7)',
              background: 'rgba(0,0,0,0.5)',
              padding: '10px 20px',
              borderRadius: '20px'
            }}>
              Move camera to find a flat surface
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ARViewer;
