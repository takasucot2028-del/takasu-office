import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ADMIN_NAV = [
  { to: '/dashboard', label: 'ダッシュボード', short: 'ホーム' },
  { to: '/labor/staff', label: '職員名簿', short: '職員' },
  { to: '/labor/shifts', label: 'シフト管理', short: 'シフト' },
  { to: '/labor/attendance', label: '勤怠管理', short: '勤怠' },
  { to: '/labor/overtime', label: '時間外', short: '時間外' },
  { to: '/labor/leave', label: '有給休暇', short: '有給' },
  { to: '/labor/payroll', label: '給与用データ', short: '給与' },
  { to: '/labor/accounting', label: '会計管理', short: '会計' },
  { to: '/labor/documents', label: '文書管理', short: '文書' },
  { to: '/settings', label: '設定', short: '設定' },
];
const STAFF_NAV = [
  { to: '/me', label: '打刻・ホーム', short: '打刻' },
  { to: '/me/attendance', label: '出勤簿', short: '出勤簿' },
  { to: '/me/schedule', label: 'シフト表', short: 'シフト表' },
  { to: '/me/shifts', label: 'シフト希望', short: '希望' },
  { to: '/me/overtime', label: '時間外・代休', short: '時間外' },
  { to: '/me/leave', label: '休暇申請', short: '休暇' },
  { to: '/me/expense', label: '経費申請', short: '経費' },
  { to: '/me/documents', label: '文書', short: '文書' },
  { to: '/me/settings', label: '設定', short: '設定' },
];

export default function Header() {
  const { isLoggedIn, isAdmin, isStaff, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const items = isAdmin ? ADMIN_NAV : isStaff ? STAFF_NAV : [];
  const home = isAdmin ? '/dashboard' : isStaff ? '/me' : '/';

  return (
    <header className="bg-white border-b border-rule sticky top-0 z-40 no-print">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to={home} className="font-bold text-ink text-sm whitespace-nowrap">
          <span className="text-pine">TSC</span> {isStaff ? '勤怠' : '事務管理'}
        </Link>

        {items.length > 0 && (
          <nav className="hidden sm:flex items-center gap-1 text-xs">
            {items.map(item => (
              <NavLink key={item.to} to={item.to} current={location.pathname}>{item.label}</NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-3 text-xs">
          {isLoggedIn && (
            <button onClick={handleLogout} className="text-ink-mute hover:text-ink">
              ログアウト
            </button>
          )}
        </div>
      </div>

      {/* モバイルナビ */}
      {items.length > 0 && (
        <nav className="sm:hidden flex flex-wrap border-t border-rule-soft px-2 py-1 gap-1 text-xs">
          {items.map(item => (
            <NavLink key={item.to} to={item.to} current={location.pathname}>{item.short}</NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

function NavLink({ to, current, children }: { to: string; current: string; children: React.ReactNode }) {
  const active = current === to || (to !== '/me' && current.startsWith(`${to}/`));
  return (
    <Link
      to={to}
      className={`px-3 py-2 rounded-md whitespace-nowrap transition-colors ${
        active ? 'bg-pine-soft text-pine font-bold' : 'text-ink-soft hover:bg-paper'
      }`}
    >
      {children}
    </Link>
  );
}
