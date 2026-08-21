import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { PageContainer, Card, Field, Input, Button, Alert } from '../components/UI';
import { adminLogin, staffLogin, usingGas } from '../api/data';

type Tab = 'staff' | 'admin';

export default function Login() {
  const { login, isLoggedIn, isAdmin, expired } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('staff');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 従業員
  const [empNo, setEmpNo] = useState('');
  const [empPw, setEmpPw] = useState('');
  // 事務局
  const [email, setEmail] = useState('');
  const [adminPw, setAdminPw] = useState('');

  if (isLoggedIn) return <Navigate to={isAdmin ? '/dashboard' : '/me'} replace />;

  const handleStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await staffLogin(empNo, empPw);
      if (res.success && res.token && res.staffId) {
        login(res.token, 'staff', res.staffId);
        navigate('/me');
      } else setError(res.error || 'ログインできませんでした');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally { setLoading(false); }
  };

  const handleAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await adminLogin(email, adminPw);
      if (res.success && res.token) {
        login(res.token, 'admin');
        navigate('/dashboard');
      } else setError(res.error || 'ログインできませんでした');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally { setLoading(false); }
  };

  return (
    <PageContainer>
      <div className="max-w-md mx-auto mt-10">
        <h1 className="text-xl font-bold text-gray-800 text-center mb-1">
          たかすスポーツクラブ
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">勤怠・事務管理システム</p>

        {/* タブ */}
        <div className="flex rounded-md overflow-hidden border border-gray-300 mb-4">
          <button onClick={() => { setTab('staff'); setError(''); }}
            className={`flex-1 py-2 text-sm ${tab === 'staff' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>従業員</button>
          <button onClick={() => { setTab('admin'); setError(''); }}
            className={`flex-1 py-2 text-sm ${tab === 'admin' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>事務局</button>
        </div>

        <Card>
          {expired && !error && (
            <Alert type="info">ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。</Alert>
          )}
          {error && <Alert type="error">{error}</Alert>}
          {tab === 'staff' ? (
            <form onSubmit={handleStaff}>
              <Field label="職員番号" required>
                <Input value={empNo} onChange={e => setEmpNo(e.target.value)} inputMode="numeric" autoComplete="username" required />
              </Field>
              <Field label="パスワード" required>
                <Input type="password" value={empPw} onChange={e => setEmpPw(e.target.value)} autoComplete="current-password" required />
              </Field>
              <Button type="submit" className="w-full" disabled={loading}>{loading ? 'ログイン中…' : 'ログイン'}</Button>
              <p className="text-xs text-gray-400 mt-3">職員番号とパスワードは事務局にお問い合わせください。</p>
            </form>
          ) : (
            <form onSubmit={handleAdmin}>
              <Field label="メールアドレス" required>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
              </Field>
              <Field label="パスワード" required>
                <Input type="password" value={adminPw} onChange={e => setAdminPw(e.target.value)} autoComplete="current-password" required />
              </Field>
              <Button type="submit" className="w-full" disabled={loading}>{loading ? 'ログイン中…' : 'ログイン'}</Button>
            </form>
          )}
        </Card>

        {!usingGas && (
          <p className="text-xs text-gray-400 text-center mt-4">
            デモ: 従業員=職員番号1001〜1003 / パスワード1234　｜　事務局=admin@takasu-sc.jp / admin123
          </p>
        )}
      </div>
    </PageContainer>
  );
}
