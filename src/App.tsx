import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './components/AuthContext';
import Header from './components/Header';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import StaffList from './pages/labor/StaffList';
import StaffDetail from './pages/labor/StaffDetail';
import Shifts from './pages/labor/Shifts';
import ShiftsPrint from './pages/labor/ShiftsPrint';
import ShiftPatterns from './pages/labor/ShiftPatterns';
import Attendance from './pages/labor/Attendance';
import Overtime from './pages/labor/Overtime';
import Leave from './pages/labor/Leave';
import Settings from './pages/Settings';

function Guard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
        <Route path="/labor/staff" element={<Guard><StaffList /></Guard>} />
        <Route path="/labor/staff/:id" element={<Guard><StaffDetail /></Guard>} />
        <Route path="/labor/shifts" element={<Guard><Shifts /></Guard>} />
        <Route path="/labor/shifts/print" element={<Guard><ShiftsPrint /></Guard>} />
        <Route path="/labor/shift-patterns" element={<Guard><ShiftPatterns /></Guard>} />
        <Route path="/labor/attendance" element={<Guard><Attendance /></Guard>} />
        <Route path="/labor/overtime" element={<Guard><Overtime /></Guard>} />
        <Route path="/labor/leave" element={<Guard><Leave /></Guard>} />
        <Route path="/settings" element={<Guard><Settings /></Guard>} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  );
}
