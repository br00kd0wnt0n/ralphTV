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
    <form onSubmit={handleSubmit}>
      <input 
        type="email" 
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required 
      />
      <input 
        type="password" 
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required 
      />
      <button type="submit">Login</button>
    </form>
  );
};
