import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '@google/model-viewer';
import { isInAppBrowser } from '../utils/platformDetection';
import '../styles/ARVieweriOS.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function ARVieweriOS() {
  const params = useParams();
  const rawModelId = params['*'] || '';
  const modelId = /^https?:\/(?!\/)/.test(rawModelId)
    ? rawModelId.replace(/^(https?:)\//, '$1//')
    : rawModelId;

  const modelViewerRef = useRef(null);
  const arTriedRef = useRef(false);

  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [scale, setScale] = useState(1.0);
  const [modelName, setModelName] = useState('');
  const [usdzUrl, setUsdzUrl] = useState(null);
  const [arSessionMessage, setArSessionMessage] = useState('');

  const inAppBrowser = isInAppBrowser();
  const isBackendHosted = !modelId.startsWith('http');

  const modelSrc = isBackendHosted ? `${API_URL}/model/${modelId}` : modelId;

  // Fetch model metadata including USDZ URL
  useEffect(() => {
    if (!isBackendHosted) return;

    const fetchModelMetadata = async () => {
      try {
        const response = await fetch(`${API_URL}/model/${modelId}/info`);
        if (response.ok) {
          const data = await response.json();
          setScale(data.scale || 1.0);
          setModelName(data.name || '');
          if (data.usdz_url) {
            setUsdzUrl(data.usdz_url);
            console.log('✓ USDZ available:', data.usdz_url);
          } else {
            console.log('⚠ No USDZ available for this model');
          }
        }
      } catch (err) {
        console.error('Error fetching model info:', err);
      }
    };

    fetchModelMetadata();
  }, [modelId, isBackendHosted]);

  // Set ios-src and ar attributes based on USDZ availability
  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el) return;

    if (usdzUrl) {
      el.setAttribute('ios-src', usdzUrl);
      el.setAttribute('ar', 'true');
      el.setAttribute('ar-modes', 'quick-look webxr scene-viewer');
      console.log('✓ iOS Quick Look enabled with USDZ');
    } else {
      el.removeAttribute('ios-src');
      el.setAttribute('ar', 'true');
      el.setAttribute('ar-modes', 'webxr scene-viewer');
      console.log('⚠ Using WebXR fallback (no USDZ)');
    }
  }, [usdzUrl]);

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
      setArSessionMessage('AR could not start. Make sure you\'re viewing this page in Safari.');
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
      setArSessionMessage('AR isn\'t supported on this device.');
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

  return (
    <div className="ar-viewer-ios">
      <model-viewer
        ref={modelViewerRef}
        src={modelSrc}
        alt={modelName || '3D model'}
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
        <button
          slot="ar-button"
          className="ios-ar-button"
          onClick={handleViewInAR}
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

      {status === 'ready' && !usdzUrl && (
        <div className="ios-ar-unavailable-banner">
          3D preview available. AR requires USDZ format.
        </div>
      )}

      {arSessionMessage && (
        <div className="ios-ar-session-banner">{arSessionMessage}</div>
      )}

      {inAppBrowser && status === 'ready' && usdzUrl && (
        <div className="ios-in-app-banner">
          For best AR experience, open in Safari.
        </div>
      )}

      <button className="ios-exit-btn" onClick={() => { window.history.back(); }}>
        ← Back
      </button>
    </div>
  );
}

export default ARVieweriOS;
