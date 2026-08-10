import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './AdminDashboard.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function AdminDashboard({ setIsLoggedIn }) {
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('restaurants');

  // Forms
  const [restaurantForm, setRestaurantForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: ''
  });

  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    scale: 1.0,
    file: null
  });

  const [qrCode, setQrCode] = useState(null);

  useEffect(() => {
    loadRestaurants();
  }, []);

  useEffect(() => {
    if (selectedRestaurant) {
      loadProducts(selectedRestaurant.id);
    }
  }, [selectedRestaurant]);

  const loadRestaurants = async () => {
    try {
      // For now, load from localStorage (in production, fetch from API)
      const stored = localStorage.getItem('restaurants');
      if (stored) {
        setRestaurants(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading restaurants:', error);
    }
  };

  const loadProducts = async (restaurantId) => {
    try {
      const response = await axios.get(`${API_URL}/models/${restaurantId}`);
      setProducts(response.data);
    } catch (error) {
      console.error('Error loading products:', error);
    }
  };

  const handleCreateRestaurant = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData();
      Object.keys(restaurantForm).forEach(key => {
        formData.append(key, restaurantForm[key]);
      });

      const response = await axios.post(`${API_URL}/restaurants`, formData);
      const newRestaurant = response.data;

      setRestaurants([...restaurants, newRestaurant]);
      localStorage.setItem('restaurants', JSON.stringify([...restaurants, newRestaurant]));

      setRestaurantForm({ name: '', email: '', phone: '', address: '', city: '' });
      alert('Restaurant created!');
      setTab('restaurants');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadProduct = async (e) => {
    e.preventDefault();
    console.log('Form state:', { productForm, selectedRestaurant: selectedRestaurant?.id });

    if (!productForm.file) {
      console.log('No file selected');
      return;
    }
    if (!selectedRestaurant) {
      console.log('No restaurant selected');
      return;
    }
    if (!productForm.name.trim()) {
      console.log('No product name entered');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('restaurant_id', selectedRestaurant.id);
      formData.append('name', productForm.name);
      formData.append('description', productForm.description);
      formData.append('scale', productForm.scale);
      formData.append('file', productForm.file);

      console.log('🚀 Uploading:', productForm.name, 'to restaurant:', selectedRestaurant.id);
      const response = await axios.post(`${API_URL}/models/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      console.log('✅ Upload successful! Model ID:', response.data.id);

      // Auto-generate QR code
      const qrResponse = await axios.post(`${API_URL}/qr/${response.data.id}`);
      console.log('✅ QR generated! URL:', qrResponse.data.qr_url);

      // Display QR code modal
      setQrCode({
        url: qrResponse.data.qr_url,
        image: qrResponse.data.qr_image_url,
        productName: productForm.name
      });

      setProductForm({ name: '', description: '', scale: 1.0, file: null });
      loadProducts(selectedRestaurant.id);
    } catch (error) {
      console.error('❌ Upload failed:', error.message);
      console.error('Error details:', error.response?.data);
      const errorMsg = document.createElement('div');
      errorMsg.style.cssText = 'position:fixed;top:20px;right:20px;background:#f44336;color:white;padding:20px;border-radius:8px;z-index:9999;max-width:300px';
      errorMsg.textContent = `❌ Error: ${error.response?.data?.detail || error.message}`;
      document.body.appendChild(errorMsg);
      setTimeout(() => errorMsg.remove(), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setIsLoggedIn(false);
    navigate('/login');
  };

  return (
    <div className="admin-container">
      <header className="admin-header">
        <h1>🏢 ARIGroup Admin</h1>
        <button onClick={handleLogout} className="logout-btn">Logout</button>
      </header>

      <div className="admin-tabs">
        <button
          className={`tab ${tab === 'restaurants' ? 'active' : ''}`}
          onClick={() => setTab('restaurants')}
        >
          Restaurants ({restaurants.length})
        </button>
        <button
          className={`tab ${tab === 'products' ? 'active' : ''}`}
          onClick={() => setTab('products')}
          disabled={!selectedRestaurant}
        >
          Products {selectedRestaurant && `- ${selectedRestaurant.name}`}
        </button>
      </div>

      <div className="admin-content">
        {tab === 'restaurants' && (
          <div className="section">
            <h2>Create New Restaurant</h2>
            <form onSubmit={handleCreateRestaurant} className="form">
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
              <button type="submit" disabled={loading}>Create Restaurant</button>
            </form>

            <h2>Your Restaurants</h2>
            <div className="restaurants-grid">
              {restaurants.map(restaurant => (
                <div key={restaurant.id} className="restaurant-card">
                  <h3>{restaurant.name}</h3>
                  <p>{restaurant.address}</p>
                  <p className="city">{restaurant.city}</p>
                  <button
                    onClick={() => {
                      setSelectedRestaurant(restaurant);
                      setTab('products');
                    }}
                    className="select-btn"
                  >
                    Manage Products
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'products' && selectedRestaurant && (
          <div className="section">
            <h2>Upload Product for {selectedRestaurant.name}</h2>
            <form onSubmit={handleUploadProduct} className="form">
              <input
                type="text"
                placeholder="Product Name (e.g., Margherita Pizza)"
                value={productForm.name}
                onChange={(e) => setProductForm({...productForm, name: e.target.value})}
                required
              />
              <textarea
                placeholder="Description"
                value={productForm.description}
                onChange={(e) => setProductForm({...productForm, description: e.target.value})}
              />
              <input
                type="number"
                placeholder="Scale"
                step="0.1"
                value={productForm.scale}
                onChange={(e) => setProductForm({...productForm, scale: parseFloat(e.target.value)})}
              />
              <input
                type="file"
                accept=".obj,.gltf,.glb"
                onChange={(e) => setProductForm({...productForm, file: e.target.files[0]})}
                required
              />
              <button type="submit" disabled={loading}>Upload & Generate QR</button>
            </form>

            <h2>Products</h2>
            {products.length === 0 ? (
              <p className="empty">No products yet</p>
            ) : (
              <div className="products-grid">
                {products.map(product => (
                  <div key={product.id} className="product-card">
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    <p className="type">Format: {product.file_type.toUpperCase()}</p>
                    <p className="id">ID: {product.id.slice(0, 8)}...</p>
                    <button
                      onClick={() => {
                        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                        if (isMobile) {
                          window.location.href = `/view/${product.id}`;
                        } else {
                          // On desktop, generate and show QR code
                          axios.post(`${API_URL}/qr/${product.id}`)
                            .then(qrResponse => {
                              setQrCode({
                                url: qrResponse.data.qr_url,
                                image: qrResponse.data.qr_image_url,
                                productName: product.name
                              });
                            })
                            .catch(err => console.error('QR generation error:', err));
                        }
                      }}
                      className="view-btn"
                      style={{
                        padding: '10px 20px',
                        background: 'inherit',
                        border: 'inherit',
                        cursor: 'pointer',
                        color: 'inherit',
                        width: '100%',
                        fontSize: 'inherit'
                      }}
                    >
                      View AR
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {qrCode && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            background: 'white',
            padding: '40px',
            borderRadius: '15px',
            textAlign: 'center',
            maxWidth: '500px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }}>
            <h2>✅ QR Code Generated!</h2>
            <p style={{ fontSize: '16px', marginBottom: '20px' }}>{qrCode.productName}</p>

            <div style={{
              background: 'white',
              padding: '20px',
              borderRadius: '10px',
              marginBottom: '20px',
              border: '3px solid #667eea'
            }}>
              <img src={qrCode.image} alt="QR Code" style={{ width: '300px', height: '300px' }} />
            </div>

            <div style={{
              background: '#f5f5f5',
              padding: '15px',
              borderRadius: '8px',
              fontFamily: 'monospace',
              fontSize: '12px',
              marginBottom: '20px',
              wordBreak: 'break-all'
            }}>
              {qrCode.url}
            </div>

            <button
              onClick={() => setQrCode(null)}
              style={{
                padding: '12px 30px',
                fontSize: '16px',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
