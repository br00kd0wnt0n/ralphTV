import ContentScheduler from './components/ContentScheduler';
import Protected from './auth/Protected';
import LiveEmbedPlayer from './components/embed/LiveEmbedPlayer';

function App() {
  // Lightweight route switch for the public embed page (no auth)
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/embed')) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: 'transparent' }}>
        <LiveEmbedPlayer />
      </div>
    );
  }

  return (
    <div>
      <div className="app-header">
        <img src="/ralph-tv-logo.png" alt="RalphTV" className="app-logo" />
        <h1>RalphTV BROADCASTER</h1>
      </div>
      <Protected>
        <ContentScheduler />
      </Protected>
    </div>
  );
}

export default App;
