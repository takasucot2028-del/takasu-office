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
import OvertimePrint from './pages/labor/OvertimePrint';
import Leave from './pages/labor/Leave';
import LeavePrint from './pages/labor/LeavePrint';
import Documents from './pages/labor/Documents';
import Accounting from './pages/labor/Accounting';
import AccountingPrint from './pages/labor/AccountingPrint';
import Settings from './pages/Settings';

import StaffHome from './pages/me/StaffHome';
import StaffShiftRequest from './pages/me/StaffShiftRequest';
import StaffOvertimeRequest from './pages/me/StaffOvertimeRequest';
import StaffLeaveRequest from './pages/me/StaffLeaveRequest';
import StaffDocuments from './pages/me/StaffDocuments';
import StaffExpense from './pages/me/StaffExpense';
import StaffSettings from './pages/me/StaffSettings';
import StaffAttendance from './pages/me/StaffAttendance';
import AttendancePrint from './pages/labor/AttendancePrint';
import StaffRegisterPrint from './pages/labor/StaffRegisterPrint';
import WageLedgerPrint from './pages/labor/WageLedgerPrint';

// 管理者専用
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin } = useAuth();
  if (!isLoggedIn) return <Navigate to="/" replace />;
  if (!isAdmin) return <Navigate to="/me" replace />;
  return <>{children}</>;
}
// 従業員専用
function StaffGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isStaff } = useAuth();
  if (!isLoggedIn) return <Navigate to="/" replace />;
  if (!isStaff) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <Routes>
        <Route path="/" element={<Login />} />

        {/* 事務局 */}
        <Route path="/dashboard" element={<AdminGuard><Dashboard /></AdminGuard>} />
        <Route path="/labor/staff" element={<AdminGuard><StaffList /></AdminGuard>} />
        <Route path="/labor/staff/:id" element={<AdminGuard><StaffDetail /></AdminGuard>} />
        <Route path="/labor/shifts" element={<AdminGuard><Shifts /></AdminGuard>} />
        <Route path="/labor/shifts/print" element={<AdminGuard><ShiftsPrint /></AdminGuard>} />
        <Route path="/labor/shift-patterns" element={<AdminGuard><ShiftPatterns /></AdminGuard>} />
        <Route path="/labor/attendance" element={<AdminGuard><Attendance /></AdminGuard>} />
        <Route path="/labor/attendance/print" element={<AdminGuard><AttendancePrint /></AdminGuard>} />
        <Route path="/labor/staff/register/print" element={<AdminGuard><StaffRegisterPrint /></AdminGuard>} />
        <Route path="/labor/staff/wage/print" element={<AdminGuard><WageLedgerPrint /></AdminGuard>} />
        <Route path="/labor/overtime" element={<AdminGuard><Overtime /></AdminGuard>} />
        <Route path="/labor/overtime/print" element={<AdminGuard><OvertimePrint /></AdminGuard>} />
        <Route path="/labor/leave" element={<AdminGuard><Leave /></AdminGuard>} />
        <Route path="/labor/leave/print" element={<AdminGuard><LeavePrint /></AdminGuard>} />
        <Route path="/labor/documents" element={<AdminGuard><Documents /></AdminGuard>} />
        <Route path="/labor/accounting" element={<AdminGuard><Accounting /></AdminGuard>} />
        <Route path="/labor/accounting/print" element={<AdminGuard><AccountingPrint /></AdminGuard>} />
        <Route path="/settings" element={<AdminGuard><Settings /></AdminGuard>} />

        {/* 従業員 */}
        <Route path="/me" element={<StaffGuard><StaffHome /></StaffGuard>} />
        <Route path="/me/shifts" element={<StaffGuard><StaffShiftRequest /></StaffGuard>} />
        <Route path="/me/overtime" element={<StaffGuard><StaffOvertimeRequest /></StaffGuard>} />
        <Route path="/me/leave" element={<StaffGuard><StaffLeaveRequest /></StaffGuard>} />
        <Route path="/me/documents" element={<StaffGuard><StaffDocuments /></StaffGuard>} />
        <Route path="/me/expense" element={<StaffGuard><StaffExpense /></StaffGuard>} />
        <Route path="/me/attendance" element={<StaffGuard><StaffAttendance /></StaffGuard>} />
        <Route path="/me/attendance/print" element={<StaffGuard><AttendancePrint /></StaffGuard>} />
        <Route path="/me/settings" element={<StaffGuard><StaffSettings /></StaffGuard>} />
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
