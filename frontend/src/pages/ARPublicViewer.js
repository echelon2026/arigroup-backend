import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '@google/model-viewer';
import '../styles/ARViewerModelViewer.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function ARPublicViewer() {
  const { restaurantId, productId } = useParams();
  const modelViewerRef = useRef(null);
  const arTriedRef = useRef(false);

  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [scale, setScale] = useState(1.0);
  const [productName, setProductName] = useState('');
  const [modelSrc, setModelSrc] = useState('');

  // Fetch product info to get model file
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await fetch(`${API_URL}/restaurants/${restaurantId}/products/${productId}`);
        if (!response.ok) throw new Error('Product not found');

        const data = await response.json();
        setProductName(data.name);
        setScale(data.scale || 1.0);

        // Construct model URL from the product's model file
        if (data.model_file) {
          setModelSrc(`${API_URL}/model/${data.model_file}`);
        } else {
          throw new Error('No model file found for this product');
        }
      } catch (error) {
        setErrorMessage(error.message);
        setStatus('error');
      }
    };

    fetchProduct();
  }, [restaurantId, productId]);

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
      {productName && (
        <div className="ar-header">
          <h2>{productName}</h2>
        </div>
      )}

      {modelSrc && (
        <model-viewer
          ref={modelViewerRef}
          src={modelSrc}
          alt={productName || '3D model'}
          ar
          ar-modes="scene-viewer quick-look webxr"
          camera-controls
          auto-rotate
          shadow-intensity="1"
          environment-image="neutral"
          scale={`${scale} ${scale} ${scale}`}
          class="model-viewer-element"
        />
      )}

      {status === 'loading' && (
        <div className="loading-overlay">
          <div className="spinner" aria-label="loading" />
          <p>Loading 3D model...</p>
        </div>
      )}
    </div>
  );
}

export default ARPublicViewer;
