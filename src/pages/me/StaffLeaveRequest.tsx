import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { getMyLeave, getMyProfile, addMyLeaveRequest, computeLeaveBalance, todayStr } from '../../api/data';
import {
  LEAVE_HOURS_PER_DAY, hoursBetween, currentFiscalYear, fiscalYearLabel,
  SPECIAL_LEAVE_TYPES, specialLeaveDef, specialLeaveOptionLabel, specialLeaveUsedDays, specialLeaveAnnualDays,
  subReasonsFor, subReasonLabel, leaveTypeLabel, canUseSpecialLeave, EMPLOYMENT_TYPE_LABELS,
} from '../../utils/constants';
import type { LeaveRecord, RequestStatus, LeaveType, Staff } from '../../types';

type LeaveUnit = 'day' | 'hour';
const STATUS_LABEL: Record<RequestStatus, string> = { requested: '申請中', approved: '承認済', rejected: '却下' };
const STATUS_COLOR: Record<RequestStatus, 'yellow' | 'green' | 'red'> = { requested: 'yellow', approved: 'green', rejected: 'red' };

export default function StaffLeaveRequest() {
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [me, setMe] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [leaveType, setLeaveType] = useState<LeaveType>('paid');
  const [subReason, setSubReason] = useState('');
  const [unit, setUnit] = useState<LeaveUnit>('day');
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState('1');       // 日単位の日数
  const [start, setStart] = useState('08:30');     // 時間単位の開始
  const [end, setEnd] = useState('12:00');         // 時間単位の終了
  const [note, setNote] = useState('');
  const hourAmt = hoursBetween(start, end);        // 時間単位の取得時間

  // 特別休暇（第24〜30条）は常勤職員のみ。それ以外は年次有給休暇だけ申請できる
  const specialOk = me ? canUseSpecialLeave(me) : true;

  const summary = useMemo(() => computeLeaveBalance(records), [records]);
  const pending = records.filter(r => r.status === 'requested');

  const fy = currentFiscalYear();
  const def = specialLeaveDef(leaveType);              // 特別休暇の定義（年次有給のときは undefined）
  const isPaid = leaveType === 'paid';
  // 年度あたりの上限日数。子の看護等休暇は対象の子の人数で 5日／10日 に分かれる
  const annualDays = def ? specialLeaveAnnualDays(def, me) : 0;
  const usedDays = useMemo(
    () => (def && annualDays > 0 ? specialLeaveUsedDays(records, def.id, fy) : 0),
    [records, def, annualDays, fy]
  );
  const remainDays = annualDays > 0 ? Math.round((annualDays - usedDays) * 100) / 100 : 0;
  // 事由の選択が要る休暇（慶弔休暇・子の看護等休暇）
  const reasons = subReasonsFor(leaveType);
  const reason = reasons.find(r => r.id === subReason);

  // 種類を変えたら、その種類で使える単位に合わせる
  const changeType = (id: LeaveType) => {
    setLeaveType(id);
    const d = specialLeaveDef(id);
    if (d?.unit === 'hour') setUnit('hour');
    else if (d?.unit === 'day') setUnit('day');
    // 事由が要る休暇は先頭の事由を選び、日数が決まっている事由ならその日数を入れる
    const list = subReasonsFor(id);
    setSubReason(list.length ? list[0].id : '');
    if (list[0]?.days) setAmount(String(list[0].days));
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMyLeave().then(r => { if (alive) { setRecords(r); setLoading(false); } });
    return () => { alive = false; };
  }, [version]);

  // 自分の雇用区分（特別休暇を出すかの判定に使う。ホーム画面のキャッシュがあれば即返る）
  useEffect(() => {
    let alive = true;
    getMyProfile().then(s => {
      if (!alive || !s) return;
      setMe(s);
      if (!canUseSpecialLeave(s)) { setLeaveType('paid'); setUnit('day'); }
    });
    return () => { alive = false; };
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = unit === 'hour' ? hourAmt : Number(amount);
    if (!v || v <= 0) {
      setError(unit === 'hour' ? '終了は開始より後の時刻にしてください' : '日数を入力してください');
      return;
    }
    if (isPaid) {
      // 年次有給は残数を超えられない
      const useHours = unit === 'hour' ? v : v * LEAVE_HOURS_PER_DAY;
      if (useHours > summary.balanceHours) {
        setError(`残（${summary.balanceDays}日 / ${summary.balanceHours}h）を超えています`);
        return;
      }
    } else if (def && annualDays > 0) {
      // 年間の上限がある特別休暇は残日数を超えられない
      const useDays = unit === 'hour' ? v / LEAVE_HOURS_PER_DAY : v;
      if (useDays > remainDays) {
        setError(`${def.name}の今年度の残（${remainDays}日 / ${annualDays}日）を超えています`);
        return;
      }
    }
    if (!isPaid && !specialOk) {
      setError('特別休暇は常勤職員のみに付与されます'); return;
    }
    setSaving(true); setError(''); setMessage('');
    try {
      await addMyLeaveRequest({
        date, days: unit === 'day' ? v : 0, hours: unit === 'hour' ? v : 0, note,
        startTime: unit === 'hour' ? start : '', endTime: unit === 'hour' ? end : '',
        leaveType, subReason: def?.needsSubReason ? subReason : '',
      });
      setMessage(`${leaveTypeLabel(leaveType)}を申請しました。事務局の承認をお待ちください。`);
      setNote(''); setAmount('1');
      setVersion(x => x + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally { setSaving(false); }
  };

  return (
    <PageContainer title="休暇の申請">
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      {/* 残（年次有給は付与ベース、特別休暇は年度の上限ベース） */}
      {isPaid ? (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Tile label="付与" value={`${summary.grantedDays}日`} sub={`${summary.grantedHours}h`} />
          <Tile label="取得(承認済)" value={`${summary.usedDays}日`} sub={`${summary.usedHours}h`} />
          <Tile label="残（1日=7.5h）" value={`${summary.balanceDays}日`} sub={`${summary.balanceHours}h`} highlight />
        </div>
      ) : def && annualDays > 0 ? (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Tile label="今年度の上限" value={`${annualDays}日`} sub={fiscalYearLabel(fy)} />
          <Tile label="取得(承認済)" value={`${usedDays}日`} />
          <Tile label="残" value={`${remainDays}日`} highlight />
        </div>
      ) : null}

      <Card className="mb-4">
        <h2 className="font-bold text-gray-800 mb-3">申請する</h2>
        <form onSubmit={add} className="grid sm:grid-cols-6 gap-3 items-end">
          <div className="sm:col-span-2">
            <Field label="休暇の種類">
              <Select value={leaveType} onChange={e => changeType(e.target.value as LeaveType)} disabled={!specialOk}>
                <option value="paid">年次有給休暇</option>
                {specialOk && SPECIAL_LEAVE_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{specialLeaveOptionLabel(t)}</option>
                ))}
              </Select>
            </Field>
          </div>
          {reasons.length > 0 && (
            <div className="sm:col-span-4">
              <Field label="事由">
                <Select value={subReason} onChange={e => {
                  setSubReason(e.target.value);
                  const r = reasons.find(x => x.id === e.target.value);
                  if (r?.days) setAmount(String(r.days));
                }}>
                  {reasons.map(r => (
                    <option key={r.id} value={r.id}>{r.days ? `${r.name}（${r.days}日）` : r.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <Field label="取得日"><Input type="date" value={date} onChange={e => setDate(e.target.value)} required /></Field>
          <Field label="単位">
            <Select value={unit} onChange={e => setUnit(e.target.value as LeaveUnit)} disabled={!!def && def.unit !== 'both'}>
              {(!def || def.unit !== 'hour') && <option value="day">日</option>}
              {(!def || def.unit !== 'day') && <option value="hour">時間</option>}
            </Select>
          </Field>
          {unit === 'hour' ? (
            <>
              <Field label="開始"><Input type="time" value={start} onChange={e => setStart(e.target.value)} required /></Field>
              <Field label="終了"><Input type="time" value={end} onChange={e => setEnd(e.target.value)} required /></Field>
            </>
          ) : (
            <Field label="日数">
              <Input type="number" min={0.5} step={0.5} value={amount} onChange={e => setAmount(e.target.value)} required />
            </Field>
          )}
          <Field label="備考"><Input value={note} onChange={e => setNote(e.target.value)} placeholder="例: 午後半休" /></Field>
          <div className="mb-4"><Button type="submit" className="w-full" disabled={saving}>{saving ? '申請中…' : '申請する'}</Button></div>
        </form>
        <p className="text-xs text-gray-400">
          1日＝{LEAVE_HOURS_PER_DAY}時間。時間単位は開始〜終了で申請（現在: <span className="font-medium text-gray-600">{unit === 'hour' ? (hourAmt > 0 ? `${hourAmt}h` : '—') : `${amount || 0}日`}</span>）。申請は事務局の承認後に反映されます。
        </p>
        {!specialOk && me && (
          <p className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-gray-600">
            特別休暇（就業規則 第24〜31条）は常勤職員のみに付与されます。
            {EMPLOYMENT_TYPE_LABELS[me.employmentType]}の方は年次有給休暇の申請のみできます。
          </p>
        )}
        {def && (
          <div className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-gray-600">
            <span className="font-medium text-gray-800">{def.article ? def.name + '（就業規則 ' + def.article + '）' : def.name}</span>
            {!def.paid && <span className="ml-2 text-amber-700 font-medium">無給</span>}
            <p className="mt-1">{def.note}</p>
            {reason?.days && (
              <p className="mt-1">この事由の日数は <span className="font-bold text-gray-800">{reason.days}日</span> です。</p>
            )}
            {leaveType === 'childNursing' && (
              annualDays > 0
                ? <p className="mt-1">あなたの上限は <span className="font-bold text-gray-800">年{annualDays}日</span> です（対象の子 {me?.childNursingChildren}人）。</p>
                : <p className="mt-1 text-amber-700">対象となる子の人数が未設定のため、上限の判定ができません。事務局にご確認ください。</p>
            )}
          </div>
        )}
      </Card>

      {pending.length > 0 && (
        <Alert type="info">承認待ちの申請が {pending.length} 件あります。</Alert>
      )}

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead><tr><Th>日付</Th><Th>種別</Th><Th>休暇の種類</Th><Th>日数/時間</Th><Th>状態</Th><Th>備考</Th></tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <Td>{r.date}</Td>
                <Td>{r.kind === 'grant' ? <Badge color="blue">付与</Badge> : <Badge color="gray">取得</Badge>}</Td>
                <Td className="whitespace-nowrap text-xs">
                  {leaveTypeLabel(r.leaveType)}
                  {r.subReason && <span className="block text-gray-400">{subReasonLabel(r.subReason)}</span>}
                </Td>
                <Td className="whitespace-nowrap">
                  {r.hours > 0
                    ? (r.startTime && r.endTime ? <span>{r.startTime}〜{r.endTime}<span className="text-gray-400 ml-1">({r.hours}時間)</span></span> : `${r.hours}時間`)
                    : `${r.days}日`}
                </Td>
                <Td><Badge color={STATUS_COLOR[r.status || 'approved']}>{STATUS_LABEL[r.status || 'approved']}</Badge></Td>
                <Td>{r.note}</Td>
              </tr>
            ))}
            {!loading && records.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={6}>記録はまだありません</Td></tr>}
            {loading && <tr><Td className="text-center text-gray-400 py-8" colSpan={6}>読み込み中…</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </PageContainer>
  );
}

function Tile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </Card>
  );
}
