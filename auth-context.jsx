import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';

// Authentication Context
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));

  // Axios default configuration
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Login Method
  const login = async (email, password) => {
    try {
      const response = await axios.post('/api/login', { email, password });
      const { token, user: userData } = response.data;
      
      // Store token in local storage
      localStorage.setItem('token', token);
      
      // Set user and token in state
      setToken(token);
      setUser(userData);

      return userData;
    } catch (error) {
      console.error('Login failed', error);
      throw error;
    }
  };

  // Logout Method
  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setToken(null);
  };

  // Token Validation
  const validateToken = async () => {
    if (!token) return false;

    try {
      await axios.get('/api/protected');
      return true;
    } catch {
      logout();
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      token, 
      login, 
      logout, 
      validateToken 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom Hook for Authentication
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Login Component
export const LoginComponent = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(email, password);
      // Redirect or update app state
    } catch (error) {
      // Handle login error
      alert('Login failed');
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#000000',
      padding: '40px 20px'
    }}>
      {/* ralphTV Logo */}
      <img
        src="/ralph-tv-logo.png"
        alt="ralphTV"
        style={{
          width: '100%',
          maxWidth: '500px',
          height: 'auto',
          marginBottom: '48px',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(255, 0, 102, 0.2)'
        }}
      />

      {/* Login Form - no grey box, floating inputs */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          width: '100%',
          maxWidth: '380px'
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          style={{
            padding: '16px 20px',
            fontSize: '15px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: 'transparent',
            color: '#ffffff',
            outline: 'none',
            transition: 'all 0.3s ease',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
          onFocus={(e) => {
            e.target.style.borderColor = '#ff0066';
            e.target.style.boxShadow = '0 0 0 3px rgba(255, 0, 102, 0.1)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            e.target.style.boxShadow = 'none';
          }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          style={{
            padding: '16px 20px',
            fontSize: '15px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: 'transparent',
            color: '#ffffff',
            outline: 'none',
            transition: 'all 0.3s ease',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
          onFocus={(e) => {
            e.target.style.borderColor = '#ff0066';
            e.target.style.boxShadow = '0 0 0 3px rgba(255, 0, 102, 0.1)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            e.target.style.boxShadow = 'none';
          }}
        />
        <button
          type="submit"
          style={{
            padding: '16px',
            fontSize: '15px',
            fontWeight: '600',
            borderRadius: '8px',
            border: 'none',
            background: 'linear-gradient(135deg, #ff0066 0%, #ff3399 100%)',
            color: '#ffffff',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginTop: '8px',
            boxShadow: '0 4px 14px rgba(255, 0, 102, 0.3)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
          onMouseOver={(e) => {
            e.target.style.transform = 'translateY(-2px)';
            e.target.style.boxShadow = '0 6px 20px rgba(255, 0, 102, 0.4)';
          }}
          onMouseOut={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 4px 14px rgba(255, 0, 102, 0.3)';
          }}
        >
          Sign In
        </button>
      </form>
    </div>
  );
};
