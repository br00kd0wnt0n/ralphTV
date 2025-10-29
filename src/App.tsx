import ContentScheduler from './components/ContentScheduler';
import Protected from './auth/Protected';

function App() {
  return (
    <div>
      <h1 style={{textAlign: 'center'}}>ralphTV Content Scheduler (V1 wireframe)</h1>
      <Protected>
        <ContentScheduler />
      </Protected>
    </div>
  );
}

export default App;
