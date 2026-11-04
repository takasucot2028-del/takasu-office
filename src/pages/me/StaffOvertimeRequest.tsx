import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Field, Input, Select, Button, Table, Th, Td, Badge, Alert, SectionTitle, Note } from '../../components/UI';
import { getMyProfile, getMyOvertimePageData, addMyOvertime, addMyCompUse, addMySubstitute, todayStr } from '../../api/data';
import { WEEKDAY_LABELS, hoursBetween } from '../../utils/constants';
import { closedDayName, isClosedDay } from '../../utils/holidays';
import { CancelRequestButton } from '../../components/CancelRequestButton';
import {
  overtimeKindOf, allowanceOf, canSplitDisposition, dispositionSplitOf,
  canRequestSubstitute, sameWeek,
  OVERTIME_KIND_LABELS, OVERTIME_STATUS_LABELS, OVERTIME_DISPOSITION_LABELS,
} from '../../utils/overtime';
import type { Staff, OvertimeRecord, CompLeaveUse, ConfirmedShift, OvertimeKind, SubstituteHoliday } from '../../types';

const h1 = (n: number) => `${Math.round(n * 10) / 10}h`;

export default function StaffOvertimeRequest() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [records, setRecords] = useState<OvertimeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [date, setDate] = useState(todayStr());
  const [start, setStart] = useState('17:00');
  const [end, setEnd] = useState('19:00');
  const [reason, setReason] = useState('');
  const [wantComp, setWantComp] = useState('');   // 代休を希望する時間（空欄＝希望なし）
  const [version, setVersion] = useState(0);
  const hrs = hoursBetween(start, end);

  // 申請する日が所定労働日か休日かの判定に使う、その月の確定シフト
  const [confirmed, setConfirmed] = useState<ConfirmedShift[]>([]);
  const [kind, setKind] = useState<OvertimeKind>('overtime');

  // 振替休日の申請（第19条）
  const [substitutes, setSubstitutes] = useState<SubstituteHoliday[]>([]);
  const [sWork, setSWork] = useState(todayStr());  // 出勤する休日
  const [sOff, setSOff] = useState(todayStr());    // 代わりに休む労働日
  const [sReason, setSReason] = useState('');
  const [sSaving, setSSaving] = useState(false);

  // 代休の申請
  const [compUse, setCompUse] = useState<CompLeaveUse[]>([]);
  const [cDate, setCDate] = useState(todayStr());
  const [cStart, setCStart] = useState('08:30');
  const [cEnd, setCEnd] = useState('12:00');
  const [cNote, setCNote] = useState('');
  const [cSaving, setCSaving] = useState(false);
  const cHrs = hoursBetween(cStart, cEnd);

  const month = date.slice(0, 7);

  useEffect(() => { getMyProfile().then(setStaff); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMyOvertimePageData(month).then(d => {
      if (!alive) return;
      setRecords(d.overtime);
      setCompUse(d.compUse);
      setSubstitutes(d.substitutes);
      setConfirmed(d.confirmed);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [version, month]);

  /**
   * 申請する日の種別（就業規則 第19条）。
   * 土日・祝日・年末年始・法人指定日は休日勤務。平日はシフト表で決まるため、
   * その月のシフトが確定していればシフトのない日を休日勤務とする。
   * 常勤職員以外は休日勤務の区分を使わない（パート規則 第8条）。
   */
  const shiftDates = useMemo(
    () => new Set(confirmed.filter(c => c.date.startsWith(month)).map(c => c.date)),
    [confirmed, month]
  );
  const shiftKnown = shiftDates.size > 0;
  const canChooseHoliday = staff?.employmentType === 'fulltime';
  // 実績の一部を代休にする希望を出せるか（常勤職員のみ）
  const canSplit = staff ? canSplitDisposition(staff) : false;
  const autoKind: OvertimeKind = staff
    ? overtimeKindOf(staff, date, { hasShift: shiftDates.has(date), shiftKnown })
    : 'overtime';
  // 日付を変えたら自動判定に戻す（職員が選び直した分はそのまま残る）
  useEffect(() => { setKind(autoKind); }, [autoKind]);

  /** 自動判定の理由。職員が選び直すときの手がかりとして表示する */
  const kindReason = (() => {
    if (!canChooseHoliday) return '';
    if (isClosedDay(date)) {
      const name = closedDayName(date);
      const wd = WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];
      return `この日は休日です（${name || `${wd}曜日`}・第19条）。`;
    }
    if (!shiftKnown) return 'この月のシフトがまだ確定していないため、所定労働日として扱っています。休日に出勤した日は「休日勤務」を選んでください。';
    if (shiftDates.has(date)) return 'この日はシフトのある所定労働日です。';
    return 'この日はシフトが入っていないため、休日勤務になります。';
  })();

  // 代休残＝「代休にした時間外（承認済）」−「取得ぶん（申請中を含む）」
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const compGranted = r1(records
    .filter(r => r.status === 'approved')
    .reduce((s, r) => s + dispositionSplitOf(r).compHours, 0));
  const compTaken = r1(compUse
    .filter(r => (r.status || 'approved') !== 'rejected')
    .reduce((s, r) => s + (r.hours || 0), 0));
  const compRemain = r1(compGranted - compTaken);

  const canSubstitute = staff ? canRequestSubstitute(staff) : false;
  // 週をまたぐと、出勤した週が週40時間を超えて法定時間外の割増が出ることがある
  const sCrossWeek = !!sWork && !!sOff && !sameWeek(sWork, sOff);

  const addSubstitute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sWork || !sOff) { setError('出勤する休日と、休みにする労働日の両方を入れてください'); return; }
    if (sWork === sOff) { setError('同じ日は振り替えられません'); return; }
    if (sWork.slice(0, 7) !== sOff.slice(0, 7)) { setError('振替は同じ月の中で行ってください'); return; }
    setSSaving(true); setError(''); setMessage('');
    try {
      await addMySubstitute({ workDate: sWork, offDate: sOff, reason: sReason });
      setMessage('振替休日を申請しました。事務局の承認をお待ちください。');
      setSReason('');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally { setSSaving(false); }
  };

  const addComp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cStart || !cEnd) { setError('代休の開始・終了の時刻を入力してください'); return; }
    if (cHrs <= 0) { setError('終了は開始より後の時刻にしてください'); return; }
    if (compRemain <= 0) { setError('取得できる代休がありません'); return; }
    if (cHrs > compRemain) { setError(`取得できる代休は残り ${compRemain}時間です`); return; }
    setCSaving(true); setError(''); setMessage('');
    try {
      await addMyCompUse({ date: cDate, hours: cHrs, startTime: cStart, endTime: cEnd, note: cNote });
      setMessage('代休の取得を申請しました。事務局の承認をお待ちください。');
      setCNote('');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally { setCSaving(false); }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff) return;
    if (!start || !end) { setError('開始・終了の時刻を入力してください'); return; }
    if (hrs <= 0) { setError('終了は開始より後の時刻にしてください'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const want = Math.min(Math.max(Number(wantComp) || 0, 0), hrs);
      await addMyOvertime({
        date, appliedHours: hrs, startTime: start, endTime: end, reason, kind,
        requestedCompHours: canSplit ? want : 0,
      });
      setMessage(`${kind === 'holiday' ? '休日勤務' : '時間外'}を申請しました。事務局の承認をお待ちください。`);
      setReason('');
      setWantComp('');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally { setSaving(false); }
  };

  const statusColor = (s: OvertimeRecord['status']) => s === 'approved' ? 'green' : 'yellow';

  return (
    <PageContainer title="時間外・代休の申請">
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <Card className="mb-4">
        <SectionTitle>時間外・休日勤務を申請する</SectionTitle>
        <form onSubmit={add} className="grid sm:grid-cols-6 lg:grid-cols-7 gap-3 items-end">
          <Field label="日付">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </Field>
          {canChooseHoliday && (
            <Field label="種別">
              <Select value={kind} onChange={e => setKind(e.target.value as OvertimeKind)}>
                <option value="overtime">時間外（所定労働日）</option>
                <option value="holiday">休日勤務</option>
              </Select>
            </Field>
          )}
          <Field label="開始">
            <Input type="time" value={start} onChange={e => setStart(e.target.value)} required />
          </Field>
          <Field label="終了">
            <Input type="time" value={end} onChange={e => setEnd(e.target.value)} required />
          </Field>
          {canSplit && (
            <Field label="代休希望（任意）">
              <Input
                type="number" min={0} max={hrs > 0 ? hrs : undefined} step={0.25}
                value={wantComp} onChange={e => setWantComp(e.target.value)}
                placeholder="例: 5.5"
              />
            </Field>
          )}
          <div className={canChooseHoliday || canSplit ? '' : 'sm:col-span-2'}>
            <Field label="事由">
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="例: イベント準備" />
            </Field>
          </div>
          <div className="mb-4"><Button type="submit" size="lg" className="w-full" disabled={saving || !staff}>{saving ? '申請中…' : '申請する'}</Button></div>
        </form>
        {canChooseHoliday && kindReason && (
          <p className="text-xs text-ink-mute mb-1">
            <span className={`inline-block mr-1 font-medium ${kind === 'holiday' ? 'text-alert' : 'text-caution'}`}>
              {kind === 'holiday' ? '休日勤務' : '時間外'}
            </span>
            {kindReason}
            {kind !== autoKind && <span className="text-caution">（自動判定の「{autoKind === 'holiday' ? '休日勤務' : '時間外'}」から変更しています）</span>}
          </p>
        )}
        <p className="text-xs text-ink-mute">
          申請時間 = 終了 − 開始（現在: <span className="num font-medium text-ink">{hrs > 0 ? `${hrs}h` : '—'}</span>）。
          実績時間・種別・手当/代休は、勤務後に事務局が勤怠とシフト表をもとに確定します。
          {canSplit && '「代休希望」は、申請した時間のうち代休にしてほしい時間です（例: 7.5時間のうち5.5時間）。残りは手当になります。希望どおりになるとは限りません。'}
          {!canChooseHoliday && 'パート職員は休日勤務の区分を使いません（パート規則 第8条）。8:30より前・21:30より後の勤務も、この画面から申請してください。'}
        </p>
      </Card>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead>
            <tr><Th>日付</Th><Th>種別</Th><Th numeric>申請</Th><Th>状態</Th><Th numeric>実績</Th><Th>処理</Th><Th numeric>金額</Th><Th></Th></tr>
          </thead>
          <tbody>
            {records.map(r => {
              const wd = new Date(`${r.date}T00:00:00`).getDay();
              const k = r.kind || (staff ? overtimeKindOf(staff, r.date) : 'overtime');
              const approved = r.status === 'approved';
              return (
                <tr key={r.id}>
                  <Td className="num whitespace-nowrap">{Number(r.date.slice(5, 7))}/{Number(r.date.slice(8))}
                    <span className="ml-1 text-xs text-ink-mute">({WEEKDAY_LABELS[wd]})</span>
                  </Td>
                  <Td><Badge color={k === 'holiday' ? 'red' : 'yellow'}>{OVERTIME_KIND_LABELS[k]}</Badge></Td>
                  <Td numeric className="whitespace-nowrap text-ink-mute">
                    {r.startTime && r.endTime ? <span>{r.startTime}〜{r.endTime}<span className="text-ink-mute ml-1">({r.appliedHours}h)</span></span> : `${r.appliedHours}h`}
                  </Td>
                  <Td><Badge color={statusColor(r.status)}>{OVERTIME_STATUS_LABELS[r.status === 'approved' ? 'approved' : 'applied']}</Badge></Td>
                  <Td numeric className="whitespace-nowrap">{approved ? h1(r.resultHours || 0) : '—'}</Td>
                  <Td className="whitespace-nowrap">
                    {approved && r.disposition ? (
                      <>
                        {OVERTIME_DISPOSITION_LABELS[r.disposition]}
                        {r.disposition === 'split' && (
                          <span className="num block text-xs text-ink-mute">
                            代休 {h1(dispositionSplitOf(r).compHours)}／手当 {h1(dispositionSplitOf(r).allowanceHours)}
                          </span>
                        )}
                      </>
                    ) : (r.requestedCompHours || 0) > 0
                      ? <span className="num text-xs text-info">代休{h1(r.requestedCompHours || 0)}を希望</span>
                      : '—'}
                  </Td>
                  <Td numeric className="whitespace-nowrap">{(() => {
                    if (!approved || !staff) return '—';
                    const h = dispositionSplitOf(r).allowanceHours;
                    return h > 0 ? `¥${allowanceOf(h, staff.hourlyWage || 0, k).toLocaleString()}` : '—';
                  })()}</Td>
                  <Td className="whitespace-nowrap">
                    {/* 承認前のものだけ取り消せる */}
                    {!approved && (
                      <CancelRequestButton
                        kind="overtime" id={r.id} what="時間外・休日勤務の申請"
                        onCancelled={() => { setMessage('時間外・休日勤務の申請を取り消しました'); setError(''); setVersion(v => v + 1); }}
                        onError={msg => { setError(msg); setMessage(''); }}
                      />
                    )}
                  </Td>
                </tr>
              );
            })}
            {!loading && records.length === 0 && <tr><Td className="text-center text-ink-mute py-8" colSpan={8}>申請はまだありません</Td></tr>}
            {loading && <tr><Td className="text-center text-ink-mute py-8" colSpan={8}>読み込み中…</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {/* 振替休日の申請（第19条） */}
      {canSubstitute && (
        <>
          <Card className="mt-6">
            <SectionTitle note="休日に出勤する前に、その休日と別の労働日を入れ替えます。入れ替えると出勤する日は労働日になるので、休日勤務の割増はつかず通常の給与になります（就業規則 第19条）。振替は同じ月の中で行ってください。">
              振替休日を申請する
            </SectionTitle>
            <form onSubmit={addSubstitute} className="grid sm:grid-cols-4 gap-3 items-end">
              <Field label="出勤する休日">
                <Input type="date" value={sWork} onChange={e => setSWork(e.target.value)} required />
              </Field>
              <Field label="代わりに休む労働日">
                <Input type="date" value={sOff} onChange={e => setSOff(e.target.value)} required />
              </Field>
              <Field label="事由">
                <Input value={sReason} onChange={e => setSReason(e.target.value)} placeholder="例: 大会運営" />
              </Field>
              <div className="mb-4">
                <Button type="submit" size="lg" className="w-full" disabled={sSaving || !staff}>
                  {sSaving ? '申請中…' : '申請する'}
                </Button>
              </div>
            </form>
            {sCrossWeek && (
              <Note tone="caution">
                出勤する日と休む日が別の週です。週の労働時間が40時間を超えると、法定時間外の割増（×1.25）が発生することがあります。同じ週の中で振り替えられないか確認してください。
              </Note>
            )}
          </Card>

          <Card className="p-0 overflow-x-auto mt-4">
            <Table>
              <thead>
                <tr><Th>出勤する休日</Th><Th>休む労働日</Th><Th>事由</Th><Th>状態</Th><Th></Th></tr>
              </thead>
              <tbody>
                {substitutes.map(r => (
                  <tr key={r.id}>
                    <Td className="num whitespace-nowrap">{r.workDate}</Td>
                    <Td className="num whitespace-nowrap">{r.offDate}</Td>
                    <Td className="text-xs text-ink-mute">{r.reason}</Td>
                    <Td>
                      <Badge color={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'yellow'}>
                        {r.status === 'approved' ? '承認済' : r.status === 'rejected' ? '却下' : '申請中'}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {r.status === 'requested' && (
                        <CancelRequestButton
                          kind="substitute" id={r.id} what="振替休日の申請"
                          onCancelled={() => { setMessage('振替休日の申請を取り消しました'); setError(''); setVersion(v => v + 1); }}
                          onError={msg => { setError(msg); setMessage(''); }}
                        />
                      )}
                    </Td>
                  </tr>
                ))}
                {!loading && substitutes.length === 0 && (
                  <tr><Td className="text-center text-ink-mute py-8" colSpan={5}>振替休日の申請はまだありません</Td></tr>
                )}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {/* 代休の取得申請 */}
      <Card className="mt-6">
        <SectionTitle note={
          <>
            <span className="num">
              代休にした時間外 {h1(compGranted)} − 取得ぶん（申請中を含む）{h1(compTaken)} ＝
              <span className="font-bold text-pine"> 残 {h1(compRemain)}</span>
            </span>
            <span className="block mt-0.5">
              終日休む場合は所定の勤務時間帯を入力してください。代休は、勤務した日の属する賃金計算期間の翌月末日までに取得してください（就業規則 第21条3項）。
            </span>
          </>
        }>代休の取得を申請する</SectionTitle>
        <form onSubmit={addComp} className="grid sm:grid-cols-5 gap-3 items-end">
          <Field label="取得日">
            <Input type="date" value={cDate} onChange={e => setCDate(e.target.value)} required />
          </Field>
          <Field label="開始">
            <Input type="time" value={cStart} onChange={e => setCStart(e.target.value)} required />
          </Field>
          <Field label="終了">
            <Input type="time" value={cEnd} onChange={e => setCEnd(e.target.value)} required />
          </Field>
          <Field label="備考">
            <Input value={cNote} onChange={e => setCNote(e.target.value)} placeholder="例: 午前のみ" />
          </Field>
          <div className="mb-4">
            <Button type="submit" size="lg" className="w-full" disabled={cSaving || !staff || compRemain <= 0}>
              {cSaving ? '申請中…' : '申請する'}
            </Button>
          </div>
        </form>
        <p className="text-xs text-ink-mute">
          取得時間 = 終了 − 開始（現在: <span className="num font-medium text-ink">{cHrs > 0 ? `${cHrs}h` : '—'}</span>）。
          {compRemain <= 0 && <span className="text-caution">取得できる代休がありません（時間外の処理が「代休」で承認されると増えます）。</span>}
        </p>
      </Card>

      <Card className="p-0 overflow-x-auto mt-4">
        <Table>
          <thead>
            <tr><Th>取得日</Th><Th numeric>時間帯</Th><Th numeric>時間</Th><Th>状態</Th><Th>備考</Th><Th></Th></tr>
          </thead>
          <tbody>
            {compUse.map(r => {
              const st = r.status || 'approved';
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{r.date}</Td>
                  <Td numeric className="whitespace-nowrap text-ink-mute">
                    {r.startTime && r.endTime ? `${r.startTime}〜${r.endTime}` : <span className="text-ink-mute">—</span>}
                  </Td>
                  <Td numeric className="whitespace-nowrap">{h1(r.hours || 0)}</Td>
                  <Td>
                    <Badge color={st === 'approved' ? 'green' : st === 'rejected' ? 'red' : 'yellow'}>
                      {st === 'approved' ? '承認済' : st === 'rejected' ? '却下' : '申請中'}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-ink-mute">{r.note}</Td>
                  <Td className="whitespace-nowrap">
                    {/* 事務局が登録したもの（status 未設定＝承認済）は取り消せない */}
                    {st === 'requested' && (
                      <CancelRequestButton
                        kind="comp" id={r.id} what="代休の取得申請"
                        onCancelled={() => { setMessage('代休の取得申請を取り消しました'); setError(''); setVersion(v => v + 1); }}
                        onError={msg => { setError(msg); setMessage(''); }}
                      />
                    )}
                  </Td>
                </tr>
              );
            })}
            {!loading && compUse.length === 0 && <tr><Td className="text-center text-ink-mute py-8" colSpan={6}>代休の取得はまだありません</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </PageContainer>
  );
}
