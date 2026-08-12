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

// Real-world AR display cap, in meters, for the model's longest dimension.
// glTF/GLB treats 1 unit = 1 meter, but a lot of export pipelines (and, in
// this app's case, an upload-time "scale" field that was collected but
// never actually applied anywhere) don't calibrate to that, so models can
// come through many times larger than intended and blow up to room-size in
// AR. This is a last-resort safety net applied after the per-model scale
// below, not a replacement for exporting/uploading at a sane size.
const MAX_AR_METERS = 0.5;

const isIOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as "MacIntel" with touch support, indistinguishable
    // from a real Mac unless you check for touch points.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

function ARViewerModelViewer() {
  const { modelId } = useParams();
  const modelViewerRef = useRef(null);
  const metaScaleRef = useRef(1);
  const arLaunchedRef = useRef(false);
  const tapListenerRef = useRef(null);
  const [status, setStatus] = useState('Loading 3D model...');
  const [modelError, setModelError] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [arSupported, setArSupported] = useState(null); // null = unknown yet
  const [coldStartHint, setColdStartHint] = useState(false);
  const [instantArAvailable, setInstantArAvailable] = useState(false);
  const [showManualArFallback, setShowManualArFallback] = useState(false);

  const modelSrc = `${API_URL}/model/${modelId}`;

  // Fetch the per-model scale that was set at upload time. Stored in a ref
  // (not state) so it never becomes a React-controlled prop on
  // <model-viewer> — applying it imperatively in handleLoad, alongside the
  // AR-size cap below, means a late-arriving fetch can never stomp a scale
  // value handleLoad already computed and set directly on the element.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/model/${modelId}/info`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && Number.isFinite(data.scale) && data.scale > 0) {
          metaScaleRef.current = data.scale;
        }
      })
      .catch(() => {
        // Non-fatal — falls back to the default scale of 1 plus whatever
        // the AR-size cap below decides.
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const disarmTapListener = useCallback(() => {
    if (tapListenerRef.current) {
      document.removeEventListener('pointerdown', tapListenerRef.current);
      tapListenerRef.current = null;
    }
  }, []);

  // Applies the uploaded model's scale, then measures the model's real
  // on-screen size (in meters, as AR will render it) and shrinks it further
  // if it's still bigger than a sane tabletop/handheld object — this is
  // what actually fixes "the cube loads too big in AR" regardless of what
  // scale (if any) was set when the model was uploaded.
  const applyArSafeScale = useCallback((el) => {
    if (!el) return;
    const base = metaScaleRef.current > 0 ? metaScaleRef.current : 1;
    el.setAttribute('scale', `${base} ${base} ${base}`);
    try {
      const dims = el.getDimensions();
      const maxDim = Math.max(dims.x, dims.y, dims.z);
      if (Number.isFinite(maxDim) && maxDim > MAX_AR_METERS) {
        const corrected = base * (MAX_AR_METERS / maxDim);
        el.setAttribute('scale', `${corrected} ${corrected} ${corrected}`);
      }
    } catch (e) {
      console.warn('AR auto-size check failed, using uploaded scale as-is:', e);
    }
  }, []);

  // Android: hand off to Scene Viewer directly with mode=ar_only and
  // resizable=false instead of going through model-viewer's default
  // activateAR() (which requests mode=ar_preferred). The default mode is
  // what puts up Scene Viewer's "View as object" AR/3D toggle and its
  // pinch-to-resize handle — both reported as unwanted extra UI. ar_only
  // skips straight into AR with no toggle, and resizable=false removes the
  // resize control. iOS/desktop/other still go through model-viewer's own
  // activateAR(), since Quick Look and WebXR don't expose an equivalent
  // "ar_only" hint to bypass through model-viewer's public API.
  const launchAR = useCallback(() => {
    const el = modelViewerRef.current;
    if (!el || arLaunchedRef.current) return;
    arLaunchedRef.current = true;
    disarmTapListener();

    if (isAndroid) {
      const fallback = window.location.href;
      const intentUrl =
        `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(modelSrc)}` +
        `&mode=ar_only&resizable=false#Intent;scheme=https;package=com.google.ar.core;` +
        `action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(fallback)};end;`;
      window.location.href = intentUrl;
    } else {
      el.activateAR();
    }
  }, [modelSrc, disarmTapListener]);

  const handleLoad = useCallback(() => {
    setModelReady(true);
    setModelError(false);
    setColdStartHint(false);

    applyArSafeScale(modelViewerRef.current);

    // canActivateAR reflects real, per-device/browser support (ARCore
    // Scene Viewer / ARKit Quick Look / in-page WebXR) and is only
    // accurate once the model itself has loaded.
    const canAR = !!modelViewerRef.current?.canActivateAR;
    setArSupported(canAR);
    setStatus(canAR ? '📱 Launching AR...' : '✓ Model loaded');

    if (canAR) {
      // Arm a first-tap-anywhere fallback on every platform. iOS in
      // particular requires AR to be triggered from inside a genuine user
      // gesture — WebKit will silently drop, or half-launch, an AR handoff
      // that comes from a setTimeout, and a half-launch is exactly what
      // produces Quick Look's "object could not be opened" error. Since
      // this is a full-screen AR view, the user's very first touch
      // (whether meant to tap a button or just look at the model) fires
      // this immediately, so it reads as automatic without ever needing an
      // explicit "View in AR" button. It also safety-nets Android/desktop
      // in case the eager auto-launch below doesn't fire.
      const armedListener = (event) => {
        if (event.target?.closest?.('.exit-btn')) return;
        launchAR();
      };
      tapListenerRef.current = armedListener;
      document.addEventListener('pointerdown', armedListener);

      // Eager auto-launch: safe on Android/desktop, where the Scene
      // Viewer/WebXR handoff isn't gated behind a trusted user gesture the
      // way iOS Quick Look is. Skipped on iOS — see armedListener above.
      if (!isIOS) {
        setTimeout(() => {
          launchAR();
        }, 500);
      }

      // Last-resort visible fallback, only if nothing above has managed to
      // launch AR after a few seconds (unusual browser, listener never
      // fired, etc.) — not shown in the normal case, so it doesn't add back
      // the extra "unwanted button" this whole flow is trying to avoid.
      setTimeout(() => {
        if (!arLaunchedRef.current) setShowManualArFallback(true);
      }, 4000);
    }
  }, [applyArSafeScale, launchAR]);

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
      arLaunchedRef.current = true;
      setShowManualArFallback(false);
      disarmTapListener();
      setStatus('📱 Point your camera at a flat surface, then tap to place');
    } else if (arStatus === 'object-placed') {
      setStatus('✓ Placed! Move around to view it from any angle');
    } else if (arStatus === 'failed') {
      // Allow another attempt (e.g. via the manual fallback button) rather
      // than staying permanently latched as "launched".
      arLaunchedRef.current = false;
      setShowManualArFallback(true);
      setStatus('❌ AR session failed to start on this device');
    } else if (arStatus === 'not-presenting') {
      setStatus(modelReady ? '✓ Ready — tap "View in your space"' : 'Loading 3D model...');
    }
  }, [modelReady, disarmTapListener]);

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
      disarmTapListener();
    };
  }, [handleLoad, handleError, handleProgress, handleArStatus, disarmTapListener]);

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
    launchAR();
  };

  const retry = () => {
    setModelError(false);
    setModelReady(false);
    setColdStartHint(false);
    setStatus('Loading 3D model...');
    arLaunchedRef.current = false;
    setShowManualArFallback(false);
    disarmTapListener();
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
            ar-scale="fixed"
            crossorigin="anonymous"
            camera-controls
            touch-action="pan-y"
            auto-rotate
            shadow-intensity="1"
            environment-image="neutral"
            loading="eager"
            reveal="auto"
            class="model-viewer-element"
          >
            {/* model-viewer renders its own floating default AR button
                (one more piece of unwanted UI) unless something is slotted
                into ar-button. AR launching here is entirely driven by our
                own code (auto-launch + tap-anywhere + the manual fallback
                button below), so this stays empty/invisible — it only
                exists to suppress that default. */}
            <button slot="ar-button" className="ar-button-slot-suppressed" aria-hidden="true" tabIndex={-1} />
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

          {modelReady && arSupported && showManualArFallback && (
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
