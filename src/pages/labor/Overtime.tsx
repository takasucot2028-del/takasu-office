import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import {
  getReference, getOvertimeMonthData,
  saveMonthOvertime, addCompUse, deleteCompUse,
  genId, todayStr,
} from '../../api/data';
import { WEEKDAY_LABELS, breakMinutesBetween, fiscalYearOf, fiscalYearLabel } from '../../utils/constants';
import {
  monthlyTotals, evaluate36,
  LIMIT_MONTHLY, LIMIT_YEARLY, LIMIT_YEARLY_SPECIAL, LIMIT_MONTHLY_ABSOLUTE,
  LIMIT_MULTI_MONTH_AVG, LIMIT_OVER45_COUNT,
} from '../../utils/limit36';
import {
  isOvertimeTarget, overtimeKindOf, standardHoursOf, resultHoursOf,
  allowanceDetail, compPremiumDetail, compDeadlineOf, priorOvertimeMap, patternHours,
  OVERTIME_MONTHLY_THRESHOLD,
  OVERTIME_STATUS_LABELS, OVERTIME_KIND_LABELS,
} from '../../utils/overtime';
import type { Staff, ShiftPattern, ConfirmedShift, AttendanceRecord, OvertimeRecord, CompLeaveUse, OvertimeDisposition } from '../../types';

