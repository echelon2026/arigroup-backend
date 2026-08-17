import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/ARViewerModelViewer.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function ARViewerModelViewer() {
  const { modelId } = useParams();
  const modelViewerRef = useRef(null);
  const [status, setStatus] = useState('Loading 3D model...');
  const [modelError, setModelError] = useState(false);

  useEffect(() => {
    // Load model-viewer library
    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
    script.async = true;
    script.onload = () => {
      setStatus('📱 Point camera at a flat surface');
    };
    script.onerror = () => {
      setStatus('❌ Failed to load AR viewer');
      setModelError(true);
    };
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        document.head.removeChild(script);
      }
    };
  }, []);

  const handleARStatus = (e) => {
    if (e.type === 'ar-status-changed') {
      const arStatus = modelViewerRef.current?.arStatus;
      if (arStatus === 'session-started') {
        setStatus('✅ AR active! Point at a flat surface...');
      } else if (arStatus === 'not-presenting') {
        setStatus('📱 Point camera at a flat surface');
      }
    }
  };

  const handleModelLoad = () => {
    setStatus('✓ Model ready! Tap AR to start');
  };

  const handleModelError = () => {
    setStatus('❌ Failed to load model');
    setModelError(true);
  };

  return (
    <div className="ar-viewer-mv">
      {!modelError ? (
        <>
          <model-viewer
            ref={modelViewerRef}
            src={`${API_URL}/model/${modelId}`}
            alt="3D Model"
            ar
            ar-modes="scene-viewer quick-look webxr"
            camera-controls
            touch-action="pan-y"
            auto-rotate
            loading="eager"
            onload={handleModelLoad}
            onerror={handleModelError}
            onAr-status-changed={handleARStatus}
            class="model-viewer-element"
          />
          <div className="ar-status-overlay">
            <div className="status-box">
              <p>{status}</p>
            </div>
          </div>
          <button
            className="exit-btn"
            onClick={() => {
              window.location.href = '/';
            }}
          >
            ✕ Exit
          </button>
        </>
      ) : (
        <div className="error-screen">
          <div className="error-message">
            <p>{status}</p>
            <button onClick={() => window.location.href = '/'}>
              Return to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ARViewerModelViewer;
