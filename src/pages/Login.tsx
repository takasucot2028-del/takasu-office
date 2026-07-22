import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { PageContainer, Card, Field, Input, Button, Alert } from '../components/UI';
import { verifyAdmin } from '../utils/store';

export default function Login() {
  const { login, isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (isLoggedIn) return <Navigate to="/dashboard" replace />;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyAdmin(email, password)) {
      login(`demo-${Date.now()}`);
      navigate('/dashboard');
    } else {
      setError('メールアドレスまたはパスワードが正しくありません');
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
            <Button type="submit" className="w-full">ログイン</Button>
          </form>
        </Card>
        <p className="text-xs text-gray-400 text-center mt-4">
          デモアカウント: admin@takasu-sc.jp / admin123
        </p>
      </div>
    </PageContainer>
  );
}
