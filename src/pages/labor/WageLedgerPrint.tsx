// 賃金台帳（労働基準法第108条・同規則第54条）
// 記載事項: 氏名／性別／賃金計算期間／労働日数／労働時間数／
//           時間外・休日・深夜の労働時間数／賃金の種類ごとの額／控除の額
//
// 基本給・諸手当・控除額は給与計算側の情報のため、このシステムでは
// 記入欄だけを設ける。勤怠から算出できる項目は自動で埋める。
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getStaff, listAttendanceRange, listOvertimeByStaff, todayStr } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS, GENDER_LABELS, fiscalYearLabel, currentFiscalYear } from '../../utils/constants';
import { allowanceDetail, compPremiumDetail, priorOvertimeMap } from '../../utils/overtime';
import type { Staff, AttendanceRecord } from '../../types';

const parseHM = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 実働分数＝退勤−出勤−休憩 */
function workMinutes(rec: AttendanceRecord): number {
  if (rec.dayType !== 'work') return 0;
  const s = parseHM(rec.startTime), e = parseHM(rec.endTime);
  if (s === null || e === null) return 0;
  return Math.max(0, e - s - (rec.breakMinutes || 0));
}

/**
 * 深夜労働（22:00〜翌5:00）の分数。出勤〜退勤の重なりから求める。
 * 日をまたぐ勤務は退勤時刻が出勤時刻より小さい場合に翌日扱いとする。
 */
function nightMinutes(rec: AttendanceRecord): number {
  if (rec.dayType !== 'work') return 0;
  const s = parseHM(rec.startTime); let e = parseHM(rec.endTime);
  if (s === null || e === null) return 0;
  if (e <= s) e += 24 * 60;
  // 深夜帯: [22:00, 29:00) と、当日早朝の [0:00, 5:00)
  const bands: [number, number][] = [[22 * 60, 29 * 60], [0, 5 * 60]];
  let total = 0;
  for (const [bs, be] of bands) total += Math.max(0, Math.min(e, be) - Math.max(s, bs));
  return total;
}

const h1 = (min: number) => Math.round((min / 60) * 10) / 10;
const yen = (n: number) => `¥${n.toLocaleString()}`;

interface MonthRow {
  month: string;
  days: number;         // 労働日数
  workHours: number;    // 労働時間数
  overtimeHours: number;
  holidayHours: number;
  nightHours: number;
  allowance: number;    // 時間外手当（システムで計算できる分）
}

