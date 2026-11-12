import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ARViewerModelViewer from './pages/ARViewerModelViewer';
import ARViewer from './pages/ARViewer';
import ARStep2 from './pages/ARStep2';
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
        {/* AR step 2 test — camera + model load */}
        <Route path="/ar-step2" element={<ARStep2 />} />
        {/* Primary: Google model-viewer with native AR support */}
        <Route path="/view/:modelId" element={<ARViewerModelViewer />} />
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
