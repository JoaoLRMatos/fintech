import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../lib/api';

type User = { id: string; email: string; fullName: string | null } | null;

type AuthCtx = {
  user: User;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth.me().then(r => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.auth.login({ email, password });
    if (res.token) localStorage.setItem('auth_token', res.token);
    setUser(res.user);
  };

  const register = async (email: string, password: string, fullName: string) => {
    const res = await api.auth.register({ email, password, fullName });
    if (res.token) localStorage.setItem('auth_token', res.token);
    setUser(res.user);
  };

  const logout = async () => {
    await api.auth.logout();
    localStorage.removeItem('auth_token');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
