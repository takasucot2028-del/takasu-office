import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { PageContainer, Card, Field, Input, Button, Alert } from '../components/UI';
import { adminLogin, usingGas } from '../api/data';

export default function Login() {
  const { login, isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isLoggedIn) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await adminLogin(email, password);
      if (res.success && res.token) {
        login(res.token);
        navigate('/dashboard');
      } else {
        setError(res.error || 'メールアドレスまたはパスワードが正しくありません');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer>
      <div className="max-w-md mx-auto mt-10">
        <h1 className="text-xl font-bold text-gray-800 text-center mb-2">
          たかすスポーツクラブ 事務管理システム
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">事務局ログイン</p>
        <Card>
          {error && <Alert type="error">{error}</Alert>}
          <form onSubmit={handleSubmit}>
            <Field label="メールアドレス" required>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </Field>
            <Field label="パスワード" required>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'ログイン中…' : 'ログイン'}
            </Button>
          </form>
        </Card>
        {!usingGas && (
          <p className="text-xs text-gray-400 text-center mt-4">
            デモアカウント: admin@takasu-sc.jp / admin123
          </p>
        )}
      </div>
    </PageContainer>
  );
}
