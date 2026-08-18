import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../components/AuthContext';
import {
  getStaff, listStaff, listAttendance, getMyProfile, getMyAttendance,
  listConfirmedByMonth, getMyConfirmed, listShiftPatterns, todayStr,
} from '../../api/data';
import { DAY_TYPE_LABELS, WEEKDAY_LABELS } from '../../utils/constants';
import { isNationalHoliday } from '../../utils/holidays';
import { shiftPlanByDate, isMissingPunch } from '../../utils/shiftPlan';
import type { Staff, AttendanceRecord, ConfirmedShift, ShiftPattern } from '../../types';

/** 'YYYY-MM' の月の日付一覧（YYYY-MM-DD） */
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
function parseHM(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** 実働分数＝退勤−出勤−休憩（出勤日で出退勤が入力済みのときのみ） */
function workMinutes(rec?: AttendanceRecord): number {
  if (!rec || rec.dayType !== 'work') return 0;
  const s = parseHM(rec.startTime), e = parseHM(rec.endTime);
  if (s === null || e === null) return 0;
  return Math.max(0, e - s - (rec.breakMinutes || 0));
}
const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

interface Sheet { staff: Staff; records: Record<string, AttendanceRecord>; confirmed: ConfirmedShift[] }

export default function AttendancePrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { isStaff } = useAuth();
  const month = params.get('month') || todayStr().slice(0, 7);
  const staffId = params.get('staffId') || '';
  const all = params.get('all') === '1'; // 在職者全員を一括出力

  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [loading, setLoading] = useState(true);

  // 印刷はA4縦（このページにいる間だけ @page を縦に上書き）
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }';
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const toMap = (list: AttendanceRecord[]) => {
        const m: Record<string, AttendanceRecord> = {};
        for (const r of list) m[r.date] = r;
        return m;
      };
      let built: Sheet[] = [];
      if (isStaff) {
        // 従業員は自分の勤怠・シフトのみ
        const [s, list, conf] = await Promise.all([getMyProfile(), getMyAttendance(month), getMyConfirmed(month)]);
        if (s) built = [{ staff: s, records: toMap(list), confirmed: conf }];
      } else if (all) {
        // 事務局：在職者全員を1ページずつ（職員ごとに改ページ）
        const [staffList, conf] = await Promise.all([listStaff(), listConfirmedByMonth(month)]);
        for (const s of staffList.filter(x => x.status === 'active')) {
          built.push({
            staff: s, records: toMap(await listAttendance(s.id, month)),
            confirmed: conf.filter(c => c.staffId === s.id),
          });
        }
      } else {
        const [s, list, conf] = await Promise.all([
          getStaff(staffId), listAttendance(staffId, month), listConfirmedByMonth(month),
        ]);
        if (s) built = [{ staff: s, records: toMap(list), confirmed: conf.filter(c => c.staffId === s.id) }];
      }
      if (!alive) return;
      setSheets(built);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [isStaff, staffId, month, all]);

  useEffect(() => { listShiftPatterns().then(setPatterns).catch(() => {}); }, []);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const today = todayStr();
  const [y, m] = month.split('-');

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">PDFで保存（印刷）</button>
        <span className="text-xs text-gray-400">
          印刷ダイアログで送信先を「PDFに保存」にするとPDFとして保存できます{all && '（職員ごとに改ページ）'}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : sheets.length === 0 ? (
        <p className="text-sm text-gray-500">対象の職員が見つかりません。</p>
      ) : sheets.map((sh, idx) => {
        const staff = sh.staff;
        const records = sh.records;
        const plans = shiftPlanByDate(sh.confirmed, patterns);
        const missing = days.filter(d => isMissingPunch(records[d], plans.get(d), d, today));
        const list = days.map(d => records[d]).filter((r): r is AttendanceRecord => !!r);
        const totals = {
          work: list.filter(r => r.dayType === 'work').length,
          paid: list.filter(r => r.dayType === 'paid').length,
          absent: list.filter(r => r.dayType === 'absent').length,
          minutes: list.reduce((s, r) => s + workMinutes(r), 0),
        };
        return (
          <section key={staff.id}
            style={{ breakAfter: idx < sheets.length - 1 ? 'page' : 'auto', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
            <h1 className="text-lg font-bold text-center mb-1">出勤簿</h1>
            <p className="text-sm text-center mb-3">{Number(y)}年{Number(m)}月</p>

            <table className="w-full text-sm mb-3 border border-gray-500 border-collapse">
              <tbody>
                <tr>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-24">氏名</th>
                  <td className="border border-gray-500 px-2 py-1">{staff.lastName} {staff.firstName}</td>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-24">雇用区分</th>
                  <td className="border border-gray-500 px-2 py-1">
                    {staff.employmentType === 'fulltime' ? '常勤職員' : staff.employmentType === 'parttime' ? 'パート職員' : staff.employmentType === 'instructor' ? '指導員' : '業務委託'}
                  </td>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-20">役職</th>
                  <td className="border border-gray-500 px-2 py-1">{staff.position || ''}</td>
                </tr>
              </tbody>
            </table>

            <table className="w-full text-sm border border-gray-500 border-collapse">
              <thead>
                <tr>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-10">日</th>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-10">曜</th>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-28">シフト予定</th>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-14">区分</th>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-16">出勤</th>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-16">退勤</th>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-24">休憩</th>
                  <th className="border border-gray-500 bg-gray-100 px-1 py-1 w-16">実働</th>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">備考</th>
                </tr>
              </thead>
              <tbody>
                {days.map(date => {
                  const rec = records[date];
                  const wd = new Date(`${date}T00:00:00`).getDay();
                  const holiday = isNationalHoliday(date);
                  const dayColor = holiday || wd === 0 ? 'text-red-600' : wd === 6 ? 'text-blue-600' : '';
                  const brk = rec?.breakStart && rec?.breakEnd
                    ? `${rec.breakStart}〜${rec.breakEnd}`
                    : rec?.breakMinutes ? `${rec.breakMinutes}分` : '';
                  return (
                    <tr key={date}>
                      <td className={`border border-gray-500 px-1 py-0.5 text-center ${dayColor}`}>{Number(date.slice(8))}</td>
                      <td className={`border border-gray-500 px-1 py-0.5 text-center ${dayColor}`}>{WEEKDAY_LABELS[wd]}</td>
                      <td className="border border-gray-500 px-1 py-0.5 text-center text-[10px] whitespace-nowrap">
                        {plans.get(date)
                          ? `${plans.get(date)!.label} ${plans.get(date)!.timeLabel}`
                          : ''}
                      </td>
                      <td className="border border-gray-500 px-1 py-0.5 text-center">{rec ? DAY_TYPE_LABELS[rec.dayType] : ''}</td>
                      <td className="border border-gray-500 px-1 py-0.5 text-center">{rec?.dayType === 'work' ? rec.startTime : ''}</td>
                      <td className="border border-gray-500 px-1 py-0.5 text-center">{rec?.dayType === 'work' ? rec.endTime : ''}</td>
                      <td className="border border-gray-500 px-1 py-0.5 text-center">{rec?.dayType === 'work' ? brk : ''}</td>
                      <td className="border border-gray-500 px-1 py-0.5 text-right">{rec && rec.dayType === 'work' && workMinutes(rec) > 0 ? hhmm(workMinutes(rec)) : ''}</td>
                      <td className="border border-gray-500 px-2 py-0.5">{rec?.note || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {missing.length > 0 && (
              <p className="text-xs text-red-600 mt-2">
                ※ シフトが入っているのに出退勤が未入力の日: {missing.map(d => `${Number(d.slice(8))}日`).join('、')}
              </p>
            )}

            {/* 集計 */}
            <table className="w-full text-sm mt-3 border border-gray-500 border-collapse">
              <tbody>
                <tr>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-28">出勤日数</th>
                  <td className="border border-gray-500 px-2 py-1 text-right w-20">{totals.work}日</td>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-28">有給日数</th>
                  <td className="border border-gray-500 px-2 py-1 text-right w-20">{totals.paid}日</td>
                </tr>
                <tr>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">欠勤日数</th>
                  <td className="border border-gray-500 px-2 py-1 text-right">{totals.absent}日</td>
                  <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">総実働時間</th>
                  <td className="border border-gray-500 px-2 py-1 text-right font-bold">{hhmm(totals.minutes)}</td>
                </tr>
              </tbody>
            </table>

            {/* 確認欄 */}
            <div className="flex justify-end gap-2 mt-4 text-xs">
              {['本人', '確認者', '承認者'].map(role => (
                <div key={role} className="border border-gray-500 w-24">
                  <div className="border-b border-gray-500 bg-gray-100 text-center py-0.5">{role}</div>
                  <div className="h-12" />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
