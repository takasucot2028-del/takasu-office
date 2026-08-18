// 年度切替（前年度予算のコピー・年度末アーカイブ）
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Select, Field, Button, Alert, Table, Th, Td } from '../../components/UI';
import { listBudgets, saveBudgets, getYearArchive, genId } from '../../api/data';
import type { YearArchive } from '../../api/data';
import {
  currentFiscalYear, fiscalYearLabel, divisionLabel,
  EMPLOYMENT_TYPE_LABELS, DAY_TYPE_LABELS, leaveTypeLabel, subReasonLabel,
} from '../../utils/constants';
import { OVERTIME_KIND_LABELS, OVERTIME_DISPOSITION_LABELS } from '../../utils/overtime';
import type { Budget } from '../../types';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default function YearEnd() {
  const thisFy = currentFiscalYear();
  const years = [thisFy + 1, thisFy, thisFy - 1, thisFy - 2, thisFy - 3];

  // --- 予算コピー ---
  const [fromFy, setFromFy] = useState(thisFy - 1);
  const [toFy, setToFy] = useState(thisFy);
  const [source, setSource] = useState<Budget[] | null>(null);
  const [target, setTarget] = useState<Budget[] | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  const [copyErr, setCopyErr] = useState('');

  // --- アーカイブ ---
  const [archiveFy, setArchiveFy] = useState(thisFy - 1);
  const [exporting, setExporting] = useState(false);
  const [archiveMsg, setArchiveMsg] = useState('');
  const [archiveErr, setArchiveErr] = useState('');

  useEffect(() => {
    let alive = true;
    setSource(null); setTarget(null); setCopyMsg('');
    (async () => {
      const [a, b] = await Promise.all([listBudgets(fromFy), listBudgets(toFy)]);
      if (!alive) return;
      setSource(a); setTarget(b);
    })();
    return () => { alive = false; };
  }, [fromFy, toFy]);

  const copyBudgets = async (keepAmount: boolean) => {
    if (!source || source.length === 0) return;
    const label = keepAmount ? '予算額もそのまま' : '予算額は0で';
    if (!confirm(
      `${fiscalYearLabel(fromFy)} の予算 ${source.length}件を ${fiscalYearLabel(toFy)} に${label}コピーします。\n` +
      `${fiscalYearLabel(toFy)} の既存の予算 ${target?.length ?? 0}件はそのまま残り、コピー分が追加されます。\n\nよろしいですか？`
    )) return;
    setCopying(true); setCopyErr(''); setCopyMsg('');
    try {
      const copied: Budget[] = source.map(b => ({
        ...b, id: genId('bg'), fiscalYear: toFy, amount: keepAmount ? b.amount : 0,
      }));
      await saveBudgets(toFy, [...(target ?? []), ...copied]);
      const next = await listBudgets(toFy);
      setTarget(next);
      setCopyMsg(`${fiscalYearLabel(toFy)} に ${copied.length}件をコピーしました。会計管理で金額を調整してください。`);
    } catch (err) {
      setCopyErr(err instanceof Error ? err.message : 'コピーに失敗しました');
    } finally {
      setCopying(false);
    }
  };

  const exportArchive = async () => {
    setExporting(true); setArchiveErr(''); setArchiveMsg('');
    try {
      const a: YearArchive = await getYearArchive(archiveFy);
      const nameOf = new Map(a.staff.map(s => [s.id, `${s.lastName} ${s.firstName}`]));
      const wb = XLSX.utils.book_new();
      const add = (sheet: string, rows: (string | number)[][]) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
      };

      add('職員', [
        ['職員番号', '氏名', 'フリガナ', '雇用区分', '役職・担当', '入職日', '退職日', '在職状況', '時給'],
        ...a.staff.map(s => [
          s.employeeNumber, `${s.lastName} ${s.firstName}`, `${s.lastKana} ${s.firstKana}`,
          EMPLOYMENT_TYPE_LABELS[s.employmentType], s.position, s.hireDate, s.retireDate,
          s.status === 'active' ? '在職' : '退職', s.hourlyWage || '',
        ]),
      ]);
      add('勤怠', [
        ['日付', '職員', '区分', '出勤', '退勤', '休憩開始', '休憩終了', '休憩(分)', '備考'],
        ...a.attendance.sort((x, y) => x.date.localeCompare(y.date)).map(r => [
          r.date, nameOf.get(r.staffId) || r.staffId, DAY_TYPE_LABELS[r.dayType],
          r.startTime, r.endTime, r.breakStart || '', r.breakEnd || '', r.breakMinutes || 0, r.note,
        ]),
      ]);
      add('確定シフト', [
        ['日付', '職員', '勤務場所', '区分ID', '備考'],
        ...a.confirmed.sort((x, y) => x.date.localeCompare(y.date)).map(r => [
          r.date, nameOf.get(r.staffId) || r.staffId, r.location, r.patternId, r.note,
        ]),
      ]);
      add('時間外', [
        ['日付', '職員', '種別', '申請時間', '開始', '終了', '事由', '状態', '実績時間', '処理', '備考'],
        ...a.overtime.sort((x, y) => x.date.localeCompare(y.date)).map(r => [
          r.date, nameOf.get(r.staffId) || r.staffId, OVERTIME_KIND_LABELS[r.kind],
          r.appliedHours, r.startTime || '', r.endTime || '', r.reason,
          r.status === 'approved' ? '承認済' : '申請中', r.resultHours,
          OVERTIME_DISPOSITION_LABELS[r.disposition], r.note,
        ]),
      ]);
      add('休暇', [
        ['日付', '職員', '種別', '休暇の種類', '事由', '日数', '時間', '状態', '備考'],
        ...a.leave.sort((x, y) => x.date.localeCompare(y.date)).map(r => [
          r.date, nameOf.get(r.staffId) || r.staffId, r.kind === 'grant' ? '付与' : '取得',
          leaveTypeLabel(r.leaveType), subReasonLabel(r.subReason), r.days, r.hours,
          r.status === 'requested' ? '申請中' : r.status === 'rejected' ? '却下' : '承認済', r.note,
        ]),
      ]);
      add('予算', [
        ['区分', '事業', '費目ID', '予算額', '備考'],
        ...a.budgets.map(b => [divisionLabel(b.division), b.project, b.categoryId, b.amount, b.note]),
      ]);
      add('経費', [
        ['日付', '申請者', '事業', '費目ID', '金額', '内容', '状態', '備考'],
        ...a.expenses.sort((x, y) => x.date.localeCompare(y.date)).map(e => [
          e.date, e.staffId ? (nameOf.get(e.staffId) || e.staffId) : '事務局', e.project, e.categoryId,
          e.amount, e.description,
          e.status === 'requested' ? '申請中' : e.status === 'rejected' ? '却下' : '承認済', e.note,
        ]),
      ]);
      add('変更履歴', [
        ['日時', '操作者', '権限', '対象', '操作', '内容'],
        ...a.audit.map(x => [x.at, x.actor, x.role, x.target, x.action, x.summary]),
      ]);

      XLSX.writeFile(wb, `年度アーカイブ_${archiveFy}年度.xlsx`);
      setArchiveMsg(
        `${fiscalYearLabel(archiveFy)} のデータを出力しました（勤怠${a.attendance.length}件／` +
        `シフト${a.confirmed.length}件／時間外${a.overtime.length}件／休暇${a.leave.length}件／` +
        `経費${a.expenses.length}件）。`
      );
    } catch (err) {
      setArchiveErr(err instanceof Error ? err.message : '出力に失敗しました');
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageContainer title="年度切替・年度末処理">
      {/* 予算のコピー */}
      <Card className="mb-4">
        <h2 className="font-bold text-gray-800 mb-1">前年度予算のコピー</h2>
        <p className="text-xs text-gray-500 mb-3">
          区分・事業・費目の構成をそのまま新年度に引き継ぎます。金額は据え置きか0のどちらかを選べます。
        </p>
        {copyMsg && <Alert type="success">{copyMsg}</Alert>}
        {copyErr && <Alert type="error">{copyErr}</Alert>}

        <div className="grid sm:grid-cols-4 gap-3 items-end">
          <Field label="コピー元">
            <Select value={fromFy} onChange={e => setFromFy(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{fiscalYearLabel(y)}</option>)}
            </Select>
          </Field>
          <Field label="コピー先">
            <Select value={toFy} onChange={e => setToFy(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{fiscalYearLabel(y)}</option>)}
            </Select>
          </Field>
          <div className="mb-4 sm:col-span-2 flex gap-2">
            <Button variant="secondary" onClick={() => copyBudgets(true)}
              disabled={copying || fromFy === toFy || !source || source.length === 0}>
              金額も含めてコピー
            </Button>
            <Button variant="secondary" onClick={() => copyBudgets(false)}
              disabled={copying || fromFy === toFy || !source || source.length === 0}>
              構成だけコピー（金額0）
            </Button>
          </div>
        </div>

        {fromFy === toFy ? (
          <Alert type="info">コピー元とコピー先に同じ年度は指定できません。</Alert>
        ) : source === null ? (
          <p className="text-sm text-gray-400">読み込み中…</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-2">
              {fiscalYearLabel(fromFy)}: <span className="font-bold">{source.length}件</span>
              （合計 {yen(source.reduce((s, b) => s + (Number(b.amount) || 0), 0))}）
              <span className="mx-2 text-gray-300">→</span>
              {fiscalYearLabel(toFy)}: <span className="font-bold">{target?.length ?? 0}件</span>
            </p>
            {(target?.length ?? 0) > 0 && (
              <Alert type="info">
                コピー先には既に予算が {target?.length}件あります。コピーすると<b>追加</b>されます（重複にご注意ください）。
              </Alert>
            )}
            {source.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <thead><tr><Th>区分</Th><Th>事業</Th><Th>費目ID</Th><Th>予算額</Th></tr></thead>
                  <tbody>
                    {source.slice(0, 10).map(b => (
                      <tr key={b.id}>
                        <Td className="text-xs">{divisionLabel(b.division)}</Td>
                        <Td>{b.project}</Td>
                        <Td className="text-xs text-gray-500">{b.categoryId}</Td>
                        <Td className="text-right">{yen(Number(b.amount) || 0)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {source.length > 10 && <p className="text-xs text-gray-400 p-2">ほか {source.length - 10}件</p>}
              </div>
            )}
          </>
        )}
      </Card>

      {/* 年度末アーカイブ */}
      <Card>
        <h2 className="font-bold text-gray-800 mb-1">年度末アーカイブ</h2>
        <p className="text-xs text-gray-500 mb-3">
          指定年度の職員・勤怠・シフト・時間外・休暇・予算・経費・変更履歴を1つのExcelにまとめて保存します。
          データは削除しません。保存義務のある記録の控えとしてお使いください。
        </p>
        {archiveMsg && <Alert type="success">{archiveMsg}</Alert>}
        {archiveErr && <Alert type="error">{archiveErr}</Alert>}
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="対象年度">
            <Select value={archiveFy} onChange={e => setArchiveFy(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{fiscalYearLabel(y)}</option>)}
            </Select>
          </Field>
          <div className="mb-4">
            <Button onClick={exportArchive} disabled={exporting}>
              {exporting ? '出力中…（少し時間がかかります）' : 'Excelで出力'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          労働者名簿・賃金台帳・出勤簿は労基法で5年間（当分の間3年間）の保存が必要です。
          年度ごとにこのファイルを保管しておくと、記録の控えになります。
        </p>
      </Card>
    </PageContainer>
  );
}
