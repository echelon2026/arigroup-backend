import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/ARViewerModelViewer.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function ARViewerModelViewer() {
  const { modelId } = useParams();
  const modelViewerRef = useRef(null);
  const [status, setStatus] = useState('Loading 3D model...');
  const [modelError, setModelError] = useState(false);
  const [modelInfo, setModelInfo] = useState(null);
  const [infoReady, setInfoReady] = useState(false); // true once fetch settles
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // Fetch model metadata
  useEffect(() => {
    fetch(`${API_URL}/model-info/${modelId}`)
      .then(r => r.ok ? r.json() : null)
      .then(info => {
        setModelInfo(info);
        setInfoReady(true);
        if (!info) {
          setModelError(true);
          setStatus('Model not found');
        }
      })
      .catch(() => {
        setInfoReady(true);
        setModelError(true);
        setStatus('Failed to load model info');
      });
  }, [modelId]);

  // Load model-viewer script once
  useEffect(() => {
    if (document.querySelector('script[data-mv]')) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
    script.setAttribute('data-mv', '1');
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => {
      setStatus('Failed to load AR viewer');
      setModelError(true);
    };
    document.head.appendChild(script);
  }, []);

  // Wire up model-viewer events and set ios-src via ref (React doesn't reliably
  // update custom-element attributes, so we use setAttribute directly)
  useEffect(() => {
    const mv = modelViewerRef.current;
    if (!mv || !scriptLoaded || !infoReady) return;

    // Set ios-src directly on the element when USDZ is available
    if (modelInfo?.has_ios) {
      mv.setAttribute('ios-src', `${API_URL}/model-ios/${modelId}`);
    } else {
      mv.removeAttribute('ios-src');
    }

    const onLoad = () => {
      if (isIOS) {
        setStatus(modelInfo?.has_ios
          ? 'Tap the AR button to view in your space'
          : '3D preview — upload a USDZ file to enable iOS AR'
        );
      } else {
        setStatus('Tap the AR button to place in your space');
      }
    };

    const onError = (e) => {
      console.error('model-viewer error', e);
      setStatus('Failed to load 3D model');
      setModelError(true);
    };

    const onArStatus = (e) => {
      const s = e.detail?.status;
      if (s === 'session-started') setStatus('AR active — point at a flat surface');
      else if (s === 'not-presenting') setStatus('Tap the AR button to view in your space');
      else if (s === 'failed') setStatus('AR not supported on this device/browser');
    };

    mv.addEventListener('load', onLoad);
    mv.addEventListener('error', onError);
    mv.addEventListener('ar-status', onArStatus);

    return () => {
      mv.removeEventListener('load', onLoad);
      mv.removeEventListener('error', onError);
      mv.removeEventListener('ar-status', onArStatus);
    };
  }, [scriptLoaded, infoReady, modelInfo, isIOS, modelId]);

  const modelSrc = `${API_URL}/model/${modelId}`;

  // Wait for both script and model-info before rendering model-viewer
  // so that ios-src is correct from the start (Quick Look needs it at render time)
  const ready = scriptLoaded && infoReady && !modelError;

  return (
    <div className="ar-viewer-mv">
      {!modelError ? (
        <>
          {ready ? (
            <model-viewer
              ref={modelViewerRef}
              src={modelSrc}
              alt={modelInfo?.name || '3D Model'}
              ar
              ar-modes="scene-viewer webxr quick-look"
              camera-controls
              touch-action="pan-y"
              auto-rotate
              shadow-intensity="1"
              loading="eager"
              class="model-viewer-element"
            />
          ) : (
            <div className="mv-loading">
              <div className="mv-spinner" />
              <p>Loading…</p>
            </div>
          )}

          <div className="ar-status-overlay">
            <div className="status-box">
              <p>{status}</p>
              {isIOS && infoReady && !modelInfo?.has_ios && (
                <p className="status-hint">
                  For iPhone AR, the venue needs to upload a USDZ model
                </p>
              )}
            </div>
          </div>

          <button
            className="exit-btn"
            onClick={() => { window.location.href = '/'; }}
          >
            ✕ Exit
          </button>
        </>
      ) : (
        <div className="error-screen">
          <div className="error-message">
            <p>{status}</p>
            <button onClick={() => window.location.href = '/'}>Return to Dashboard</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ARViewerModelViewer;
