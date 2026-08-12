import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
// Bundling the library directly (instead of injecting a <script> tag that
// points at a CDN at runtime) guarantees the <model-viewer> custom element
// is registered before React ever tries to render it, and removes a whole
// class of "worked locally, blank on the phone" bugs caused by the CDN
// script losing the race against the first render or being blocked by a
// carrier/network filter.
import '@google/model-viewer';
import '../styles/ARViewerModelViewer.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Render's free tier spins the API down after ~15 min idle; the first
// request after that can take 30-60s to answer while the instance boots.
// Without this, the viewer just looks broken ("Loading..." forever) during
// that window, which is very likely what was happening during testing.
const COLD_START_HINT_MS = 8000;
const HARD_TIMEOUT_MS = 60000;

function ARViewerModelViewer() {
  const { modelId } = useParams();
  const modelViewerRef = useRef(null);
  const [status, setStatus] = useState('Loading 3D model...');
  const [modelError, setModelError] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [arSupported, setArSupported] = useState(null); // null = unknown yet
  const [coldStartHint, setColdStartHint] = useState(false);
  const [instantArAvailable, setInstantArAvailable] = useState(false);

  const modelSrc = `${API_URL}/model/${modelId}`;

  const handleLoad = useCallback(() => {
    setModelReady(true);
    setModelError(false);
    setColdStartHint(false);
    // canActivateAR reflects real, per-device/browser support (ARCore
    // Scene Viewer / ARKit Quick Look / in-page WebXR) and is only
    // accurate once the model itself has loaded.
    const canAR = !!modelViewerRef.current?.canActivateAR;
    setArSupported(canAR);
    setStatus(canAR ? '📱 Launching AR...' : '✓ Model loaded');

    // Auto-activate AR immediately when model loads and AR is supported
    if (canAR) {
      setTimeout(() => {
        modelViewerRef.current?.activateAR();
      }, 500);
    }
  }, []);

  const handleError = useCallback((event) => {
    console.error('model-viewer error:', event?.detail);
    setModelError(true);
    setStatus('❌ Could not load this model. It may have expired or the server is waking up — try again in a moment.');
  }, []);

  const handleProgress = useCallback((event) => {
    const pct = Math.round((event?.detail?.totalProgress || 0) * 100);
    if (pct > 0 && pct < 100) {
      setStatus(`Loading 3D model… ${pct}%`);
    }
  }, []);

  const handleArStatus = useCallback((event) => {
    const arStatus = event?.detail?.status;
    if (arStatus === 'session-started') {
      setStatus('📱 Point your camera at a flat surface, then tap to place');
    } else if (arStatus === 'object-placed') {
      setStatus('✓ Placed! Move around to view it from any angle');
    } else if (arStatus === 'failed') {
      setStatus('❌ AR session failed to start on this device');
    } else if (arStatus === 'not-presenting') {
      setStatus(modelReady ? '✓ Ready — tap "View in your space"' : 'Loading 3D model...');
    }
  }, [modelReady]);

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el) return undefined;

    el.addEventListener('load', handleLoad);
    el.addEventListener('error', handleError);
    el.addEventListener('progress', handleProgress);
    el.addEventListener('ar-status', handleArStatus);

    return () => {
      el.removeEventListener('load', handleLoad);
      el.removeEventListener('error', handleError);
      el.removeEventListener('progress', handleProgress);
      el.removeEventListener('ar-status', handleArStatus);
    };
  }, [handleLoad, handleError, handleProgress, handleArStatus]);

  // Cold-start / hard-timeout watchdog, independent of model-viewer's own
  // events (those never fire at all if the fetch just hangs).
  useEffect(() => {
    const hintTimer = setTimeout(() => {
      if (!modelReady && !modelError) {
        setColdStartHint(true);
        setStatus('⏳ Waking up the server… first load can take up to a minute');
      }
    }, COLD_START_HINT_MS);

    const hardTimer = setTimeout(() => {
      if (!modelReady && !modelError) {
        setModelError(true);
        setStatus('❌ Timed out loading the model. Please check your connection and try again.');
      }
    }, HARD_TIMEOUT_MS);

    return () => {
      clearTimeout(hintTimer);
      clearTimeout(hardTimer);
    };
  }, [modelReady, modelError]);

  // Real, tap-free auto-placement is only possible via a raw in-page WebXR
  // hit-test session (Chrome on ARCore-capable Android). Scene Viewer and
  // Quick Look are native OS hand-offs that always require one placement
  // tap by platform design — no web API can skip that step there. We
  // detect the one case where a truly automatic placement flow is
  // possible and offer it as an extra option rather than promising
  // something the platform won't allow.
  useEffect(() => {
    let cancelled = false;
    if (navigator.xr?.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-ar')
        .then((supported) => {
          if (!cancelled) setInstantArAvailable(supported);
        })
        .catch(() => {
          if (!cancelled) setInstantArAvailable(false);
        });
    }
    return () => { cancelled = true; };
  }, []);

  const activateAR = () => {
    modelViewerRef.current?.activateAR();
  };

  const retry = () => {
    setModelError(false);
    setModelReady(false);
    setColdStartHint(false);
    setStatus('Loading 3D model...');
    const el = modelViewerRef.current;
    if (el) {
      // Force a fresh fetch rather than relying on a cached failure.
      const src = el.src;
      el.src = '';
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
      el.src = src;
    }
  };

  return (
    <div className="ar-viewer-mv">
      {!modelError ? (
        <>
          <model-viewer
            ref={modelViewerRef}
            src={modelSrc}
            alt="3D Model"
            ar
            ar-modes="scene-viewer webxr quick-look"
            ar-placement="floor"
            ar-scale="auto"
            camera-controls
            touch-action="pan-y"
            auto-rotate
            shadow-intensity="1"
            environment-image="neutral"
            loading="eager"
            reveal="auto"
            class="model-viewer-element"
          >
            <button
              slot="ar-button"
              className="ar-cta-btn"
              style={{ display: modelReady && arSupported ? 'block' : 'none' }}
            >
              View in your space
            </button>
          </model-viewer>

          <div className="ar-status-overlay">
            <div className="status-box">
              <p>{status}</p>
              {coldStartHint && !modelError && (
                <div className="spinner" aria-label="loading" />
              )}
            </div>

            {modelReady && arSupported === false && (
              <div className="status-box status-box-secondary">
                <p>AR isn't supported by this browser/device. You can still rotate and pinch-to-zoom the 3D model above.</p>
              </div>
            )}

            {modelReady && arSupported && instantArAvailable && (
              <a href={`/view-webxr/${modelId}`} className="instant-ar-link">
                Try instant auto-placing AR (experimental)
              </a>
            )}
          </div>

          {modelReady && arSupported && (
            <button className="manual-ar-btn" onClick={activateAR}>
              📱 View in your space
            </button>
          )}

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
            <button onClick={retry}>Try Again</button>
            <button onClick={() => window.location.href = '/'} className="secondary-btn">
              Return to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ARViewerModelViewer;
