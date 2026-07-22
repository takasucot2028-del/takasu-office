import { createContext, useContext, useState, type ReactNode } from 'react';

interface AuthState {
  isLoggedIn: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('tof_token'));

  const login = (t: string) => {
    setToken(t);
    sessionStorage.setItem('tof_token', t);
  };

  const logout = () => {
    setToken(null);
    sessionStorage.removeItem('tof_token');
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
