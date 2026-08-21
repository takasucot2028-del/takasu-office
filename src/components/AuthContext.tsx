import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '../types';
import { clearDataCache, onSessionExpired, resetSessionExpired } from '../api/data';

interface AuthState {
  isLoggedIn: boolean;
  role: Role | null;
  staffId: string | null;
  isAdmin: boolean;
  isStaff: boolean;
  login: (token: string, role: Role, staffId?: string) => void;
  logout: () => void;
  /** セッション切れでログアウトしたか（ログイン画面で案内を出す） */
  expired: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('tof_token'));
  const [role, setRole] = useState<Role | null>(() => (sessionStorage.getItem('tof_role') as Role | null));
  const [staffId, setStaffId] = useState<string | null>(() => sessionStorage.getItem('tof_staffId'));
  const [expired, setExpired] = useState(false);

  const login = (t: string, r: Role, sid?: string) => {
    clearDataCache(); // 別ユーザーの残存キャッシュを持ち越さない
    resetSessionExpired();
    setExpired(false);
    setToken(t); setRole(r); setStaffId(sid ?? null);
    sessionStorage.setItem('tof_token', t);
    sessionStorage.setItem('tof_role', r);
    if (sid) sessionStorage.setItem('tof_staffId', sid);
    else sessionStorage.removeItem('tof_staffId');
    // 先読みはしない：着地するダッシュボードが職員・区分・費目・確定・休暇を
    // 1バッチでまとめて取得し、そこで基礎データのキャッシュも温めるため。
  };

  const logout = () => {
    clearDataCache();
    resetSessionExpired();
    setExpired(false);
    setToken(null); setRole(null); setStaffId(null);
    sessionStorage.removeItem('tof_token');
    sessionStorage.removeItem('tof_role');
    sessionStorage.removeItem('tof_staffId');
  };

  /**
   * サーバー側のログイン情報が切れたら、画面を空のままにせずログイン画面へ戻す。
   * GASを再デプロイするとサーバーのセッションが消えるため、この状態になりやすい。
   */
  useEffect(() => onSessionExpired(() => {
    clearDataCache();   // 失敗中に空で保存された内容を残さない
    setExpired(true);
    setToken(null); setRole(null); setStaffId(null);
    sessionStorage.removeItem('tof_token');
    sessionStorage.removeItem('tof_role');
    sessionStorage.removeItem('tof_staffId');
  }), []);

  return (
    <AuthContext.Provider value={{
      isLoggedIn: !!token, role, staffId,
      isAdmin: role === 'admin', isStaff: role === 'staff',
      login, logout, expired,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
