import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ARViewerModelViewer from './pages/ARViewerModelViewer';
import ARVieweriOS from './pages/ARVieweriOS';
import ARViewer from './pages/ARViewer';
import ARPublicViewer from './pages/ARPublicViewer';
import { isIOS } from './utils/platformDetection';
import './App.css';

/**
 * Platform fork for /view/*.
 *
 * Android (and everything else -- desktop, unknown UAs) keeps using
 * ARViewerModelViewer as-is: model-viewer's `ar-modes="scene-viewer webxr"`
 * paths already work correctly with a plain GLB there. iOS gets routed to
 * ARVieweriOS, which resolves a USDZ for AR Quick Look and applies
 * iOS-specific camera/gesture/AR defaults instead -- see that file for why
 * it isn't just a reskin.
 *
 * The check runs once per mount (the platform can't change mid-session)
 * rather than on every render.
 */
function PlatformARRouter() {
  const [onIOS] = useState(() => isIOS());
  return onIOS ? <ARVieweriOS /> : <ARViewerModelViewer />;
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (token) {
      setIsLoggedIn(true);
    }
    setLoading(false);
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <Router>
      <Routes>
        {/* Public AR Viewer - Restaurant Product AR Display */}
        <Route path="/ar/:restaurantId/:productId" element={<ARPublicViewer />} />

        {/* Primary: Google model-viewer with native AR support */}
        {/* Wildcard (not :modelId) so full URLs like /view/https://host/a/b.glb
            still route here -- a plain :modelId param only matches a single
            path segment and silently fails to match anything (blank page)
            once the model id itself contains slashes. */}
        <Route path="/view/*" element={<PlatformARRouter />} />
        {/* Fallback: WebXR implementation */}
        <Route path="/view-webxr/:modelId" element={<ARViewer />} />
        <Route path="/login" element={<Login setIsLoggedIn={setIsLoggedIn} />} />
        <Route
          path="/"
          element={isLoggedIn ? <AdminDashboard setIsLoggedIn={setIsLoggedIn} /> : <Navigate to="/login" />}
        />
      </Routes>
    </Router>
  );
}

export default App;
