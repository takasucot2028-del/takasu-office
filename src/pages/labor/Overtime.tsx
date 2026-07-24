import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import {
  listStaff, listShiftPatterns, listConfirmedByMonth, listAttendance,
  listOvertimeByStaff, saveMonthOvertime, listCompUse, addCompUse, deleteCompUse,
  listOvertimeByMonth, genId, todayStr,
} from '../../api/data';
import { WEEKDAY_LABELS } from '../../utils/constants';
import {
  isOvertimeTarget, overtimeKindOf, standardHoursOf, resultHoursOf, allowanceOf,
  patternHours,
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
  const [fHours, setFHours] = useState('1');
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
      const [s, p] = await Promise.all([listStaff(), listShiftPatterns()]);
      if (!alive) return;
      setAllStaff(s);
      setPatterns(p);
      setStaffLoaded(true);
      const first = s.find(x => x.status === 'active' && isOvertimeTarget(x));
      if (first) setStaffId(first.id);
    })();
    return () => { alive = false; };
  }, []);

  // 職員の全時間外・代休取得
  useEffect(() => {
    if (!staffId) return;
    let alive = true;
    (async () => {
      const [ot, cu] = await Promise.all([listOvertimeByStaff(staffId), listCompUse(staffId)]);
      if (!alive) return;
      setAllOt(ot);
      setCompUse(cu);
    })();
    return () => { alive = false; };
  }, [staffId, reloadKey]);

  // 当月の編集コピー（全時間外から当月を抽出）
  useEffect(() => {
    setRecords(allOt.filter(r => r.date.startsWith(month)).map(r => ({ ...r })));
    setMessage('');
  }, [allOt, month]);

  // 当月の勤怠（実働）とシフト予定
  useEffect(() => {
    if (!staffId) return;
    let alive = true;
    (async () => {
      const [att, conf] = await Promise.all([listAttendance(staffId, month), listConfirmedByMonth(month)]);
      if (!alive) return;
      const am: Record<string, number> = {};
      for (const r of att) am[r.date] = workedHoursOf(r);
      const sm: Record<string, number> = {};
      for (const c of conf as ConfirmedShift[]) {
        if (c.staffId !== staffId) continue;
        const p = patternMap.get(c.patternId);
        if (p) sm[c.date] = (sm[c.date] || 0) + patternHours(p);
      }
      setAttMap(am);
      setShiftMap(sm);
    })();
    return () => { alive = false; };
  }, [staffId, month, patternMap]);

  // 1レコードの計算（実働・基準・実績・手当額）
  const calc = (r: OvertimeRecord) => {
    if (!staff) return { kind: r.kind, worked: 0, standard: 0, result: 0, amount: 0 };
    const kind = overtimeKindOf(staff, r.date);
    const worked = attMap[r.date] || 0;
    const standard = standardHoursOf(staff, r.date, shiftMap[r.date] || 0);
    const result = resultHoursOf(worked, standard);
    const amount = allowanceOf(result, staff.hourlyWage || 0, kind);
    return { kind, worked, standard, result, amount };
  };

  const setRec = (id: string, patch: Partial<OvertimeRecord>) =>
    setRecords(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const removeRec = (id: string) => setRecords(prev => prev.filter(r => r.id !== id));

  const addApplication = () => {
    if (!staff) return;
    const hrs = Number(fHours);
    if (!fDate.startsWith(month)) { setError('申請日は表示中の月の日付にしてください'); return; }
    if (records.some(r => r.date === fDate)) { setError('その日の時間外はすでにあります'); return; }
    setError('');
    const rec: OvertimeRecord = {
      id: genId('ot'), staffId: staff.id, date: fDate,
      kind: overtimeKindOf(staff, fDate),
      appliedHours: hrs > 0 ? hrs : 0, reason: fReason,
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
  // 出退勤（実働）が未入力の申請があるか（実績が0のまま気づかないのを防ぐ）
  const anyMissingAttendance = records.some(r => (attMap[r.date] || 0) === 0);

  // 時間外勤務実績簿（Excel）: 当月に時間外がある職員ごとにシートを作成（保存済み実績ベース）
  const exportJisekibo = async () => {
    setError('');
    try {
      const ot = await listOvertimeByMonth(month);
      const ids = Array.from(new Set(ot.map(r => r.staffId)));
      const targets = ids.map(id => allStaff.find(s => s.id === id)).filter((s): s is Staff => !!s);
      if (targets.length === 0) { alert('この月に時間外の記録がありません。'); return; }
      const wb = XLSX.utils.book_new();
      const used: Record<string, number> = {};
      for (const s of targets) {
        const recs = ot.filter(r => r.staffId === s.id && r.status === 'approved')
          .sort((a, b) => a.date.localeCompare(b.date));
        const kindOf = (r: OvertimeRecord) => r.kind || overtimeKindOf(s, r.date);
        const uses = (await listCompUse(s.id)).filter(u => u.date.startsWith(month));
        const compUsedMonth = uses.reduce((x, u) => x + (u.hours || 0), 0);
        const wkOt = recs.filter(r => kindOf(r) === 'overtime').reduce((x, r) => x + (r.resultHours || 0), 0);
        const hol = recs.filter(r => kindOf(r) === 'holiday').reduce((x, r) => x + (r.resultHours || 0), 0);
        const allowH = recs.filter(r => r.disposition === 'allowance').reduce((x, r) => x + (r.resultHours || 0), 0);
        const allowYen = recs.filter(r => r.disposition === 'allowance')
          .reduce((x, r) => x + allowanceOf(r.resultHours || 0, s.hourlyWage || 0, kindOf(r)), 0);
        const compGrant = recs.filter(r => r.disposition === 'comp').reduce((x, r) => x + (r.resultHours || 0), 0);
        const typeLabel = s.employmentType === 'fulltime' ? '常勤職員' : 'パート職員';
        const dispLabel: Record<string, string> = { allowance: '手当', comp: '代休', '': '未定' };
        const rows: (string | number)[][] = [
          ['時間外勤務実績簿'],
          ['氏名', `${s.lastName} ${s.firstName}`, '雇用区分', typeLabel, '対象月', month, '時給', s.hourlyWage || 0],
          [],
          ['日付', '曜日', '種別', '事由', '実績時間(h)', '処理', '金額(円)'],
          ...recs.map(r => {
            const k = kindOf(r);
            return [
              r.date, WEEKDAY_LABELS[new Date(`${r.date}T00:00:00`).getDay()],
              OVERTIME_KIND_LABELS[k], r.reason, r.resultHours || 0,
              dispLabel[r.disposition] || '未定',
              r.disposition === 'allowance' ? allowanceOf(r.resultHours || 0, s.hourlyWage || 0, k) : '',
            ];
          }),
          [],
          ['平日時間外 合計(h)', r1(wkOt)],
          ['休日勤務 合計(h)', r1(hol)],
          ['時間外手当 対象時間(h)', r1(allowH)],
          ['時間外手当 金額(円)', Math.round(allowYen)],
          ['代休付与(h)', r1(compGrant)],
          ['当月 代休消化(h)', r1(compUsedMonth)],
        ];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 20 }, { wch: 11 }, { wch: 8 }, { wch: 10 }];
        let name = `${s.lastName}${s.firstName}`.slice(0, 28).replace(/[\\/?*[\]:]/g, '');
        if (used[name]) { used[name]++; name = `${name}_${used[name]}`; } else { used[name] = 1; }
        XLSX.utils.book_append_sheet(wb, ws, name || 'sheet');
      }
      XLSX.writeFile(wb, `時間外勤務実績簿_${month}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '実績簿の出力に失敗しました');
    }
  };

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
          <Button variant="secondary" size="sm" onClick={exportJisekibo}>実績簿Excel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !staff}>{saving ? '保存中…' : '保存する'}</Button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          実働は「勤怠管理」の出退勤から自動集計。実績時間＝実働−基準（常勤=8時間／パート=シフト予定、常勤の土日は休日勤務で実働全部）。手当＝時給×割増（時間外×1.25／休日×1.5）。
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
              <Tile label="当月 代休消化" value={h1(monthCompUsed)} />
            </div>
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
            <div className="grid sm:grid-cols-4 gap-3 items-end">
              <Field label="日付">
                <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
              </Field>
              <Field label="予定時間（h）">
                <Input type="number" min={0} step={0.5} value={fHours} onChange={e => setFHours(e.target.value)} />
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
                      <Td className="whitespace-nowrap text-gray-500">{r.appliedHours}h</Td>
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
                          : r.disposition === 'comp' ? <span className="text-gray-600">代休 {h1(c.result)}</span>
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
