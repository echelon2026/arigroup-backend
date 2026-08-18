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
  const [debugInfo, setDebugInfo] = useState({
    url: '',
    fetching: false,
    fileSize: null,
    loadTime: null,
    corsHeaders: null,
    errors: []
  });
  const [showDebug, setShowDebug] = useState(false);

  const modelSrc = `${API_URL}/model/${modelId}`;

  // Monitor fetch for debugging
  useEffect(() => {
    const fetchModelInfo = async () => {
      setDebugInfo(prev => ({
        ...prev,
        url: modelSrc,
        fetching: true,
        errors: []
      }));

      try {
        const startTime = Date.now();
        const response = await fetch(modelSrc);
        const loadTime = Date.now() - startTime;

        setDebugInfo(prev => ({
          ...prev,
          fetching: false,
          fileSize: response.headers.get('content-length'),
          loadTime: `${loadTime}ms`,
          corsHeaders: {
            'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
            'content-type': response.headers.get('content-type'),
            'status': response.status
          }
        }));

        if (!response.ok) {
          setDebugInfo(prev => ({
            ...prev,
            errors: [...prev.errors, `HTTP ${response.status} from ${modelSrc}`]
          }));
        }
      } catch (error) {
        setDebugInfo(prev => ({
          ...prev,
          fetching: false,
          errors: [...prev.errors, `Fetch error: ${error.message}`]
        }));
      }
    };

    fetchModelInfo();
  }, [modelSrc]);

  // Fires once the GLB has downloaded and parsed successfully.
  const handleLoad = useCallback(() => {
    setStatus('ready');

    const el = modelViewerRef.current;
    if (!el || arTriedRef.current) return;
    arTriedRef.current = true;

    if (el.canActivateAR) {
      el.activateAR();
    }
  }, []);

  const handleError = useCallback((event) => {
    setStatus('error');
    const errorType = event?.detail?.type || 'Failed to load model';
    setErrorMessage(errorType);
    setDebugInfo(prev => ({
      ...prev,
      errors: [...prev.errors, `model-viewer error: ${errorType}`]
    }));
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

      {/* Debug Panel Toggle */}
      <button
        className="debug-toggle"
        onClick={() => setShowDebug(!showDebug)}
        title="Toggle debug info"
      >
        🐛
      </button>

      {/* Debug Panel */}
      {showDebug && (
        <div className="debug-panel">
          <div className="debug-header">
            <h3>Debug Info</h3>
            <button onClick={() => setShowDebug(false)}>✕</button>
          </div>
          <div className="debug-content">
            <div className="debug-item">
              <strong>Model ID:</strong>
              <code>{modelId}</code>
            </div>
            <div className="debug-item">
              <strong>URL:</strong>
              <code>{modelSrc}</code>
            </div>
            <div className="debug-item">
              <strong>Status:</strong>
              <span className={`status-${status}`}>{status}</span>
            </div>
            {debugInfo.fileSize && (
              <div className="debug-item">
                <strong>File Size:</strong>
                <span>{(debugInfo.fileSize / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            )}
            {debugInfo.loadTime && (
              <div className="debug-item">
                <strong>Load Time:</strong>
                <span>{debugInfo.loadTime}</span>
              </div>
            )}
            {debugInfo.corsHeaders?.status && (
              <div className="debug-item">
                <strong>HTTP Status:</strong>
                <span className={debugInfo.corsHeaders.status === 200 ? 'success' : 'error'}>
                  {debugInfo.corsHeaders.status}
                </span>
              </div>
            )}
            {debugInfo.corsHeaders?.['content-type'] && (
              <div className="debug-item">
                <strong>Content Type:</strong>
                <code>{debugInfo.corsHeaders['content-type']}</code>
              </div>
            )}
            {debugInfo.errors.length > 0 && (
              <div className="debug-item errors">
                <strong>Errors ({debugInfo.errors.length}):</strong>
                <div className="error-list">
                  {debugInfo.errors.map((err, i) => (
                    <div key={i} className="error-entry">{err}</div>
                  ))}
                </div>
              </div>
            )}
            {debugInfo.fetching && (
              <div className="debug-item">
                <strong>Fetching...</strong>
              </div>
            )}
          </div>
        </div>
      )}

      <button className="exit-btn" onClick={() => { window.location.href = '/'; }}>
        ✕ Exit
      </button>
    </div>
  );
}

export default ARViewerModelViewer;
