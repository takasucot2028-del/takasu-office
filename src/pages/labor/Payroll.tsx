// 給与計算用の月次データ出力
// 職員ごとに、勤怠・時間外・休暇・代休を1行にまとめてExcelに出力する。
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Input, Field, Button, Table, Th, Td, Alert } from '../../components/UI';
import { getPayrollMonthData, todayStr } from '../../api/data';
import type { PayrollMonthData } from '../../api/data';
import {
  EMPLOYMENT_TYPE_LABELS, LEAVE_HOURS_PER_DAY,
  specialLeaveDef, leaveTypeLabel, currentFiscalYear, specialLeaveUsedDays,
} from '../../utils/constants';
import { allowanceDetail, compPremiumDetail, priorOvertimeMap } from '../../utils/overtime';
import type { AttendanceRecord, Staff } from '../../types';

const parseHM = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
function workMinutes(rec: AttendanceRecord): number {
  if (rec.dayType !== 'work') return 0;
  const s = parseHM(rec.startTime), e = parseHM(rec.endTime);
  if (s === null || e === null) return 0;
  return Math.max(0, e - s - (rec.breakMinutes || 0));
}
/** 深夜労働（22:00〜翌5:00）の分数 */
function nightMinutes(rec: AttendanceRecord): number {
  if (rec.dayType !== 'work') return 0;
  const s = parseHM(rec.startTime); let e = parseHM(rec.endTime);
  if (s === null || e === null) return 0;
  if (e <= s) e += 24 * 60;
  const bands: [number, number][] = [[22 * 60, 29 * 60], [0, 5 * 60]];
  return bands.reduce((t, [bs, be]) => t + Math.max(0, Math.min(e!, be) - Math.max(s, bs)), 0);
}
const h1 = (n: number) => Math.round(n * 10) / 10;
const hFromMin = (min: number) => h1(min / 60);

interface Row {
  staff: Staff;
  workDays: number;        // 出勤日数
  workHours: number;       // 実働時間
  nightHours: number;      // 深夜労働
  absentDays: number;      // 欠勤日数
  otNormalHours: number;   // 時間外（×1.25の部分）
  otOver60Hours: number;   // 時間外（月60時間超・×1.50の部分）
  holidayHours: number;    // 休日労働（×1.35）
  allowance: number;       // 時間外手当の合計
  compGranted: number;     // 当月に代休とした時間
  compPremium: number;     // 代休にした分の割増部分（第20条2項）
  compUsed: number;        // 当月の代休消化
  paidLeaveDays: number;   // 年次有給（日）
  paidLeaveHours: number;  // 年次有給（時間）
  specialPaidDays: number; // 特別休暇のうち有給
  workTimeDays: number;    // 健康診断など「労働時間とみなす」もの
  specialUnpaidDays: number; // 特別休暇のうち無給（給与から控除する分）
  unpaidNote: string;      // 無給分の内訳
}