function currentMonth(): string { return todayStr().slice(0, 7); }
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function parseHM(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** 勤怠レコードの実働時間（時間） */
function workedHoursOf(rec: AttendanceRecord | undefined): number {
  if (!rec || rec.dayType !== 'work') return 0;
  const s = parseHM(rec.startTime), e = parseHM(rec.endTime);
  if (s === null || e === null) return 0;
  return Math.max(0, e - s - (rec.breakMinutes || 0)) / 60;
}
const yen = (n: number) => `¥${n.toLocaleString()}`;
const h1 = (n: number) => `${Math.round(n * 10) / 10}h`;

export default function Overtime() {
  const navigate = useNavigate();
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);

  const [staffId, setStaffId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [reloadKey, setReloadKey] = useState(0);

  const [allOt, setAllOt] = useState<OvertimeRecord[]>([]);   // 対象職員の全月の時間外
  const [compUse, setCompUse] = useState<CompLeaveUse[]>([]);
  const [records, setRecords] = useState<OvertimeRecord[]>([]); // 当月の編集用コピー
  const [attMap, setAttMap] = useState<Record<string, number>>({});   // date→実働h
  const [shiftMap, setShiftMap] = useState<Record<string, number>>({}); // date→シフト予定h

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // 申請フォーム
  const [fDate, setFDate] = useState(todayStr());
  const [fStart, setFStart] = useState('18:00');
  const [fEnd, setFEnd] = useState('19:00');
  const [fReason, setFReason] = useState('');
  // 代休取得フォーム
  const [cDate, setCDate] = useState(todayStr());
  const [cHours, setCHours] = useState('8');
  const [cNote, setCNote] = useState('');

  const targetStaff = useMemo(() => allStaff.filter(s => s.status === 'active' && isOvertimeTarget(s)), [allStaff]);
  const staff = useMemo(() => allStaff.find(s => s.id === staffId) ?? null, [allStaff, staffId]);
  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);

  // 初回：職員・区分
  useEffect(() => {
    let alive = true;
    (async () => {
      const { staff: s, patterns: p } = await getReference();
      if (!alive) return;
      setAllStaff(s);
      setPatterns(p);
      setStaffLoaded(true);
      const first = s.find(x => x.status === 'active' && isOvertimeTarget(x));
      if (first) setStaffId(first.id);
    })();
    return () => { alive = false; };
  }, []);

  // 職員×月のデータ（時間外・代休取得・勤怠・確定シフト）を1リクエストでまとめて取得
  useEffect(() => {
    if (!staffId) return;
    let alive = true;
    setMessage('');
    (async () => {
      const d = await getOvertimeMonthData(staffId, month);
      if (!alive) return;
      setAllOt(d.overtime);
      setCompUse(d.compUse);
      const am: Record<string, number> = {};
      for (const r of d.attendance) am[r.date] = workedHoursOf(r);
      const sm: Record<string, number> = {};
      for (const c of d.confirmed as ConfirmedShift[]) {
        if (c.staffId !== staffId) continue;
        const p = patternMap.get(c.patternId);
        if (p) sm[c.date] = (sm[c.date] || 0) + patternHours(p);
      }
      setAttMap(am);
      setShiftMap(sm);
    })();
    return () => { alive = false; };
  }, [staffId, month, reloadKey, patternMap]);

  // 当月の編集コピー（全時間外から当月を抽出）
  useEffect(() => {
    setRecords(allOt.filter(r => r.date.startsWith(month)).map(r => ({ ...r })));
  }, [allOt, month]);

  // 実績時間だけを求める（累計の計算に使う。手当は含めない）
  const resultOf = (r: { date: string }) => {
    if (!staff) return 0;
    return resultHoursOf(attMap[r.date] || 0, standardHoursOf(staff, r.date, shiftMap[r.date] || 0));
  };
  // 各記録の「その記録より前の時間外累計」。月60時間超の割増判定に使う。
  const priorMap = useMemo(
    () => (staff ? priorOvertimeMap(records, r => overtimeKindOf(staff, r.date), resultOf) : new Map<string, number>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staff, records, attMap, shiftMap]
  );

  /**
   * 1レコードの計算（実働・基準・実績・支給額）。
   * 手当は月60時間超の割増を反映する。代休にした分は、賃金の本体を代休に振り替え、
   * 割増部分だけを支給する（就業規則 第20条2項）。
   */
  const calc = (r: OvertimeRecord) => {
    if (!staff) return { kind: r.kind, worked: 0, standard: 0, result: 0, amount: 0, over60Hours: 0, premium: 0 };
    const kind = overtimeKindOf(staff, r.date);
    const worked = attMap[r.date] || 0;
    const standard = standardHoursOf(staff, r.date, shiftMap[r.date] || 0);
    const result = resultHoursOf(worked, standard);
    const wage = staff.hourlyWage || 0;
    const prior = priorMap.get(r.id) ?? 0;
    const d = allowanceDetail(result, wage, kind, prior);
    const p = compPremiumDetail(result, wage, kind, prior);
    return { kind, worked, standard, result, amount: d.amount, over60Hours: d.over60Hours, premium: p.amount };
  };

  const setRec = (id: string, patch: Partial<OvertimeRecord>) =>
    setRecords(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const removeRec = (id: string) => setRecords(prev => prev.filter(r => r.id !== id));

  const addApplication = () => {
    if (!staff) return;
    const hrs = breakMinutesBetween(fStart, fEnd) / 60; // 終了−開始（時間）
    if (!fDate.startsWith(month)) { setError('申請日は表示中の月の日付にしてください'); return; }
    if (records.some(r => r.date === fDate)) { setError('その日の時間外はすでにあります'); return; }
    if (!fStart || !fEnd) { setError('開始と終了の時刻を入力してください'); return; }
    if (hrs <= 0) { setError('終了は開始より後の時刻にしてください'); return; }
    setError('');
    const rec: OvertimeRecord = {
      id: genId('ot'), staffId: staff.id, date: fDate,
      kind: overtimeKindOf(staff, fDate),
      appliedHours: Math.round(hrs * 100) / 100, reason: fReason,
      startTime: fStart, endTime: fEnd,
      status: 'applied', disposition: '', resultHours: 0, note: '',
    };
    setRecords(prev => [...prev, rec].sort((a, b) => a.date.localeCompare(b.date)));
    setFReason('');
  };

  const handleSave = async () => {
    if (!staff) return;
    setSaving(true); setError(''); setMessage('');
    try {
      // 実績・種別を確定値として書き込んで保存
      const toSave = records.map(r => {
        const c = calc(r);
        return { ...r, kind: c.kind, resultHours: c.result };
      });
      await saveMonthOvertime(staff.id, month, toSave);
      setMessage('保存しました');
      setReloadKey(k => k + 1); // 代休残の再計算のため再読込
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 36協定の上限（allOt はその職員の全期間の記録なので追加の通信は不要）
  const months36 = useMemo(() => monthlyTotals(allOt), [allOt]);
  const status36 = useMemo(() => evaluate36(months36, month), [months36, month]);
  const fyMonths36 = useMemo(() => {
    const fy = fiscalYearOf(`${month}-01`);
    return months36.filter(m => fiscalYearOf(`${m.month}-01`) === fy);
  }, [months36, month]);

  // 代休残 = 承認済・代休指定の実績合計（保存済） - 代休取得合計
  const compGranted = allOt
    .filter(r => r.status === 'approved' && r.disposition === 'comp')
    .reduce((s, r) => s + (r.resultHours || 0), 0);
  const compUsed = compUse.reduce((s, r) => s + (r.hours || 0), 0);
  const compBalance = Math.round((compGranted - compUsed) * 10) / 10;

  // 当月集計
  const monthAllowance = records
    .filter(r => r.status === 'approved' && r.disposition === 'allowance')
    .reduce((s, r) => s + calc(r).amount, 0);
  // 代休にした分の割増部分（第20条2項）
  const monthCompPremium = records
    .filter(r => r.status === 'approved' && r.disposition === 'comp')
    .reduce((s, r) => s + calc(r).premium, 0);
  const monthComp = records
    .filter(r => r.status === 'approved' && r.disposition === 'comp')
    .reduce((s, r) => s + calc(r).result, 0);
  // 月末の自動集計（承認済ベース）
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const approvedRecs = records.filter(r => r.status === 'approved');
  const monthWeekdayOt = r1(approvedRecs.filter(r => calc(r).kind === 'overtime').reduce((s, r) => s + calc(r).result, 0));
  const monthHoliday = r1(approvedRecs.filter(r => calc(r).kind === 'holiday').reduce((s, r) => s + calc(r).result, 0));
  const monthAllowanceHours = r1(approvedRecs.filter(r => r.disposition === 'allowance').reduce((s, r) => s + calc(r).result, 0));
  const monthCompUsed = r1(compUse.filter(u => u.date.startsWith(month)).reduce((s, u) => s + (u.hours || 0), 0));
  // 60時間を超えた分（×1.50 対象）の合計
  const monthOver60 = r1(approvedRecs.reduce((s, r) => s + calc(r).over60Hours, 0));
  // 出退勤（実働）が未入力の申請があるか（実績が0のまま気づかないのを防ぐ）
  const anyMissingAttendance = records.some(r => (attMap[r.date] || 0) === 0);

  // 時間外勤務実績簿は印刷ページ（PDF保存）で出力する
  const openJisekibo = () => navigate(`/labor/overtime/print?month=${month}&staffId=${staffId}`);
  const openJisekiboAll = () => navigate(`/labor/overtime/print?month=${month}`);

  const addCompUseRec = async () => {
    if (!staff) return;
    const hrs = Number(cHours);
    if (!hrs || hrs <= 0) { setError('代休の時間を入力してください'); return; }
    setError('');
    try {
      await addCompUse({ id: genId('cu'), staffId: staff.id, date: cDate, hours: hrs, note: cNote });
      setCNote('');
      setReloadKey(k => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '代休取得の記録に失敗しました');
    }
  };
  const removeCompUse = async (id: string) => {
    if (!confirm('この代休取得を削除しますか？')) return;
    try { await deleteCompUse(id); setReloadKey(k => k + 1); }
    catch (err) { setError(err instanceof Error ? err.message : '削除に失敗しました'); }
  };

  return (
    <PageContainer title="時間外・休日勤務">
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="sm:w-72">
            <Select value={staffId} onChange={e => setStaffId(e.target.value)}>
              {targetStaff.map(s => (
                <option key={s.id} value={s.id}>{s.lastName} {s.firstName}（{s.employmentType === 'fulltime' ? '常勤' : 'パート'}・時給{(s.hourlyWage || 0).toLocaleString()}円）</option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, -1))}>←</Button>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, 1))}>→</Button>
          </div>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={openJisekibo}>実績簿PDF</Button>
          <Button variant="secondary" size="sm" onClick={openJisekiboAll}>全員分をまとめて印刷</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !staff}>{saving ? '保存中…' : '保存する'}</Button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          実働は「勤怠管理」の出退勤から自動集計。実績時間＝実働−基準（常勤=7.5時間／パート=シフト予定、常勤の土日祝は休日勤務で実働全部）。
          手当＝時給×割増（時間外×1.25／<span className="font-medium">当月の時間外が60時間を超えた分は×1.50</span>／休日×1.35）。
        </p>
      </Card>

      {staffLoaded && targetStaff.length === 0 && (
        <Alert type="info">時間外管理の対象（常勤職員・パート職員）の在職者がいません。</Alert>
      )}
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      {staff && (
        <>
          {/* 当月の自動集計（承認済ベース） */}
          <Card className="mb-4">
            <h2 className="font-bold text-gray-800 mb-3">当月の集計 <span className="text-xs font-normal text-gray-400">（{month}・承認済）</span></h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Tile label="平日時間外" value={h1(monthWeekdayOt)} />
              <Tile label="休日勤務" value={h1(monthHoliday)} />
              <Tile label="時間外手当 時間" value={h1(monthAllowanceHours)} />
              <Tile label="時間外手当 金額" value={yen(monthAllowance)} highlight />
              <Tile label="代休付与" value={h1(monthComp)} />
              <Tile label="代休分の割増（第20条2項）" value={yen(monthCompPremium)} />
              <Tile label="当月 代休消化" value={h1(monthCompUsed)} />
            </div>
            {monthOver60 > 0 && (
              <p className="mt-3 text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
                当月の時間外が{OVERTIME_MONTHLY_THRESHOLD}時間を超えています。
                超過分 <span className="font-bold">{h1(monthOver60)}</span> は割増率 ×1.50 で計算しています。
              </p>
            )}
          </Card>

          {/* 36協定の上限（労基法第36条） */}
          <Card className={`mb-4 ${status36.warnings.some(w => w.level === 'error') ? 'border-red-300'
            : status36.warnings.length > 0 ? 'border-yellow-300' : ''}`}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h2 className="font-bold text-gray-800">
                36協定の上限 <span className="text-xs font-normal text-gray-400">（{fiscalYearLabel(fiscalYearOf(`${month}-01`))}・承認済ベース）</span>
              </h2>
              {status36.warnings.length === 0 && <Badge color="green">上限内</Badge>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label={`当月 時間外／月${LIMIT_MONTHLY}h`} value={h1(status36.overtimeHours)} />
              <Tile label={`当月 時間外＋休日／月${LIMIT_MONTHLY_ABSOLUTE}h未満`} value={h1(status36.totalHours)} />
              <Tile label={`年度累計 時間外／年${LIMIT_YEARLY}h（上限${LIMIT_YEARLY_SPECIAL}h）`} value={h1(status36.yearOvertimeHours)} highlight />
              <Tile label={`月${LIMIT_MONTHLY}h超の回数／年${LIMIT_OVER45_COUNT}回`} value={`${status36.over45Count}回`} />
            </div>

            {status36.warnings.length > 0 && (
              <div className="mt-3 space-y-2">
                {status36.warnings.map((w, i) => (
                  <p key={i} className={`text-sm rounded px-3 py-2 ${w.level === 'error'
                    ? 'text-red-700 bg-red-50' : 'text-amber-700 bg-amber-50'}`}>
                    {w.text}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-3 text-xs text-gray-500">
              <span className="font-medium text-gray-700">当月までの平均（時間外＋休日、上限{LIMIT_MULTI_MONTH_AVG}h）：</span>
              {status36.averages.map(a => (
                <span key={a.months} className={`ml-2 ${a.avg > LIMIT_MULTI_MONTH_AVG ? 'text-red-600 font-bold' : ''}`}>
                  {a.months}か月 {a.avg}h
                </span>
              ))}
            </div>

            {fyMonths36.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {fyMonths36.map(m => (
                  <span key={m.month}
                    className={`text-xs px-2 py-1 rounded border ${m.overtimeHours > LIMIT_MONTHLY
                      ? 'bg-amber-50 border-amber-300 text-amber-800 font-medium'
                      : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                    {m.month}　時間外{m.overtimeHours}h{m.holidayHours > 0 ? `／休日${m.holidayHours}h` : ''}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">
              集計は会計年度（4月始まり）です。36協定の起算月が異なる場合は読み替えてください。
            </p>
          </Card>

          {/* 残数など */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <Tile label="代休 残時間" value={h1(compBalance)} highlight />
            <Tile label="時給" value={yen(staff.hourlyWage || 0)} />
            <Tile label="今月の手当（承認済）" value={yen(monthAllowance)} />
          </div>

          {/* 申請追加 */}
          <Card className="mb-4">
            <h2 className="font-bold text-gray-800 mb-3">時間外の申請を追加</h2>
            <div className="grid sm:grid-cols-5 gap-3 items-end">
              <Field label="日付">
                <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
              </Field>
              <Field label="開始">
                <Input type="time" value={fStart} onChange={e => setFStart(e.target.value)} />
              </Field>
              <Field label="終了">
                <Input type="time" value={fEnd} onChange={e => setFEnd(e.target.value)} />
              </Field>
              <Field label="事由">
                <Input value={fReason} onChange={e => setFReason(e.target.value)} placeholder="例: イベント準備" />
              </Field>
              <div className="mb-4"><Button className="w-full" onClick={addApplication}>申請を追加</Button></div>
            </div>
          </Card>

          {anyMissingAttendance && (
            <Alert type="info">
              出退勤が未入力の日があります（下表で <span className="text-red-500 font-medium">勤怠未入力</span> と表示）。「勤怠管理」でその日の出退勤を入力すると、実績・手当・代休付与に反映されます。
            </Alert>
          )}

          {/* 当月の一覧 */}
          <Card className="p-0 overflow-x-auto mb-6">
            <Table>
              <thead>
                <tr>
                  <Th>日付</Th><Th>種別</Th><Th>事由</Th><Th>申請</Th><Th>状態</Th>
                  <Th>実働</Th><Th>基準</Th><Th>実績</Th><Th>処理</Th><Th>金額/付与</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const c = calc(r);
                  const wd = new Date(`${r.date}T00:00:00`).getDay();
                  return (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">{Number(r.date.slice(5, 7))}/{Number(r.date.slice(8))}
                        <span className={`ml-1 text-xs ${wd === 0 ? 'text-red-500' : wd === 6 ? 'text-blue-500' : 'text-gray-400'}`}>({WEEKDAY_LABELS[wd]})</span>
                      </Td>
                      <Td><Badge color={c.kind === 'holiday' ? 'red' : 'yellow'}>{OVERTIME_KIND_LABELS[c.kind]}</Badge></Td>
                      <Td className="min-w-28"><Input value={r.reason} onChange={e => setRec(r.id, { reason: e.target.value })} /></Td>
                      <Td className="whitespace-nowrap text-gray-500">
                        {r.startTime && r.endTime ? <span>{r.startTime}〜{r.endTime}<span className="text-gray-400 ml-1">({r.appliedHours}h)</span></span> : `${r.appliedHours}h`}
                      </Td>
                      <Td>
                        {r.status === 'approved'
                          ? <button onClick={() => setRec(r.id, { status: 'applied' })}><Badge color="green">{OVERTIME_STATUS_LABELS.approved}</Badge></button>
                          : <Button size="sm" variant="secondary" onClick={() => setRec(r.id, { status: 'approved' })}>承認</Button>}
                      </Td>
                      <Td className="whitespace-nowrap text-gray-600">
                        {h1(c.worked)}
                        {c.worked === 0 && <div className="text-[10px] text-red-500 leading-tight">勤怠未入力</div>}
                      </Td>
                      <Td className="whitespace-nowrap text-gray-500">{h1(c.standard)}</Td>
                      <Td className="whitespace-nowrap font-medium">{h1(c.result)}</Td>
                      <Td>
                        <Select value={r.disposition} onChange={e => setRec(r.id, { disposition: e.target.value as OvertimeDisposition })}>
                          <option value="">未定</option>
                          <option value="allowance">手当</option>
                          <option value="comp">代休</option>
                        </Select>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {r.disposition === 'allowance' ? <span className="font-medium">{yen(c.amount)}</span>
                          : r.disposition === 'comp' ? (
                            <span className="text-gray-600">
                              代休 {h1(c.result)}
                              <span className="block text-xs text-emerald-700">割増 {yen(c.premium)}</span>
                              <span className="block text-xs text-gray-400">期限 {compDeadlineOf(r.date)}</span>
                            </span>
                          )
                          : <span className="text-gray-300">—</span>}
                      </Td>
                      <Td><Button variant="ghost" size="sm" onClick={() => removeRec(r.id)}>削除</Button></Td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr><Td className="text-center text-gray-400 py-8" colSpan={11}>この月の時間外はありません</Td></tr>
                )}
              </tbody>
            </Table>
          </Card>

          {/* 代休取得 */}
          <Card>
            <h2 className="font-bold text-gray-800 mb-1">代休の取得（消化）</h2>
            <p className="text-xs text-gray-500 mb-3">代休にした時間外の合計 {h1(compGranted)} − 取得 {h1(compUsed)} ＝ 残 <span className="font-medium text-emerald-700">{h1(compBalance)}</span></p>
            <div className="grid sm:grid-cols-4 gap-3 items-end mb-4">
              <Field label="取得日"><Input type="date" value={cDate} onChange={e => setCDate(e.target.value)} /></Field>
              <Field label="時間（h）"><Input type="number" min={0} step={0.5} value={cHours} onChange={e => setCHours(e.target.value)} /></Field>
              <Field label="備考"><Input value={cNote} onChange={e => setCNote(e.target.value)} placeholder="例: 終日代休" /></Field>
              <div className="mb-4"><Button className="w-full" variant="secondary" onClick={addCompUseRec}>取得を記録</Button></div>
            </div>
            <Table>
              <thead><tr><Th>取得日</Th><Th>時間</Th><Th>備考</Th><Th></Th></tr></thead>
              <tbody>
                {compUse.map(r => (
                  <tr key={r.id}>
                    <Td>{r.date}</Td><Td>{h1(r.hours)}</Td><Td>{r.note}</Td>
                    <Td><Button variant="ghost" size="sm" onClick={() => removeCompUse(r.id)}>削除</Button></Td>
                  </tr>
                ))}
                {compUse.length === 0 && <tr><Td className="text-center text-gray-400 py-6" colSpan={4}>取得記録はありません</Td></tr>}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </PageContainer>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
    </Card>
  );
}
