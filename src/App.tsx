import ContentScheduler from './components/ContentScheduler';
import Protected from './auth/Protected';

function App() {
  return (
    <div>
      <div className="app-header">
        <img src="/logo.png" alt="Ralph" className="app-logo" />
        <h1>CONTENT SCHEDULER</h1>
      </div>
      <Protected>
        <ContentScheduler />
      </Protected>
    </div>
  );
}

export default App;
