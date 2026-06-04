import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth';
import ErrorBoundary from './components/ErrorBoundary';
import './auth/axios-base';
import './styles/index.css';
import { CONFIG } from './config';
import { decodeJWT } from './utils/jwt';

const isEmbed = typeof window !== 'undefined' && window.location.pathname.startsWith('/embed');

// SSO bridge from Ralph.World CMS. A token arrives in the URL hash
// (https://broadcaster.ralph.world/#token=eyJ...). We do NOT trust it blindly:
//  - never run on the public /embed page (it would let any embedding site poison
//    this origin's localStorage)
//  - strip the hash immediately so the token never lingers in the URL/history/Referer
//  - reject structurally invalid, expired, or stale tokens before any network call
//  - require the backend to confirm the signature (/api/protected) before persisting
async function consumeSsoHash(): Promise<void> {
  if (isEmbed || typeof window === 'undefined') return;
  if (!window.location.hash.startsWith('#token=')) return;

  const token = window.location.hash.slice('#token='.length);
  // Always clear the hash, regardless of whether the token turns out valid.
  try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch {}
  if (!token) return;

  // Cheap local checks first — fail fast without a round trip.
  const claims = decodeJWT(token);
  if (!claims) return;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp <= now) return; // expired
  // An SSO redirect token should be fresh; reject ones minted long ago to limit the
  // replay window if a token leaks via logs or browser history. Skipped if the CMS
  // doesn't stamp iat.
  if (typeof claims.iat === 'number' && now - claims.iat > 300) return;

  // Authoritative check: only the backend can verify the HS256 signature.
  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
  } catch {
    return; // backend unreachable — don't persist a token we couldn't verify
  }

  try { localStorage.setItem('token', token); } catch { /* private mode — fall through to login */ }
}

function mount(): void {
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  if (isEmbed) {
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  } else {
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ErrorBoundary>
      </React.StrictMode>
    );
  }
}

// Validate any SSO token before the app (and AuthProvider, which reads
// localStorage at construction) mounts. Normal visitors hit no network delay
// because consumeSsoHash returns immediately when there's no #token in the URL.
consumeSsoHash().finally(mount);
