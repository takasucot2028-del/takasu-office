import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'ダッシュボード', short: 'ホーム' },
  { to: '/labor/staff', label: '職員名簿', short: '職員' },
  { to: '/labor/shifts', label: 'シフト管理', short: 'シフト' },
  { to: '/labor/attendance', label: '勤怠管理', short: '勤怠' },
  { to: '/labor/overtime', label: '時間外', short: '時間外' },
  { to: '/labor/leave', label: '有給休暇', short: '有給' },
  { to: '/settings', label: '設定', short: '設定' },
];

export default function Header() {
  const { isLoggedIn, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to={isLoggedIn ? '/dashboard' : '/'} className="font-bold text-gray-800 text-sm">
          <span className="text-emerald-600">TSC</span> 事務管理
        </Link>

        {isLoggedIn && (
          <nav className="hidden sm:flex items-center gap-1 text-xs">
            {NAV_ITEMS.map(item => (
              <NavLink key={item.to} to={item.to} current={location.pathname}>{item.label}</NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-3 text-xs">
          {isLoggedIn && (
            <button onClick={handleLogout} className="text-gray-500 hover:text-gray-700">
              ログアウト
            </button>
          )}
        </div>
      </div>

      {/* モバイルナビ */}
      {isLoggedIn && (
        <nav className="sm:hidden flex overflow-x-auto border-t border-gray-100 px-4 gap-1 text-xs">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} current={location.pathname}>{item.short}</NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

function NavLink({ to, current, children }: { to: string; current: string; children: React.ReactNode }) {
  const active = current === to || current.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      className={`px-3 py-2 rounded-md whitespace-nowrap transition-colors ${
        active ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </Link>
  );
}
