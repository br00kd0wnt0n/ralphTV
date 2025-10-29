import React from 'react';

export interface AuthContextValue {
  user: any | null;
  token: string | null;
  login: (email: string, password: string) => Promise<any>;
  logout: () => void;
  validateToken: () => Promise<boolean>;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }>;
export function useAuth(): AuthContextValue;
export const LoginComponent: React.FC;
