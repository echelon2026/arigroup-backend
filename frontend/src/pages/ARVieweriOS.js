import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
// Bundled (not a CDN <script> tag) so the <model-viewer> custom element is
// guaranteed to be registered before React ever renders it.
import '@google/model-viewer';
import { isInAppBrowser, supportsQuickLook } from '../utils/platformDetection';
import '../styles/ARVieweriOS.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

/**
 * iOS-specific AR viewer.
 *
 * This intentionally is NOT just ARViewerModelViewer with a different CSS
 * file. iOS's AR pipeline (AR Quick Look) differs from Android's (Scene
 * Viewer) in ways that change what "correct" model-viewer usage looks
 * like:
 *
 *  - Quick Look only accepts USDZ, never GLB, and identifies it by file
 *    extension/content-type -- so this viewer resolves a dedicated
 *    `ios-src` USDZ URL and never assumes the GLB will "just work" the
 *    way ar-modes="scene-viewer" does on Android.
 *  - Quick Look must be launched from a genuine tap. A QR-code visit has
 *    no prior user gesture, so (unlike ARViewerModelViewer, which
 *    auto-calls activateAR() the instant the model loads) this viewer
 *    always waits for an explicit "View in AR" tap.
 *  - Once Quick Look is presenting, ARKit does its own lighting
 *    estimation/shadows -- environment-image/shadow-intensity here only
 *    style the in-page 3D preview, not the AR session itself.
 *  - Quick Look is a Safari/SFSafariViewController-only feature. Most iOS
 *    AR traffic arrives via in-app browsers (Instagram/TikTok/etc. QR
 *    scans), where Apple simply does not allow Quick Look to present no
 *    matter what the page does -- so this viewer detects that case and
 *    tells the user to open in Safari instead of letting the tap silently
 *    fail.
 */
