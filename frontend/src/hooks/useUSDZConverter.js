import { useState } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export function useUSDZConverter() {
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState(null);

  const convertGLBToUSDZ = async (modelId, glbUrl) => {
    try {
      setConverting(true);
      setConvertError(null);

      console.log('🔄 Starting USDZ conversion for', modelId);

      // Fetch GLB file
      console.log('📥 Fetching GLB from:', glbUrl);
      const glbResponse = await fetch(glbUrl);
      if (!glbResponse.ok) {
        throw new Error(`Failed to fetch GLB: ${glbResponse.status}`);
      }
      const glbBlob = await glbResponse.blob();
      const glbSize = (glbBlob.size / 1024 / 1024).toFixed(2);
      console.log(`✓ Fetched GLB: ${glbSize} MB`);

      // Send to backend for conversion
      console.log('🔄 Converting GLB to USDZ on backend...');

      const formData = new FormData();
      formData.append('glb_file', glbBlob, `${modelId}.glb`);

      const convertResponse = await fetch(`${API_URL}/model/${modelId}/convert-usdz`, {
        method: 'POST',
        body: formData
      });

      if (!convertResponse.ok) {
        const error = await convertResponse.json().catch(() => ({}));
        throw new Error(error.detail || `Backend conversion failed: ${convertResponse.status}`);
      }

      const usdzBlob = await convertResponse.blob();
      console.log(`✓ USDZ generated: ${(usdzBlob.size / 1024 / 1024).toFixed(2)} MB`);

      // Upload USDZ to backend to save in R2
      console.log('💾 Saving USDZ to R2...');
      const usdzFormData = new FormData();
      usdzFormData.append('usdz_file', usdzBlob, `${modelId}.usdz`);

      const saveResponse = await fetch(`${API_URL}/model/${modelId}/save-usdz`, {
        method: 'POST',
        body: usdzFormData
      });

      if (!saveResponse.ok) {
        console.warn(`Failed to save USDZ: ${saveResponse.status}`);
      } else {
        const saveResult = await saveResponse.json();
        console.log('✓ USDZ saved to R2:', saveResult);
      }

      setConverting(false);
      return usdzBlob;
    } catch (err) {
      const errorMsg = err.message || 'Conversion failed';
      console.error('❌ Conversion error:', errorMsg);
      setConvertError(errorMsg);
      setConverting(false);
      throw err;
    }
  };

  return {
    converting,
    convertError,
    convertGLBToUSDZ
  };
}
