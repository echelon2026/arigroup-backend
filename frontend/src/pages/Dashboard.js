import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function Dashboard() {
  const [restaurantId, setRestaurantId] = useState(localStorage.getItem('restaurantId') || '');
  const [models, setModels] = useState([]);
  const [qrCodes, setQrCodes] = useState([]);
  const [loading, setLoading] = useState(false);

  const [restaurantForm, setRestaurantForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: ''
  });

  const [modelForm, setModelForm] = useState({
    name: '',
    description: '',
    scale: 1.0,
    file: null
  });

  useEffect(() => {
    if (restaurantId) {
      loadModels();
    }
  }, [restaurantId]);

  const handleRestaurantRegistration = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData();
      Object.keys(restaurantForm).forEach(key => {
        formData.append(key, restaurantForm[key]);
      });

      const response = await axios.post(`${API_URL}/restaurants`, formData);
      const id = response.data.id;
      setRestaurantId(id);
      localStorage.setItem('restaurantId', id);
      alert('Restaurant registered!');
    } catch (error) {
      alert('Error registering restaurant: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleModelUpload = async (e) => {
    e.preventDefault();
    if (!modelForm.file) {
      alert('Please select a file');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('restaurant_id', restaurantId);
      formData.append('name', modelForm.name);
      formData.append('description', modelForm.description);
      formData.append('scale', modelForm.scale);
      formData.append('file', modelForm.file);

      await axios.post(`${API_URL}/models/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      alert('Model uploaded successfully!');
      setModelForm({ name: '', description: '', scale: 1.0, file: null });
      loadModels();
    } catch (error) {
      alert('Error uploading model: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadModels = async () => {
    try {
      const response = await axios.get(`${API_URL}/models/${restaurantId}`);
      setModels(response.data);
    } catch (error) {
      console.error('Error loading models:', error);
    }
  };

  const generateQR = async (modelId) => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/qr/${modelId}`);
      alert('QR Code generated!');
      setQrCodes([...qrCodes, response.data]);
    } catch (error) {
      alert('Error generating QR: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>ARIGroup Dashboard</h1>
        <p>Digital Menu AR Platform</p>
      </header>

      <main className="container">
        {!restaurantId ? (
          <section className="card">
            <h2>Register Restaurant</h2>
            <form onSubmit={handleRestaurantRegistration}>
              <input
                type="text"
                placeholder="Restaurant Name"
                value={restaurantForm.name}
                onChange={(e) => setRestaurantForm({...restaurantForm, name: e.target.value})}
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={restaurantForm.email}
                onChange={(e) => setRestaurantForm({...restaurantForm, email: e.target.value})}
                required
              />
              <input
                type="tel"
                placeholder="Phone"
                value={restaurantForm.phone}
                onChange={(e) => setRestaurantForm({...restaurantForm, phone: e.target.value})}
              />
              <input
                type="text"
                placeholder="Address"
                value={restaurantForm.address}
                onChange={(e) => setRestaurantForm({...restaurantForm, address: e.target.value})}
              />
              <input
                type="text"
                placeholder="City"
                value={restaurantForm.city}
                onChange={(e) => setRestaurantForm({...restaurantForm, city: e.target.value})}
              />
              <button type="submit" disabled={loading}>Register</button>
            </form>
          </section>
        ) : (
          <>
            <section className="card">
              <h2>Upload 3D Model</h2>
              <form onSubmit={handleModelUpload}>
                <input
                  type="text"
                  placeholder="Model Name (e.g., Margherita Pizza)"
                  value={modelForm.name}
                  onChange={(e) => setModelForm({...modelForm, name: e.target.value})}
                  required
                />
                <textarea
                  placeholder="Description"
                  value={modelForm.description}
                  onChange={(e) => setModelForm({...modelForm, description: e.target.value})}
                />
                <input
                  type="number"
                  placeholder="Scale"
                  step="0.1"
                  value={modelForm.scale}
                  onChange={(e) => setModelForm({...modelForm, scale: parseFloat(e.target.value)})}
                />
                <input
                  type="file"
                  accept=".obj,.gltf,.glb"
                  onChange={(e) => setModelForm({...modelForm, file: e.target.files[0]})}
                  required
                />
                <button type="submit" disabled={loading}>Upload Model</button>
              </form>
            </section>

            <section className="card">
              <h2>Your Models</h2>
              {models.length === 0 ? (
                <p>No models uploaded yet</p>
              ) : (
                <div className="models-list">
                  {models.map(model => (
                    <div key={model.id} className="model-item">
                      <h3>{model.name}</h3>
                      <p>{model.description}</p>
                      <p className="model-type">Type: {model.file_type.toUpperCase()}</p>
                      <button onClick={() => generateQR(model.id)} disabled={loading}>
                        Generate QR Code
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {qrCodes.length > 0 && (
              <section className="card">
                <h2>Generated QR Codes</h2>
                <div className="qr-list">
                  {qrCodes.map(qr => (
                    <div key={qr.qr_id} className="qr-item">
                      <img src={qr.qr_image_url} alt="QR Code" />
                      <p>URL: <a href={qr.qr_url} target="_blank" rel="noopener noreferrer">{qr.qr_url}</a></p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
