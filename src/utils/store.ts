// デモ用localStorageデータストア（将来はGAS APIに差し替える）
import type {
  Staff, AttendanceRecord, LeaveRecord, WorkLocation,
  ShiftPattern, AvailabilityRecord, ConfirmedShift,
} from '../types';
import { ADMIN_EMAIL, ADMIN_PASSWORD, DEFAULT_SHIFT_PATTERNS } from './constants';

const KEY_STAFF = 'tof_staff';
const KEY_ATTENDANCE = 'tof_attendance';
const KEY_LEAVE = 'tof_leave';
const KEY_SHIFT_PATTERNS = 'tof_shift_patterns';
const KEY_AVAILABILITY = 'tof_availability';
const KEY_CONFIRMED = 'tof_confirmed';
const KEY_SEEDED = 'tof_seeded';

function load<T>(key: string): T[] {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T[]) : [];
  } catch {
    return [];
  }
}

function save<T>(key: string, items: T[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

export function genId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** ローカル時刻での今日（YYYY-MM-DD）。toISOStringはUTCのため日本では日付がずれることがある */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- 認証 ----

const KEY_ADMIN_PW = 'tof_admin_pw'; // デモモードで変更後のパスワードを保持（平文・デモ専用）

function currentAdminPassword(): string {
  return localStorage.getItem(KEY_ADMIN_PW) || ADMIN_PASSWORD;
}

export function verifyAdmin(email: string, password: string): boolean {
  return email === ADMIN_EMAIL && password === currentAdminPassword();
}

/** デモモードのパスワード変更（現在のパスワード照合が必須） */
export function changeAdminPassword(oldPassword: string, newPassword: string): void {
  if (oldPassword !== currentAdminPassword()) {
    throw new Error('現在のパスワードが正しくありません');
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error('新しいパスワードは6文字以上で入力してください');
  }
  localStorage.setItem(KEY_ADMIN_PW, newPassword);
}

// ---- 職員 ----

export function listStaff(): Staff[] {
  seedDemo();
  return load<Staff>(KEY_STAFF).sort((a, b) => a.lastKana.localeCompare(b.lastKana, 'ja'));
}

export function getStaff(id: string): Staff | null {
  return listStaff().find(s => s.id === id) ?? null;
}

export function upsertStaff(staff: Staff): Staff {
  const all = load<Staff>(KEY_STAFF);
  const now = new Date().toISOString();
  const idx = all.findIndex(s => s.id === staff.id);
  const next = { ...staff, updatedAt: now };
  if (idx >= 0) {
    all[idx] = next;
  } else {
    next.createdAt = now;
    all.push(next);
  }
  save(KEY_STAFF, all);
  return next;
}

// ---- 勤怠 ----

/** month: 'YYYY-MM' */
export function listAttendance(staffId: string, month: string): AttendanceRecord[] {
  return load<AttendanceRecord>(KEY_ATTENDANCE).filter(
    r => r.staffId === staffId && r.date.startsWith(month)
  );
}

/** 指定職員・指定月の勤怠を丸ごと差し替える */
export function saveMonthAttendance(staffId: string, month: string, records: AttendanceRecord[]) {
  const others = load<AttendanceRecord>(KEY_ATTENDANCE).filter(
    r => !(r.staffId === staffId && r.date.startsWith(month))
  );
  save(KEY_ATTENDANCE, [...others, ...records]);
}

// ---- シフト区分マスタ ----

export function listShiftPatterns(): ShiftPattern[] {
  const saved = load<ShiftPattern>(KEY_SHIFT_PATTERNS);
  const list = saved.length ? saved : DEFAULT_SHIFT_PATTERNS;
  return list.slice().sort((a, b) => a.order - b.order);
}

export function saveShiftPatterns(patterns: ShiftPattern[]) {
  save(KEY_SHIFT_PATTERNS, patterns);
}

// ---- シフト希望（○×・人単位） ----

/** month: 'YYYY-MM' */
export function listAvailabilityByMonth(month: string): AvailabilityRecord[] {
  return load<AvailabilityRecord>(KEY_AVAILABILITY).filter(r => r.date.startsWith(month));
}

/** 指定職員群・指定月の希望を丸ごと差し替える（表に出ている職員のみ更新） */
export function saveMonthAvailability(month: string, staffIds: string[], records: AvailabilityRecord[]) {
  const ids = new Set(staffIds);
  const others = load<AvailabilityRecord>(KEY_AVAILABILITY).filter(
    r => !(r.date.startsWith(month) && ids.has(r.staffId))
  );
  save(KEY_AVAILABILITY, [...others, ...records]);
}

// ---- 確定シフト（職員×日×勤務場所） ----

export function listConfirmedByMonth(month: string): ConfirmedShift[] {
  return load<ConfirmedShift>(KEY_CONFIRMED).filter(r => r.date.startsWith(month));
}

export function listConfirmedByDate(date: string): ConfirmedShift[] {
  return load<ConfirmedShift>(KEY_CONFIRMED).filter(r => r.date === date);
}

/** 指定勤務場所・指定月の確定シフトを丸ごと差し替える */
export function saveMonthConfirmed(month: string, location: WorkLocation, records: ConfirmedShift[]) {
  const others = load<ConfirmedShift>(KEY_CONFIRMED).filter(
    r => !(r.date.startsWith(month) && r.location === location)
  );
  save(KEY_CONFIRMED, [...others, ...records]);
}

// ---- 有給休暇 ----

export function listLeave(staffId: string): LeaveRecord[] {
  return load<LeaveRecord>(KEY_LEAVE)
    .filter(r => r.staffId === staffId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function addLeave(record: LeaveRecord) {
  const all = load<LeaveRecord>(KEY_LEAVE);
  all.push(record);
  save(KEY_LEAVE, all);
}

export function deleteLeave(id: string) {
  save(KEY_LEAVE, load<LeaveRecord>(KEY_LEAVE).filter(r => r.id !== id));
}

/** 残日数 = 付与合計 - 取得合計 */
export function leaveBalance(staffId: string): { granted: number; used: number; balance: number } {
  const records = listLeave(staffId);
  const granted = records.filter(r => r.kind === 'grant').reduce((s, r) => s + r.days, 0);
  const used = records.filter(r => r.kind === 'use').reduce((s, r) => s + r.days, 0);
  return { granted, used, balance: granted - used };
}

// ---- デモデータ ----

function seedDemo() {
  const seeded = localStorage.getItem(KEY_SEEDED);
  if (seeded === '2') return;
  if (seeded) {
    // v1 → v2: 既存データに勤務場所を追加（デモ職員には既定値を設定）
    const defaults: Record<string, WorkLocation> = { stf001: 'sotai', stf002: 'sotai', stf003: 'kaiyo' };
    const migrated = load<Staff>(KEY_STAFF).map(s => ({
      ...s,
      workLocation: s.workLocation ?? defaults[s.id] ?? '',
    }));
    save(KEY_STAFF, migrated);
    localStorage.setItem(KEY_SEEDED, '2');
    return;
  }
  const now = new Date().toISOString();
  const demo: Staff[] = [
    {
      id: 'stf001',
      lastName: '高須', firstName: '太郎', lastKana: 'タカス', firstKana: 'タロウ',
      birthDate: '1975-04-10',
      employmentType: 'fulltime', workLocation: 'sotai', position: '事務局長',
      hireDate: '2015-04-01', retireDate: '', status: 'active',
      phone: '0166-87-1111', email: 'taro@takasu-sc.jp',
      address: '北海道上川郡鷹栖町南1条2丁目', qualifications: 'スポーツ指導員',
      note: '', createdAt: now, updatedAt: now,
    },
    {
      id: 'stf002',
      lastName: '鈴木', firstName: '花子', lastKana: 'スズキ', firstKana: 'ハナコ',
      birthDate: '1988-09-22',
      employmentType: 'parttime', workLocation: 'sotai', position: '事務員',
      hireDate: '2020-06-01', retireDate: '', status: 'active',
      phone: '0166-87-2222', email: 'hanako@takasu-sc.jp',
      address: '北海道上川郡鷹栖町北3条4丁目', qualifications: '簿記2級',
      note: '週4日勤務', createdAt: now, updatedAt: now,
    },
    {
      id: 'stf003',
      lastName: '佐藤', firstName: '健', lastKana: 'サトウ', firstKana: 'ケン',
      birthDate: '1992-01-15',
      employmentType: 'instructor', workLocation: 'kaiyo', position: '水泳教室 指導員',
      hireDate: '2022-04-01', retireDate: '', status: 'active',
      phone: '090-1234-5678', email: 'ken@example.com',
      address: '北海道旭川市', qualifications: '水泳指導員資格',
      note: '', createdAt: now, updatedAt: now,
    },
  ];
  save(KEY_STAFF, demo);
  const leaves: LeaveRecord[] = [
    { id: 'lv001', staffId: 'stf001', kind: 'grant', date: '2025-10-01', days: 20, note: '年次付与' },
    { id: 'lv002', staffId: 'stf001', kind: 'use', date: '2026-01-09', days: 1, note: '' },
    { id: 'lv003', staffId: 'stf002', kind: 'grant', date: '2025-12-01', days: 12, note: '年次付与' },
  ];
  save(KEY_LEAVE, leaves);
  localStorage.setItem(KEY_SEEDED, '2');
}
