'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from './api';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Restore the session from a stored token on first load.
  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const handleAuth = async (path: string, email: string, password: string) => {
    const { token, user } = await api<{ token: string; user: User }>(path, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    tokenStore.set(token);
    setUser(user);
    router.push('/dashboard');
  };

  const value: AuthContextValue = {
    user,
    loading,
    login: (email, password) => handleAuth('/auth/login', email, password),
    register: (email, password) => handleAuth('/auth/register', email, password),
    logout: () => {
      tokenStore.clear();
      setUser(null);
      router.push('/login');
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