export default function WageLedgerPrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const staffId = params.get('staffId') || '';
  const fy = Number(params.get('fy')) || currentFiscalYear();

  const [staff, setStaff] = useState<Staff | null>(null);
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => {
      const m = 4 + i;
      return m <= 12 ? `${fy}-${String(m).padStart(2, '0')}` : `${fy + 1}-${String(m - 12).padStart(2, '0')}`;
    }),
    [fy]
  );

  useEffect(() => {
    if (!staffId) { setLoading(false); return; }
    let alive = true;
    (async () => {
      const [s, att, ot] = await Promise.all([
        getStaff(staffId),
        listAttendanceRange(staffId, `${fy}-04-01`, `${fy + 1}-03-31`),
        listOvertimeByStaff(staffId),
      ]);
      if (!alive) return;
      setStaff(s);

      const built = months.map(month => {
        const a = att.filter(r => r.date.startsWith(month));
        const o = ot.filter(r => r.date.startsWith(month) && r.status === 'approved');
        // 月60時間超の割増を月内の日付順に反映する
        const prior = priorOvertimeMap(o, r => r.kind, r => Number(r.resultHours) || 0);
        const allowance = o.reduce((sum, r) => {
          const hrs = Number(r.resultHours) || 0;
          const wage = s?.hourlyWage || 0;
          // 代休にしたものは割増部分のみ支給する（就業規則 第20条2項）
          const d = r.disposition === 'comp'
            ? compPremiumDetail(hrs, wage, r.kind, prior.get(r.id) ?? 0)
            : allowanceDetail(hrs, wage, r.kind, prior.get(r.id) ?? 0);
          return sum + d.amount;
        }, 0);
        return {
          month,
          days: a.filter(r => r.dayType === 'work' && workMinutes(r) > 0).length,
          workHours: h1(a.reduce((x, r) => x + workMinutes(r), 0)),
          overtimeHours: Math.round(o.filter(r => r.kind === 'overtime').reduce((x, r) => x + (Number(r.resultHours) || 0), 0) * 10) / 10,
          holidayHours: Math.round(o.filter(r => r.kind === 'holiday').reduce((x, r) => x + (Number(r.resultHours) || 0), 0) * 10) / 10,
          nightHours: h1(a.reduce((x, r) => x + nightMinutes(r), 0)),
          allowance,
        };
      });
      setRows(built);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [staffId, fy, months]);

  const total = rows.reduce((t, r) => ({
    days: t.days + r.days,
    workHours: Math.round((t.workHours + r.workHours) * 10) / 10,
    overtimeHours: Math.round((t.overtimeHours + r.overtimeHours) * 10) / 10,
    holidayHours: Math.round((t.holidayHours + r.holidayHours) * 10) / 10,
    nightHours: Math.round((t.nightHours + r.nightHours) * 10) / 10,
    allowance: t.allowance + r.allowance,
  }), { days: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0, allowance: 0 });

  const th = 'border border-gray-500 bg-gray-100 px-1 py-1 text-center';
  const td = 'border border-gray-500 px-1 py-0.5 text-right';
  const blank = 'border border-gray-500 px-1 py-0.5 bg-yellow-50';

  return (
    <div className="max-w-6xl mx-auto px-4 py-5">
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">PDFで保存（印刷）</button>
        <span className="text-xs text-gray-400">A4横。色のついた欄は給与計算側で記入してください</span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : !staff ? (
        <p className="text-sm text-gray-500">職員が見つかりません。</p>
      ) : (
        <section style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
          <h1 className="text-lg font-bold text-center mb-1">賃金台帳</h1>
          <p className="text-xs text-center text-gray-500 mb-3">
            一般社団法人たかすスポーツクラブ　{fiscalYearLabel(fy)}　（労働基準法第108条）
          </p>

          <table className="w-full text-xs mb-3 border border-gray-500 border-collapse">
            <tbody>
              <tr>
                <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-20">氏名</th>
                <td className="border border-gray-500 px-2 py-1">{staff.lastName} {staff.firstName}</td>
                <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-16">性別</th>
                <td className="border border-gray-500 px-2 py-1 w-20">{staff.gender ? GENDER_LABELS[staff.gender] : ''}</td>
                <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-20">雇用区分</th>
                <td className="border border-gray-500 px-2 py-1">{EMPLOYMENT_TYPE_LABELS[staff.employmentType]}</td>
                <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-16">時給</th>
                <td className="border border-gray-500 px-2 py-1 w-24">{staff.hourlyWage ? yen(staff.hourlyWage) : ''}</td>
              </tr>
            </tbody>
          </table>

          <table className="w-full text-xs border border-gray-500 border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-20`}>賃金計算期間</th>
                <th className={th}>労働日数</th>
                <th className={th}>労働時間数</th>
                <th className={th}>時間外</th>
                <th className={th}>休日労働</th>
                <th className={th}>深夜労働</th>
                <th className={th}>基本給</th>
                <th className={th}>時間外手当</th>
                <th className={th}>その他手当</th>
                <th className={th}>賃金総額</th>
                <th className={th}>控除額</th>
                <th className={th}>差引支給額</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.month}>
                  <td className="border border-gray-500 px-1 py-0.5 text-center">{r.month.replace('-', '年')}月</td>
                  <td className={td}>{r.days || ''}</td>
                  <td className={td}>{r.workHours || ''}</td>
                  <td className={td}>{r.overtimeHours || ''}</td>
                  <td className={td}>{r.holidayHours || ''}</td>
                  <td className={td}>{r.nightHours || ''}</td>
                  <td className={blank}>&nbsp;</td>
                  <td className={td}>{r.allowance ? yen(r.allowance) : ''}</td>
                  <td className={blank}>&nbsp;</td>
                  <td className={blank}>&nbsp;</td>
                  <td className={blank}>&nbsp;</td>
                  <td className={blank}>&nbsp;</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="border border-gray-500 bg-gray-100 px-1 py-1 text-center">年度合計</td>
                <td className={`${td} bg-gray-100`}>{total.days}</td>
                <td className={`${td} bg-gray-100`}>{total.workHours}</td>
                <td className={`${td} bg-gray-100`}>{total.overtimeHours}</td>
                <td className={`${td} bg-gray-100`}>{total.holidayHours}</td>
                <td className={`${td} bg-gray-100`}>{total.nightHours}</td>
                <td className={blank}>&nbsp;</td>
                <td className={`${td} bg-gray-100`}>{total.allowance ? yen(total.allowance) : ''}</td>
                <td className={blank}>&nbsp;</td>
                <td className={blank}>&nbsp;</td>
                <td className={blank}>&nbsp;</td>
                <td className={blank}>&nbsp;</td>
              </tr>
            </tbody>
          </table>

          <p className="text-xs text-gray-500 mt-2">
            労働日数・労働時間数・深夜労働は勤怠の記録から、時間外・休日労働と時間外手当は承認済みの時間外実績から集計しています
            （代休にした分は第20条2項により割増部分のみ含めています）。基本給・その他手当・控除額は給与計算の情報のため、色のついた欄に記入してください。
          </p>
          <p className="text-xs text-gray-400 mt-1">作成日: {todayStr()}</p>
        </section>
      )}
    </div>
  );
}
