import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
// Bundled (not a CDN <script> tag) so the <model-viewer> custom element is
// guaranteed to be registered before React ever renders it.
import '@google/model-viewer';
import '../styles/ARViewerModelViewer.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function ARViewerModelViewer() {
  const { modelId } = useParams();
  const modelViewerRef = useRef(null);
  const arTriedRef = useRef(false);

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState('');

  const modelSrc = `${API_URL}/model/${modelId}`;

  // Fires once the GLB has downloaded and parsed successfully.
  const handleLoad = useCallback(() => {
    setStatus('ready');

    const el = modelViewerRef.current;
    if (!el || arTriedRef.current) return;
    arTriedRef.current = true;

    // Best-effort auto-launch straight into AR. model-viewer picks the
    // right native handoff itself (Scene Viewer on Android, Quick Look on
    // iOS, in-page WebXR elsewhere) based on the ar-modes list below, and
    // no-ops safely if the device/browser doesn't support any of them —
    // the model still renders in the normal 3D view either way, and the
    // built-in "View in AR" button (rendered automatically by the `ar`
    // attribute whenever el.canActivateAR is true) stays available so the
    // user can trigger it manually if the auto-attempt doesn't go through.
    if (el.canActivateAR) {
      el.activateAR();
    }
  }, []);

  const handleError = useCallback((event) => {
    setStatus('error');
    setErrorMessage(event?.detail?.type || 'Failed to load model');
  }, []);

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el) return undefined;

    el.addEventListener('load', handleLoad);
    el.addEventListener('error', handleError);

    return () => {
      el.removeEventListener('load', handleLoad);
      el.removeEventListener('error', handleError);
    };
  }, [handleLoad, handleError]);

  const retry = () => {
    arTriedRef.current = false;
    setErrorMessage('');
    setStatus('loading');
    const el = modelViewerRef.current;
    if (el) {
      const src = el.src;
      el.src = '';
      el.src = src;
    }
  };

  if (status === 'error') {
    return (
      <div className="ar-viewer-mv">
        <div className="error-screen">
          <div className="error-message">
            <p>Could not load this model.</p>
            {errorMessage && <p className="error-detail">{errorMessage}</p>}
            <button onClick={retry}>Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ar-viewer-mv">
      <model-viewer
        ref={modelViewerRef}
        src={modelSrc}
        alt="3D model"
        ar
        ar-modes="scene-viewer quick-look webxr"
        camera-controls
        auto-rotate
        shadow-intensity="1"
        environment-image="neutral"
        class="model-viewer-element"
      />

      {status === 'loading' && (
        <div className="loading-overlay">
          <div className="spinner" aria-label="loading" />
          <p>Loading 3D model...</p>
        </div>
      )}

      <button className="exit-btn" onClick={() => { window.location.href = '/'; }}>
        ✕ Exit
      </button>
    </div>
  );
}

export default ARViewerModelViewer;