export default function Payroll() {
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const [data, setData] = useState<PayrollMonthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const d = await getPayrollMonthData(month);
      if (!alive) return;
      setData(d);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const fy = currentFiscalYear();
    return data.staff.filter(s => s.status === 'active').map(s => {
      const att = data.attendance.filter(r => r.staffId === s.id);
      const ot = data.overtime.filter(r => r.staffId === s.id && r.status === 'approved');
      const lv = data.leave.filter(r => r.staffId === s.id && r.kind === 'use' && (r.status || 'approved') === 'approved');
      const comp = data.compUse.filter(r => r.staffId === s.id);

      // 月60時間超の割増を日付順に反映する
      const prior = priorOvertimeMap(ot, r => r.kind, r => Number(r.resultHours) || 0);
      let otNormal = 0, otOver60 = 0, holiday = 0, allowance = 0, compGranted = 0, compPremium = 0;
      for (const r of ot) {
        const hrs = Number(r.resultHours) || 0;
        if (r.disposition === 'comp') {
          // 賃金の本体は代休に振り替え、割増部分だけ支給する（第20条2項）
          compGranted += hrs;
          compPremium += compPremiumDetail(hrs, s.hourlyWage || 0, r.kind, prior.get(r.id) ?? 0).amount;
          continue;
        }
        const d = allowanceDetail(hrs, s.hourlyWage || 0, r.kind, prior.get(r.id) ?? 0);
        allowance += d.amount;
        if (r.kind === 'holiday') holiday += hrs;
        else { otNormal += d.normalHours; otOver60 += d.over60Hours; }
      }

      // 休暇。特別休暇は有給／無給に分ける（病気休暇は年5日までが有給）
      let paidDays = 0, paidHours = 0, spPaid = 0, spUnpaid = 0, workTime = 0;
      const unpaidParts: string[] = [];
      for (const r of lv) {
        const type = r.leaveType || 'paid';
        const days = Number(r.days) || 0, hours = Number(r.hours) || 0;
        if (type === 'paid') { paidDays += days; paidHours += hours; continue; }
        const def = specialLeaveDef(type);
        const asDays = days + hours / LEAVE_HOURS_PER_DAY;
        // 健康診断などは休業ではなく労働時間とみなすため、休暇とは分けて集計する
        if (def?.asWorkingTime) { workTime += asDays; continue; }
        if (!def || def.paid) { spPaid += asDays; continue; }
        if (!def.paidDays) { spUnpaid += asDays; unpaidParts.push(`${def.name} ${h1(asDays)}日`); continue; }
        // 年度内の使用状況から、この記録が有給枠に収まるかを判定する
        const usedThisFy = specialLeaveUsedDays(
          data.leave.filter(x => x.staffId === s.id && x.date < r.date), type, fy
        );
        const remain = Math.max(0, def.paidDays - usedThisFy);
        const paidPart = Math.min(asDays, remain);
        const unpaidPart = h1(asDays - paidPart);
        spPaid += paidPart;
        if (unpaidPart > 0) { spUnpaid += unpaidPart; unpaidParts.push(`${def.name} ${unpaidPart}日`); }
      }

      return {
        staff: s,
        workDays: att.filter(r => r.dayType === 'work' && workMinutes(r) > 0).length,
        workHours: hFromMin(att.reduce((t, r) => t + workMinutes(r), 0)),
        nightHours: hFromMin(att.reduce((t, r) => t + nightMinutes(r), 0)),
        absentDays: att.filter(r => r.dayType === 'absent').length,
        otNormalHours: h1(otNormal), otOver60Hours: h1(otOver60), holidayHours: h1(holiday),
        allowance,
        compGranted: h1(compGranted), compPremium,
        compUsed: h1(comp.reduce((t, r) => t + (Number(r.hours) || 0), 0)),
        paidLeaveDays: h1(paidDays), paidLeaveHours: h1(paidHours),
        specialPaidDays: h1(spPaid), specialUnpaidDays: h1(spUnpaid), workTimeDays: h1(workTime),
        unpaidNote: unpaidParts.join('、'),
      };
    });
  }, [data]);

  const exportExcel = () => {
    const header = [
      '職員番号', '氏名', '雇用区分', '時給',
      '出勤日数', '実働時間', '深夜労働時間', '欠勤日数',
      '時間外(×1.25)', '時間外(×1.50)', '休日労働(×1.35)', '時間外手当',
      '代休付与', '代休消化', '代休分の割増',
      '年次有給(日)', '年次有給(時間)', '特別休暇 有給(日)', '特別休暇 無給(日)', '無給の内訳', '健康診断等(労働時間扱い・日)',
    ];
    const body = rows.map(r => [
      r.staff.employeeNumber, `${r.staff.lastName} ${r.staff.firstName}`,
      EMPLOYMENT_TYPE_LABELS[r.staff.employmentType], r.staff.hourlyWage || '',
      r.workDays, r.workHours, r.nightHours, r.absentDays,
      r.otNormalHours, r.otOver60Hours, r.holidayHours, r.allowance,
      r.compGranted, r.compUsed, r.compPremium,
      r.paidLeaveDays, r.paidLeaveHours, r.specialPaidDays, r.specialUnpaidDays, r.unpaidNote, r.workTimeDays,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([[`給与計算用データ　${month}`], [], header, ...body]);
    ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 8 },
      { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 9 },
      { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 11 },
      { wch: 9 }, { wch: 9 }, { wch: 12 },
      { wch: 12 }, { wch: 13 }, { wch: 15 }, { wch: 15 }, { wch: 24 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, month);
    XLSX.writeFile(wb, `給与計算用データ_${month}.xlsx`);
  };

  const totals = rows.reduce((t, r) => ({
    workDays: t.workDays + r.workDays,
    workHours: h1(t.workHours + r.workHours),
    allowance: t.allowance + r.allowance,
    unpaid: h1(t.unpaid + r.specialUnpaidDays),
  }), { workDays: 0, workHours: 0, allowance: 0, unpaid: 0 });

  return (
    <PageContainer title="給与計算用データ">
      <Card className="mb-4">
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="対象月">
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </Field>
          <div className="mb-4">
            <Button variant="secondary" onClick={exportExcel} disabled={loading || rows.length === 0}>Excel出力</Button>
          </div>
          <div className="mb-4 text-xs text-gray-500">
            在職職員 {rows.length}名／実働 {totals.workHours}h／時間外手当 ¥{totals.allowance.toLocaleString()}
            {totals.unpaid > 0 && <span className="text-amber-700">／無給控除 {totals.unpaid}日</span>}
          </div>
        </div>
        <p className="text-xs text-gray-400">
          勤怠（実働・深夜）と承認済みの時間外実績、承認済みの休暇から集計しています。
          代休にした時間外は、賃金の本体を代休に振り替え、割増部分だけを「代休分の割増」に計上します（就業規則 第20条2項）。基本給・社会保険料などは給与計算側で扱ってください。
          健康診断（第34条）は休業ではなく労働時間とみなすため、特別休暇とは分けて「健康診断等」に計上しています。
        </p>
      </Card>

      {!loading && rows.some(r => r.specialUnpaidDays > 0) && (
        <Alert type="info">
          無給の特別休暇（病気休暇の年5日を超える分など）があります。給与から控除する日数として「特別休暇 無給(日)」を確認してください。
        </Alert>
      )}

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>氏名</Th><Th>雇用区分</Th>
              <Th>出勤日数</Th><Th>実働</Th><Th>深夜</Th><Th>欠勤</Th>
              <Th>時間外×1.25</Th><Th>時間外×1.50</Th><Th>休日×1.35</Th><Th>時間外手当</Th>
              <Th>代休付与</Th><Th>代休消化</Th><Th>代休分の割増</Th>
              <Th>年次有給</Th><Th>特別休暇(有給)</Th><Th>特別休暇(無給)</Th><Th>健康診断等</Th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><Td className="text-center text-gray-400 py-8" colSpan={17}>読み込み中…</Td></tr>}
            {!loading && rows.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={17}>在職職員がいません</Td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.staff.id}>
                <Td className="whitespace-nowrap font-medium">{r.staff.lastName} {r.staff.firstName}</Td>
                <Td className="whitespace-nowrap text-xs">{EMPLOYMENT_TYPE_LABELS[r.staff.employmentType]}</Td>
                <Td className="text-right">{r.workDays || ''}</Td>
                <Td className="text-right">{r.workHours || ''}</Td>
                <Td className="text-right">{r.nightHours || ''}</Td>
                <Td className="text-right">{r.absentDays || ''}</Td>
                <Td className="text-right">{r.otNormalHours || ''}</Td>
                <Td className="text-right">{r.otOver60Hours || ''}</Td>
                <Td className="text-right">{r.holidayHours || ''}</Td>
                <Td className="text-right font-medium">{r.allowance ? `¥${r.allowance.toLocaleString()}` : ''}</Td>
                <Td className="text-right">{r.compGranted || ''}</Td>
                <Td className="text-right">{r.compUsed || ''}</Td>
                <Td className="text-right">{r.compPremium ? `¥${r.compPremium.toLocaleString()}` : ''}</Td>
                <Td className="text-right whitespace-nowrap">
                  {r.paidLeaveDays ? `${r.paidLeaveDays}日` : ''}
                  {r.paidLeaveHours ? ` ${r.paidLeaveHours}h` : ''}
                </Td>
                <Td className="text-right">{r.specialPaidDays || ''}</Td>
                <Td className="text-right">
                  {r.specialUnpaidDays ? (
                    <span className="text-amber-700 font-medium" title={r.unpaidNote}>{r.specialUnpaidDays}</span>
                  ) : ''}
                </Td>
                <Td className="text-right">{r.workTimeDays || ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {!loading && rows.some(r => r.unpaidNote) && (
        <Card className="mt-4">
          <h2 className="font-bold text-gray-800 mb-2 text-sm">無給分の内訳</h2>
          <ul className="text-xs text-gray-600 space-y-1">
            {rows.filter(r => r.unpaidNote).map(r => (
              <li key={r.staff.id}>
                <span className="font-medium">{r.staff.lastName} {r.staff.firstName}</span>：{r.unpaidNote}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-gray-400 mt-3">
        {leaveTypeLabel('paid')}は残から差し引く対象、特別休暇は種類ごとの規定によります。
      </p>
    </PageContainer>
  );
}
