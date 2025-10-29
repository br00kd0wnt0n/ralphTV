import React from 'react';
import { useAuth, LoginComponent } from './index';

export default function Protected({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (!auth || !auth.token) {
    return (
      <div className="container" style={{ maxWidth: 420 }}>
        <h2>Sign in</h2>
        <LoginComponent />
      </div>
    );
  }
  return <>{children}</>;
}

