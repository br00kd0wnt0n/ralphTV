import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth';
import './auth/axios-base';
import './styles/index.css';

// SSO bridge from Ralph.World CMS: if a token is passed in the URL hash,
// store it in localStorage and strip the hash before the app mounts.
// Example: https://broadcaster.ralph.world/#token=eyJhbGciOi...
if (typeof window !== 'undefined' && window.location.hash.startsWith('#token=')) {
  const token = window.location.hash.slice('#token='.length);
  if (token) {
    try {
      localStorage.setItem('token', token);
      // Clean the hash so the token doesn't stick around in the URL bar
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      // localStorage blocked (private mode etc) — fall through to regular login
    }
  }
}

const isEmbed = typeof window !== 'undefined' && window.location.pathname.startsWith('/embed');

const root = ReactDOM.createRoot(document.getElementById('root')!);
if (isEmbed) {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </React.StrictMode>
  );
}
