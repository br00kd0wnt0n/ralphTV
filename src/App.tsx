import ContentScheduler from './components/ContentScheduler';
import Protected from './auth/Protected';
import LiveEmbedPlayer from './components/embed/LiveEmbedPlayer';
import { CONFIG } from './config';

function App() {
  // Lightweight route switch for the public embed page (no auth)
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/embed')) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: 'transparent' }}>
        <LiveEmbedPlayer />
      </div>
    );
  }

  const body = (
    <>
      <div className="app-header">
        <img src="/ralph-tv-logo.png" alt="RalphTV" className="app-logo" />
        <h1>RalphTV BROADCASTER</h1>
      </div>
      <ContentScheduler />
    </>
  );

  return (
    <div>
      {CONFIG.DISABLE_AUTH ? body : (
        <Protected>
          {body}
        </Protected>
      )}
    </div>
  );
}

export default App;
