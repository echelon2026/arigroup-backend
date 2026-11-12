import { useEffect } from 'react';

// Redirect to the static HTML — document.write doesn't survive React remounting
export default function ARImmersive() {
  useEffect(() => {
    const model = new URLSearchParams(window.location.search).get('model');
    const dest  = '/ar-immersive.html' + (model ? '?model=' + encodeURIComponent(model) : '');
    window.location.replace(dest);
  }, []);
  return null;
}
