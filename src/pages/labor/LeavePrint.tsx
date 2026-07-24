import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listStaff, listLeave, computeLeaveBalance } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS, LEAVE_HOURS_PER_DAY } from '../../utils/constants';
import type { Staff, LeaveRecord } from '../../types';

export default function LeavePrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const staffId = params.get('staffId') || '';

  const [staff, setStaff] = useState<Staff | null>(null);
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const summary = useMemo(() => computeLeaveBalance(records), [records]);

  // 印刷はA4縦（このページにいる間だけ @page を縦に上書きする）
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }';
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [all, recs] = await Promise.all([listStaff(), listLeave(staffId)]);
      if (!alive) return;
      setStaff(all.find(s => s.id === staffId) ?? null);
      setRecords(recs);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [staffId]);

  const today = new Date();
  const todayLabel = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  return (
    <div className="leave-print max-w-3xl mx-auto px-4 py-5">
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">PDFで保存（印刷）</button>
        <span className="text-xs text-gray-400">印刷ダイアログで送信先を「PDFに保存」にするとPDFになります</span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : !staff ? (
        <p className="text-sm text-gray-500">職員が見つかりません。</p>
      ) : (
        <>
          <h1 className="text-lg font-bold text-center mb-1">有給休暇管理簿</h1>
          <p className="text-xs text-gray-500 text-center mb-4">作成日 {todayLabel}（1日＝{LEAVE_HOURS_PER_DAY}時間換算）</p>

          <table className="w-full text-sm mb-4 border border-gray-400 border-collapse">
            <tbody>
              <tr>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 text-left w-28">氏名</th>
                <td className="border border-gray-400 px-2 py-1">{staff.lastName} {staff.firstName}</td>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 text-left w-28">雇用区分</th>
                <td className="border border-gray-400 px-2 py-1">{EMPLOYMENT_TYPE_LABELS[staff.employmentType]}</td>
              </tr>
              <tr>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 text-left">入職日</th>
                <td className="border border-gray-400 px-2 py-1">{staff.hireDate || '—'}</td>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 text-left">残</th>
                <td className="border border-gray-400 px-2 py-1 font-medium">{summary.balanceDays}日（{summary.balanceHours}時間）</td>
              </tr>
              <tr>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 text-left">付与合計</th>
                <td className="border border-gray-400 px-2 py-1">{summary.grantedDays}日（{summary.grantedHours}時間）</td>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 text-left">取得合計</th>
                <td className="border border-gray-400 px-2 py-1">{summary.usedDays}日（{summary.usedHours}時間）</td>
              </tr>
            </tbody>
          </table>

          <table className="w-full text-sm border border-gray-400 border-collapse" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
            <thead>
              <tr>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 w-32">日付</th>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 w-20">種別</th>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 w-24">日数/時間</th>
                <th className="border border-gray-400 bg-gray-100 px-2 py-1 text-left">備考</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}>
                  <td className="border border-gray-400 px-2 py-1 text-center">{r.date}</td>
                  <td className="border border-gray-400 px-2 py-1 text-center">{r.kind === 'grant' ? '付与' : '取得'}</td>
                  <td className="border border-gray-400 px-2 py-1 text-center">{r.hours > 0 ? `${r.hours}時間` : `${r.days}日`}</td>
                  <td className="border border-gray-400 px-2 py-1">{r.note}</td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td className="border border-gray-400 px-2 py-4 text-center text-gray-400" colSpan={4}>記録がありません</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
