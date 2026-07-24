import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listStaff, listOvertimeByMonth, listCompUse, todayStr } from '../../api/data';
import { WEEKDAY_LABELS } from '../../utils/constants';
import { overtimeKindOf, allowanceOf, OVERTIME_KIND_LABELS } from '../../utils/overtime';
import type { Staff, OvertimeRecord } from '../../types';

interface Sheet {
  staff: Staff;
  records: OvertimeRecord[];
  wkOt: number; hol: number; allowH: number; allowYen: number; compGrant: number; compUsed: number;
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export default function OvertimePrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const month = params.get('month') || todayStr().slice(0, 7);

  const [sheets, setSheets] = useState<Sheet[]>([]);
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
      const [ot, staff] = await Promise.all([listOvertimeByMonth(month), listStaff()]);
      if (!alive) return;
      const ids = Array.from(new Set(ot.map(r => r.staffId)));
      const targets = ids.map(id => staff.find(s => s.id === id)).filter((s): s is Staff => !!s);
      const built: Sheet[] = [];
      for (const s of targets) {
        const records = ot.filter(r => r.staffId === s.id && r.status === 'approved')
          .sort((a, b) => a.date.localeCompare(b.date));
        if (records.length === 0) continue;
        const kindOf = (r: OvertimeRecord) => r.kind || overtimeKindOf(s, r.date);
        const uses = (await listCompUse(s.id)).filter(u => u.date.startsWith(month));
        built.push({
          staff: s,
          records,
          wkOt: r1(records.filter(r => kindOf(r) === 'overtime').reduce((x, r) => x + (r.resultHours || 0), 0)),
          hol: r1(records.filter(r => kindOf(r) === 'holiday').reduce((x, r) => x + (r.resultHours || 0), 0)),
          allowH: r1(records.filter(r => r.disposition === 'allowance').reduce((x, r) => x + (r.resultHours || 0), 0)),
          allowYen: Math.round(records.filter(r => r.disposition === 'allowance')
            .reduce((x, r) => x + allowanceOf(r.resultHours || 0, s.hourlyWage || 0, kindOf(r)), 0)),
          compGrant: r1(records.filter(r => r.disposition === 'comp').reduce((x, r) => x + (r.resultHours || 0), 0)),
          compUsed: r1(uses.reduce((x, u) => x + (u.hours || 0), 0)),
        });
      }
      if (!alive) return;
      setSheets(built);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month]);

  const [y, m] = month.split('-');
  const dispLabel: Record<string, string> = { allowance: '手当', comp: '代休', '': '未定' };

  return (
    <div className="ot-print max-w-3xl mx-auto px-4 py-5">
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">PDFで保存（印刷）</button>
        <span className="text-xs text-gray-400">印刷ダイアログで送信先を「PDFに保存」にするとPDFになります（職員ごとに改ページ）</span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : sheets.length === 0 ? (
        <p className="text-sm text-gray-500">{Number(y)}年{Number(m)}月に承認済みの時間外勤務はありません。</p>
      ) : (
        sheets.map((sh, i) => {
          const s = sh.staff;
          return (
            <section key={s.id} className="ot-page" style={{ breakAfter: i < sheets.length - 1 ? 'page' : 'auto', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
              <h1 className="text-lg font-bold text-center mb-1">時間外勤務実績簿</h1>
              <p className="text-sm text-center mb-3">{Number(y)}年{Number(m)}月</p>

              <table className="w-full text-sm mb-3 border border-gray-500 border-collapse">
                <tbody>
                  <tr>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-24">氏名</th>
                    <td className="border border-gray-500 px-2 py-1">{s.lastName} {s.firstName}</td>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-24">雇用区分</th>
                    <td className="border border-gray-500 px-2 py-1">{s.employmentType === 'fulltime' ? '常勤職員' : 'パート職員'}</td>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-20">時給</th>
                    <td className="border border-gray-500 px-2 py-1">{yen(s.hourlyWage || 0)}</td>
                  </tr>
                </tbody>
              </table>

              <table className="w-full text-sm border border-gray-500 border-collapse">
                <thead>
                  <tr>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 w-24">日付</th>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 w-10">曜</th>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 w-14">種別</th>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">事由</th>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 w-16">実績</th>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 w-12">処理</th>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 w-20">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {sh.records.map(r => {
                    const k = r.kind || overtimeKindOf(s, r.date);
                    const wd = new Date(`${r.date}T00:00:00`).getDay();
                    return (
                      <tr key={r.id}>
                        <td className="border border-gray-500 px-2 py-1 text-center">{r.date}</td>
                        <td className={`border border-gray-500 px-1 py-1 text-center ${wd === 0 ? 'text-red-600' : wd === 6 ? 'text-blue-600' : ''}`}>{WEEKDAY_LABELS[wd]}</td>
                        <td className="border border-gray-500 px-1 py-1 text-center">{OVERTIME_KIND_LABELS[k]}</td>
                        <td className="border border-gray-500 px-2 py-1">{r.reason}</td>
                        <td className="border border-gray-500 px-2 py-1 text-right">{r1(r.resultHours || 0)}h</td>
                        <td className="border border-gray-500 px-1 py-1 text-center">{dispLabel[r.disposition] || '未定'}</td>
                        <td className="border border-gray-500 px-2 py-1 text-right">{r.disposition === 'allowance' ? yen(allowanceOf(r.resultHours || 0, s.hourlyWage || 0, k)) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* 集計 */}
              <table className="w-full text-sm mt-3 border border-gray-500 border-collapse">
                <tbody>
                  <tr>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-32">平日時間外 合計</th>
                    <td className="border border-gray-500 px-2 py-1 text-right w-24">{sh.wkOt}h</td>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left w-32">休日勤務 合計</th>
                    <td className="border border-gray-500 px-2 py-1 text-right w-24">{sh.hol}h</td>
                  </tr>
                  <tr>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">時間外手当 対象時間</th>
                    <td className="border border-gray-500 px-2 py-1 text-right">{sh.allowH}h</td>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">時間外手当 金額</th>
                    <td className="border border-gray-500 px-2 py-1 text-right font-bold">{yen(sh.allowYen)}</td>
                  </tr>
                  <tr>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">代休付与</th>
                    <td className="border border-gray-500 px-2 py-1 text-right">{sh.compGrant}h</td>
                    <th className="border border-gray-500 bg-gray-100 px-2 py-1 text-left">当月 代休消化</th>
                    <td className="border border-gray-500 px-2 py-1 text-right">{sh.compUsed}h</td>
                  </tr>
                </tbody>
              </table>

              {/* 確認欄 */}
              <div className="flex justify-end gap-2 mt-4 text-xs">
                {['作成者', '確認者', '承認者'].map(role => (
                  <div key={role} className="border border-gray-500 w-24">
                    <div className="border-b border-gray-500 bg-gray-100 text-center py-0.5">{role}</div>
                    <div className="h-12" />
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