function ARVieweriOS() {
  // Same wildcard route shape as ARViewerModelViewer -- see that file for
  // why this can't be a plain ":modelId" param (full model URLs contain
  // slashes).
  const params = useParams();
  const rawModelId = params['*'] || '';
  const modelId = /^https?:\/(?!\/)/.test(rawModelId)
    ? rawModelId.replace(/^(https?:)\//, '$1//')
    : rawModelId;

  const modelViewerRef = useRef(null);
  const isBackendHosted = !modelId.startsWith('http');

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState('');
  const [scale, setScale] = useState(1.0);
  const [modelName, setModelName] = useState('');
  const [usdzSrc, setUsdzSrc] = useState(null);
  const [usdzChecked, setUsdzChecked] = useState(false);
  const [arSessionMessage, setArSessionMessage] = useState('');

  const inAppBrowser = isInAppBrowser();
  const quickLookCapable = supportsQuickLook();

  const modelSrc = isBackendHosted ? `${API_URL}/model/${modelId}` : modelId;

  // Resolve model metadata (scale, name) and -- critically for iOS -- the
  // dedicated USDZ URL. A full public URL that already points at a .usdz
  // file can be used directly; a full URL pointing at .glb has no known
  // USDZ sibling, so AR is simply unavailable for it. Backend-hosted
  // model IDs ask /model/{id}/info, which tells us definitively whether
  // /model/{id}/usdz will resolve (see backend app.py) instead of firing
  // a speculative request and hoping.
  useEffect(() => {
    let cancelled = false;

    const resolveUsdz = async () => {
      if (!isBackendHosted) {
        if (/\.usdz$/i.test(modelId)) {
          if (!cancelled) setUsdzSrc(modelId);
        }
        if (!cancelled) setUsdzChecked(true);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/model/${modelId}/info`);
        if (response.ok) {
          const data = await response.json();
          if (cancelled) return;
          console.log('Model info loaded:', { usdz_available: data.usdz_available, name: data.name });
          setScale(data.scale || 1.0);
          setModelName(data.name || '');
          if (data.usdz_available) {
            setUsdzSrc(`${API_URL}/model/${modelId}/usdz`);
          }
        } else {
          console.warn(`Failed to load model info: HTTP ${response.status}`);
        }
      } catch (err) {
        console.error('Error fetching model info:', err);
      } finally {
        if (!cancelled) setUsdzChecked(true);
      }
    };

    resolveUsdz();
    return () => {
      cancelled = true;
    };
  }, [modelId, isBackendHosted]);

  const handleLoad = useCallback(() => {
    setStatus('ready');
  }, []);

  const handleError = useCallback((event) => {
    setStatus('error');
    const errorDetail = event?.detail;
    const errorMsg = errorDetail?.type || errorDetail?.message || 'Failed to load model';
    console.error('Model viewer error:', errorDetail);
    setErrorMessage(errorMsg);
  }, []);

  const handleArStatus = useCallback((event) => {
    const s = event?.detail?.status;
    if (s === 'failed') {
      setArSessionMessage('AR could not start. Make sure you’re viewing this page in Safari.');
    } else if (s === 'session-started') {
      setArSessionMessage('');
    }
  }, []);

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el) return undefined;

    el.addEventListener('load', handleLoad);
    el.addEventListener('error', handleError);
    el.addEventListener('ar-status', handleArStatus);

    return () => {
      el.removeEventListener('load', handleLoad);
      el.removeEventListener('error', handleError);
      el.removeEventListener('ar-status', handleArStatus);
    };
  }, [handleLoad, handleError, handleArStatus]);

  // Set ios-src, ar, and ar-modes based on USDZ availability.
  // React JSX doesn't handle hyphenated attributes well, so set them via DOM.
  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el) return;

    if (usdzSrc) {
      el.setAttribute('ios-src', usdzSrc);
      el.setAttribute('ar', 'true');
      el.setAttribute('ar-modes', 'quick-look');
      console.log('✓ USDZ enabled for iOS AR Quick Look');
    } else {
      el.removeAttribute('ios-src');
      el.removeAttribute('ar');
      el.setAttribute('ar-modes', 'none');
      console.log('⚠ USDZ not available - AR disabled, 3D preview only');
    }
  }, [usdzSrc]);

  const retry = () => {
    setErrorMessage('');
    setStatus('loading');
    const el = modelViewerRef.current;
    if (el) {
      const src = el.src;
      el.src = '';
      el.src = src;
    }
  };

  // Requires a real tap -- see the file-level comment on why this can't be
  // auto-triggered on load the way the Android viewer does.
  const handleViewInAR = () => {
    if (inAppBrowser) {
      setArSessionMessage(
        'AR only works in Safari. Tap the ••• menu above and choose "Open in Safari".'
      );
      return;
    }
    const el = modelViewerRef.current;
    if (el && el.canActivateAR) {
      setArSessionMessage('');
      el.activateAR();
    } else {
      setArSessionMessage('AR isn’t supported on this device.');
    }
  };

  if (status === 'error') {
    return (
      <div className="ar-viewer-ios">
        <div className="ios-error-screen">
          <div className="ios-error-message">
            <p>Could not load this model.</p>
            {errorMessage && <p className="ios-error-detail">{errorMessage}</p>}
            <button onClick={retry}>Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  const canOfferAR = usdzChecked && Boolean(usdzSrc) && quickLookCapable;

  return (
    <div className="ar-viewer-ios">
      <model-viewer
        ref={modelViewerRef}
        src={modelSrc}
        alt={modelName || '3D model'}
        ar-scale="fixed"
        ar-placement="floor"
        camera-controls
        touch-action="pan-y"
        disable-pan
        interaction-prompt="when-focused"
        interaction-prompt-style="wiggle"
        interaction-prompt-threshold="1500"
        camera-orbit="0deg 75deg 105%"
        min-camera-orbit="auto 20deg auto"
        max-camera-orbit="auto 100deg auto"
        field-of-view="30deg"
        shadow-intensity="0.9"
        shadow-softness="1"
        exposure="1.1"
        environment-image="neutral"
        scale={`${scale} ${scale} ${scale}`}
        loading="eager"
        reveal="auto"
        class="model-viewer-element"
      >
        {/* Custom AR trigger: model-viewer's default AR button is
            replaced with an app-styled one via this slot, per
            model-viewer's supported customization API. Kept disabled
            until we've actually confirmed a USDZ exists, so users on
            models without one never hit a silent failure. */}
        <button
          slot="ar-button"
          className="ios-ar-button"
          onClick={handleViewInAR}
          disabled={!canOfferAR && usdzChecked}
        >
          View in your space
        </button>
      </model-viewer>

      {status === 'loading' && (
        <div className="ios-loading-overlay">
          <div className="ios-spinner" aria-label="loading" />
          <p>Loading 3D model...</p>
        </div>
      )}

      {status === 'ready' && usdzChecked && !usdzSrc && (
        <div className="ios-ar-unavailable-banner">
          AR view isn’t available for this model on iPhone/iPad yet — you can still rotate and zoom it above.
        </div>
      )}

      {arSessionMessage && (
        <div className="ios-ar-session-banner">{arSessionMessage}</div>
      )}

      {inAppBrowser && status === 'ready' && usdzSrc && (
        <div className="ios-in-app-banner">
          For AR, open this link in Safari.
        </div>
      )}

      <button className="ios-exit-btn" onClick={() => { window.history.back(); }}>
        ← Back
      </button>
    </div>
  );
}

export default ARVieweriOS;
