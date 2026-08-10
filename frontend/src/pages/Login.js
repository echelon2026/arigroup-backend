import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

function Login({ setIsLoggedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Simple PIN authentication (change this to your preferred PIN)
  const ADMIN_PIN = '1234';

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === ADMIN_PIN) {
      localStorage.setItem('adminToken', 'authenticated');
      setIsLoggedIn(true);
      navigate('/');
    } else {
      setError('Incorrect PIN');
      setPassword('');
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>ARIGroup Admin</h1>
        <p className="subtitle">Restaurant AR Menu Manager</p>

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>Admin PIN</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit">Login</button>
        </form>

        <p className="hint">Demo PIN: 1234</p>
      </div>
    </div>
  );
}

export default Login;
