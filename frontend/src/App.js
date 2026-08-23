import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ARViewerModelViewer from './pages/ARViewerModelViewer';
import ARViewer from './pages/ARViewer';
import ARPublicViewer from './pages/ARPublicViewer';
import './App.css';

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
        <Route path="/view/*" element={<ARViewerModelViewer />} />
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
