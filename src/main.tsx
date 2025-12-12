import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth';
import './auth/axios-base';
import './styles/index.css';

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
