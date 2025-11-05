import React from 'react';
import { useAuth, LoginComponent } from './index';

export default function Protected({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (!auth || !auth.token) {
    return <LoginComponent />;
  }
  return <>{children}</>;
}

