import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { listStaff, listLeave, addLeave, deleteLeave, setLeaveStatus, computeLeaveBalance, genId, todayStr } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS, LEAVE_HOURS_PER_DAY , canUseSpecialLeave, SPECIAL_LEAVE_TYPES, specialLeaveDef, specialLeaveOptionLabel, specialLeaveAnnualDays, specialLeaveUsedDays, specialLeavePaidRemain, paymentLabel, subReasonsFor, subReasonLabel, leaveTypeLabel, currentFiscalYear } from '../../utils/constants';
import {
  statutoryGrantSchedule, computeLeaveLedger, currentObligation, isProportional,
  OBLIGATION_REQUIRED_DAYS, LEAVE_EXPIRY_MONTHS,
} from '../../utils/annualLeave';
import type { LeaveKind, LeaveRecord, Staff, LeaveType } from '../../types';

type LeaveUnit = 'day' | 'hour';
/** 残の表示「X日（Yh）」 */
function balText(days: number, hours: number): string {
  return `${days}日（${hours}h）`;
}

export default function Leave() {
  const navigate = useNavigate();
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const staff = useMemo(() => allStaff.filter(s => s.status === 'active'), [allStaff]);
  const [staffId, setStaffId] = useState('');
  const selectedStaff = useMemo(() => staff.find(s => s.id === staffId) ?? null, [staff, staffId]);
  // 特別休暇（第24〜31条）は常勤職員のみ
  const specialOk = selectedStaff ? canUseSpecialLeave(selectedStaff) : false;
  const [version, setVersion] = useState(0); // 追加・削除後の再読込用

  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [kind, setKind] = useState<LeaveKind>('use');
  const [leaveType, setLeaveType] = useState<LeaveType>('paid');   // 休暇の種類（取得のみ）
  // 事由の選択が要る休暇（慶弔休暇・子の看護等休暇）
  const reasons = subReasonsFor(leaveType);
  // 有給で取得できる日数の残（病気休暇の年5日など）。超過分は無給になるだけで登録は止めない
  const typeDef = specialLeaveDef(leaveType);
  const paidRemain = typeDef?.paidDays
    ? Math.max(0, specialLeavePaidRemain(typeDef, records, currentFiscalYear()))
    : 0;
  const [subReason, setSubReason] = useState('');
  const [unit, setUnit] = useState<LeaveUnit>('day'); // 取得の単位（日/時間）
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const summary = computeLeaveBalance(records);
  const today = todayStr();
  // 2年の時効を考慮した残（法定どおり古い付与から消化する）
  const ledger = useMemo(() => computeLeaveLedger(records, today), [records, today]);
  // 法定付与のスケジュールと、まだ登録していない付与
  const schedule = useMemo(
    () => (selectedStaff ? statutoryGrantSchedule(selectedStaff, today, records) : []),
    [selectedStaff, today, records]
  );
  const missingGrants = schedule.filter(g => !g.registered);
  // 年5日取得義務の状況
  const obligation = useMemo(() => currentObligation(records, today), [records, today]);
  const d1 = (h: number) => Math.round((h / LEAVE_HOURS_PER_DAY) * 10) / 10;

  // 職員一覧を初回に読み込む
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await listStaff();
      if (!alive) return;
      setAllStaff(s);
      setStaffLoaded(true);
      const first = s.find(x => x.status === 'active');
      if (first) setStaffId(first.id);
    })();
    return () => { alive = false; };
  }, []);

  // 職員・更新のたびに有給記録を読み込む
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (!specialOk) { setLeaveType('paid'); }
  }, [specialOk]);

  useEffect(() => {
    if (!staffId) { setRecords([]); return; }
    let alive = true;
    (async () => {
      const list = await listLeave(staffId);
      if (!alive) return;
      setRecords(list);
    })();
    return () => { alive = false; };
  }, [staffId, version]);

  // 付与は日単位のみ。取得は日/時間を選べる
  const effUnit: LeaveUnit = kind === 'grant' ? 'day' : unit;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const v = Number(amount);
    if (!v || v <= 0) {
      setError(effUnit === 'hour' ? '時間は1時間単位の正の数で入力してください' : '日数は0.5日単位の正の数で入力してください');
      return;
    }
    const useHours = effUnit === 'hour' ? v : v * LEAVE_HOURS_PER_DAY;
    // 年次有給のみ残数で制限する（特別休暇は種類ごとの上限で運用）
    if (kind === 'use' && leaveType !== 'paid' && !specialOk) {
      setError('特別休暇は常勤職員のみに付与されます'); return;
    }
    const useDef = specialLeaveDef(leaveType);
    const limit = useDef ? specialLeaveAnnualDays(useDef, selectedStaff) : 0;
    if (kind === 'use' && useDef && limit > 0) {
      const fy = currentFiscalYear();
      const remain = limit - specialLeaveUsedDays(records, useDef.id, fy);
      const useDays = effUnit === 'hour' ? v / LEAVE_HOURS_PER_DAY : v;
      if (useDays > Math.round(remain * 100) / 100) {
        setError(`${useDef.name}の今年度の残（${Math.round(remain * 100) / 100}日 / ${limit}日）を超えています`);
        return;
      }
    }
    if (kind === 'use' && leaveType === 'paid' && useHours > summary.balanceHours) {
      setError(`残（${balText(summary.balanceDays, summary.balanceHours)}）を超えています`);
      return;
    }
    const rec: LeaveRecord = {
      id: genId('lv'), staffId, kind, date, note,
      days: effUnit === 'day' ? v : 0,
      hours: effUnit === 'hour' ? v : 0,
      status: 'approved', // 事務局が直接登録する分は承認済み
      leaveType: kind === 'grant' ? 'paid' : leaveType,          // 付与は年次有給のみ
      subReason: kind === 'use' && specialLeaveDef(leaveType)?.needsSubReason ? subReason : '',
    };
    setSaving(true);
    try {
      await addLeave(rec);
      setNote('');
      setAmount('1');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '有給記録の追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 未登録の法定付与をまとめて登録する
  const handleStatutoryGrant = async () => {
    if (!selectedStaff || missingGrants.length === 0) return;
    setError('');
    const lines = missingGrants.map(g => `${g.date}　勤続${g.serviceLabel}　${g.days}日`).join('\n');
    if (!confirm(`${selectedStaff.lastName} ${selectedStaff.firstName} さんに次の法定付与を登録します。\n\n${lines}\n\nよろしいですか？`)) return;
    setSaving(true);
    try {
      for (const g of missingGrants) {
        await addLeave({
          id: genId('lv'), staffId, kind: 'grant', date: g.date, days: g.days, hours: 0,
          status: 'approved', leaveType: 'paid', note: `法定付与（勤続${g.serviceLabel}）`,
        });
      }
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '法定付与の登録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この記録を削除しますか？')) return;
    try {
      await deleteLeave(id);
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '有給記録の削除に失敗しました');
    }
  };

  const changeStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await setLeaveStatus(id, status);
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '状態の更新に失敗しました');
    }
  };
  const pending = records.filter(r => r.status === 'requested');

  return (
    <PageContainer title="有給休暇管理">
      <Card className="mb-4">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Select value={staffId} onChange={e => setStaffId(e.target.value)}>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.lastName} {s.firstName}（{s.position || '役職なし'}）</option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" size="sm" disabled={!staffId}
            onClick={() => navigate(`/labor/leave/print?staffId=${staffId}`)}>PDF帳簿</Button>
        </div>
      </Card>

      {staffLoaded && staff.length === 0 && <Alert type="info">在職中の職員がいません。先に職員名簿から登録してください。</Alert>}

      {staffId && (
        <>
          {/* 残数サマリー（1日=7.5時間で換算） */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <SummaryTile label="付与合計" value={`${summary.grantedDays}日`} sub={`${summary.grantedHours}h`} />
            <SummaryTile label="取得合計" value={`${summary.usedDays}日`} sub={`${summary.usedHours}h`} />
            <SummaryTile label={`時効消滅（${LEAVE_EXPIRY_MONTHS / 12}年）`} value={`${d1(ledger.expiredHours)}日`} sub={`${ledger.expiredHours}h`} />
            <SummaryTile label="有効な残（1日=7.5h）" value={`${d1(ledger.balanceHours)}日`} sub={`${ledger.balanceHours}h`} highlight />
          </div>
          {ledger.overusedHours > 0 && (
            <Alert type="error">
              付与を {d1(ledger.overusedHours)}日（{ledger.overusedHours}h）超えて取得している記録があります。付与記録の登録漏れがないか確認してください。
            </Alert>
          )}

          {/* 年5日取得義務（労基法第39条第7項） */}
          {obligation && (
            <Card className={`mb-4 ${obligation.overdue ? 'border-red-300' : obligation.achieved ? '' : 'border-yellow-300'}`}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="font-bold text-gray-800">年5日取得義務</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    年10日以上付与された職員は、基準日から1年以内に5日取得させる必要があります（労基法第39条第7項）
                  </p>
                  <p className="text-sm mt-1">
                    基準日 {obligation.baseDate} 〜 期限 <span className="font-medium">{obligation.deadline}</span>
                    <span className="mx-2 text-gray-300">|</span>
                    取得 <span className="font-bold">{obligation.taken}日</span> / {OBLIGATION_REQUIRED_DAYS}日
                  </p>
                </div>
                {obligation.achieved ? (
                  <Badge color="green">達成</Badge>
                ) : obligation.overdue ? (
                  <Badge color="red">期限超過・あと{obligation.remaining}日</Badge>
                ) : (
                  <Badge color="yellow">あと{obligation.remaining}日</Badge>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">時間単位で取得した年休は、この5日には算入できません。</p>
            </Card>
          )}

          {/* 承認待ちの休暇申請 */}
          {pending.length > 0 && (
            <Card className="mb-4 border-yellow-300">
              <h2 className="font-bold text-gray-800 mb-3">承認待ちの休暇申請（{pending.length}件）</h2>
              <div className="space-y-2">
                {pending.map(r => (
                  <div key={r.id} className="flex items-center gap-3 flex-wrap text-sm">
                    <span className="font-medium">{r.date}</span>
                    <Badge color={(r.leaveType || 'paid') === 'paid' ? 'gray' : 'blue'}>{leaveTypeLabel(r.leaveType)}</Badge>
                    <span>{r.hours > 0 ? (r.startTime && r.endTime ? `${r.startTime}〜${r.endTime}（${r.hours}時間）` : `${r.hours}時間`) : `${r.days}日`}</span>
                    {r.subReason && <span className="text-xs text-gray-500">{subReasonLabel(r.subReason)}</span>}
                    {r.note && <span className="text-xs text-gray-500">{r.note}</span>}
                    <div className="flex-1" />
                    <Button size="sm" onClick={() => changeStatus(r.id, 'approved')}>承認</Button>
                    <Button size="sm" variant="secondary" onClick={() => changeStatus(r.id, 'rejected')}>却下</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 法定付与（労基法第39条） */}
          {selectedStaff && (
            <Card className={`mb-4 ${missingGrants.length > 0 ? 'border-yellow-300' : ''}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h2 className="font-bold text-gray-800">法定付与</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    勤続6か月で最初の付与、以降1年ごと。
                    {isProportional(selectedStaff)
                      ? `週${selectedStaff.weeklyWorkDays}日勤務のため比例付与で計算しています。`
                      : '通常付与（10日→11日→12日→14日→16日→18日→20日）で計算しています。'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {EMPLOYMENT_TYPE_LABELS[selectedStaff.employmentType]}・入職日 {selectedStaff.hireDate || '未設定'}
                    {selectedStaff.employmentType !== 'fulltime' && !selectedStaff.weeklyWorkDays && (
                      <span className="text-amber-700">　※週の所定労働日数が未設定のため通常付与で計算しています（職員名簿で設定してください）</span>
                    )}
                  </p>
                </div>
                <Button variant="secondary" onClick={handleStatutoryGrant} disabled={saving || missingGrants.length === 0}>
                  {missingGrants.length > 0 ? `未登録の付与 ${missingGrants.length}件を登録` : '未登録の付与はありません'}
                </Button>
              </div>
              {!selectedStaff.hireDate ? (
                <p className="text-sm text-gray-400 mt-3">入職日が未設定のため付与日を計算できません。</p>
              ) : schedule.length === 0 ? (
                <p className="text-sm text-gray-400 mt-3">まだ最初の付与日（勤続6か月）に達していません。</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {schedule.map(g => (
                    <span key={g.date}
                      className={`text-xs px-2 py-1 rounded border ${g.registered
                        ? 'bg-gray-50 border-gray-200 text-gray-500'
                        : 'bg-yellow-50 border-yellow-300 text-yellow-800 font-medium'}`}>
                      {g.date}　勤続{g.serviceLabel}　{g.days}日{g.registered ? '' : '（未登録）'}
                    </span>
                  ))}
                </div>
              )}
              {ledger.lots.length > 0 && (() => {
                // 有効な付与だけを並べ、時効を過ぎたものは件数だけ示す
                const live = ledger.lots.filter(l => l.expiry > today);
                const gone = ledger.lots.filter(l => l.expiry <= today && l.expiredHours > 0);
                return (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="text-xs font-medium text-gray-700 mb-1">有効な付与の残</p>
                    {live.length === 0 ? (
                      <p className="text-xs text-gray-400">有効な付与はありません。</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {live.map(l => (
                          <span key={l.date} className="text-xs px-2 py-1 rounded border bg-emerald-50 border-emerald-200 text-emerald-800">
                            {l.date}付与　残{d1(l.remainHours)}日　<span className="text-emerald-600">{l.expiry}まで</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {gone.length > 0 && (
                      <p className="text-xs text-gray-400 mt-2">
                        時効で消滅した付与 {gone.length}件（合計 {d1(gone.reduce((s, l) => s + l.expiredHours, 0))}日）
                      </p>
                    )}
                  </div>
                );
              })()}
            </Card>
          )}

          {/* 記録追加 */}
          <Card className="mb-4">
            <h2 className="font-bold text-gray-800 mb-4">記録の追加</h2>
            {error && <Alert type="error">{error}</Alert>}
            <form onSubmit={handleAdd} className="grid sm:grid-cols-6 gap-3 items-end">
              {kind === 'use' && (
                <Field label="休暇の種類">
                  <Select value={leaveType} onChange={e => {
                    const id = e.target.value as LeaveType;
                    setLeaveType(id);
                    const d = specialLeaveDef(id);
                    if (d?.unit === 'hour') setUnit('hour'); else if (d?.unit === 'day') setUnit('day');
                    const list = subReasonsFor(id);
                    setSubReason(list.length ? list[0].id : '');
                    if (list[0]?.days) setAmount(String(list[0].days));
                  }}>
                    <option value="paid">年次有給休暇</option>
                    {specialOk && SPECIAL_LEAVE_TYPES.map(t => <option key={t.id} value={t.id}>{specialLeaveOptionLabel(t)}</option>)}
                  </Select>
                  {!specialOk && selectedStaff && (
                    <p className="text-xs text-gray-400 -mt-3 mb-4">
                      特別休暇は常勤職員のみです（この職員は{EMPLOYMENT_TYPE_LABELS[selectedStaff.employmentType]}）。
                    </p>
                  )}
                  {specialOk && typeDef && (
                    <p className="text-xs text-gray-500 -mt-3 mb-4">
                      {paymentLabel(typeDef)}
                      {typeDef.paidDays ? `（今年度の有給分の残 ${paidRemain}日。超えた分は無給）` : ''}
                    </p>
                  )}
                </Field>
              )}
              {kind === 'use' && reasons.length > 0 && (
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
              )}
              <Field label="種別">
                <Select value={kind} onChange={e => setKind(e.target.value as LeaveKind)}>
                  <option value="use">取得</option>
                  <option value="grant">付与</option>
                </Select>
              </Field>
              <Field label={kind === 'grant' ? '付与日' : '取得日'}>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} required />
              </Field>
              <Field label="単位">
                <Select value={effUnit} onChange={e => setUnit(e.target.value as LeaveUnit)} disabled={kind === 'grant'}>
                  <option value="day">日</option>
                  <option value="hour">時間</option>
                </Select>
              </Field>
              <Field label={effUnit === 'hour' ? '時間' : '日数'}>
                <Input type="number" min={effUnit === 'hour' ? 1 : 0.5} step={effUnit === 'hour' ? 1 : 0.5}
                  value={amount} onChange={e => setAmount(e.target.value)} required />
              </Field>
              <Field label="備考">
                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="例: 午後半休" />
              </Field>
              <div className="mb-4">
                <Button type="submit" className="w-full" disabled={saving}>{saving ? '追加中…' : '追加'}</Button>
              </div>
            </form>
            {kind === 'use' && <p className="text-xs text-gray-400 mt-1">1日＝{LEAVE_HOURS_PER_DAY}時間で残から差し引きます。時間単位は1時間から取得できます。</p>}
          </Card>

          {/* 履歴 */}
          <Card className="p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>日付</Th>
                  <Th>種別</Th>
                  <Th>休暇の種類</Th>
                  <Th>日数/時間</Th>
                  <Th>状態</Th>
                  <Th>備考</Th>
                  <Th className="w-16"></Th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const st = r.status || 'approved';
                  return (
                  <tr key={r.id}>
                    <Td>{r.date}</Td>
                    <Td>
                      <Badge color={r.kind === 'grant' ? 'blue' : 'green'}>
                        {r.kind === 'grant' ? '付与' : '取得'}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {r.kind === 'grant' ? '—' : leaveTypeLabel(r.leaveType)}
                      {r.subReason && <span className="block text-gray-400">{subReasonLabel(r.subReason)}</span>}
                    </Td>
                    <Td className="whitespace-nowrap">{r.hours > 0 ? (r.startTime && r.endTime ? `${r.startTime}〜${r.endTime}（${r.hours}時間）` : `${r.hours}時間`) : `${r.days}日`}</Td>
                    <Td>
                      <Badge color={st === 'approved' ? 'green' : st === 'requested' ? 'yellow' : 'red'}>
                        {st === 'approved' ? '承認済' : st === 'requested' ? '申請中' : '却下'}
                      </Badge>
                    </Td>
                    <Td>{r.note}</Td>
                    <Td>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)}>削除</Button>
                    </Td>
                  </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr>
                    <Td className="text-center text-gray-400 py-8" colSpan={6}>
                      記録がありません
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </PageContainer>
  );
}

function SummaryTile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </Card>
  );
}
