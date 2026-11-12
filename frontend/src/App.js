import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ARViewerModelViewer from './pages/ARViewerModelViewer';
import ARViewer from './pages/ARViewer';
import ARStep2 from './pages/ARStep2';
import ARPage from './pages/ARPage';
import ARLab  from './pages/ARLab';
import ARV1   from './pages/ARV1';
import ARV2   from './pages/ARV2';
import ARV3   from './pages/ARV3';
import ARV4   from './pages/ARV4';
import ARV5   from './pages/ARV5';
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
        {/* AR lab — pick a viewer */}
        <Route path="/ar-viewers" element={<ARLab />} />
        {/* Individual AR viewers */}
        <Route path="/ar-v1" element={<ARV1 />} />
        <Route path="/ar-v2" element={<ARV2 />} />
        <Route path="/ar-v3" element={<ARV3 />} />
        <Route path="/ar-v4" element={<ARV4 />} />
        <Route path="/ar-v5" element={<ARV5 />} />
        {/* Full AR viewer — WebXR hit-test + gyro fallback */}
        <Route path="/ar" element={<ARPage />} />
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
