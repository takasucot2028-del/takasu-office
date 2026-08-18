// 労働者名簿（労働基準法第107条・同規則第53条）
// 記載事項: 氏名／生年月日／履歴／性別／住所／従事する業務の種類／
//           雇入年月日／退職年月日及びその事由／死亡年月日及びその原因
// ※死亡に関する欄は記入欄のみ設ける（システムでは管理していない）
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listStaff, getStaff } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS, GENDER_LABELS } from '../../utils/constants';
import type { Staff } from '../../types';

/** 生年月日から満年齢 */
function ageOf(birth: string, asOf: string): string {
  if (!birth) return '';
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ay, am, ad] = asOf.split('-').map(Number);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age--;
  return age >= 0 ? `${age}` : '';
}

export default function StaffRegisterPrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const staffId = params.get('staffId') || '';
  const includeRetired = params.get('retired') === '1';

  const [sheets, setSheets] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 14mm; }';
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (staffId) {
        const s = await getStaff(staffId);
        if (alive) { setSheets(s ? [s] : []); setLoading(false); }
        return;
      }
      const list = await listStaff();
      if (!alive) return;
      setSheets(includeRetired ? list : list.filter(s => s.status === 'active'));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [staffId, includeRetired]);

  const th = 'border border-gray-500 bg-gray-100 px-2 py-1 text-left align-middle';
  const td = 'border border-gray-500 px-2 py-1 align-middle';

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">PDFで保存（印刷）</button>
        <span className="text-xs text-gray-400">
          印刷ダイアログで送信先を「PDFに保存」にするとPDFとして保存できます（職員ごとに改ページ）
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : sheets.length === 0 ? (
        <p className="text-sm text-gray-500">対象の職員が見つかりません。</p>
      ) : sheets.map((s, idx) => (
        <section key={s.id}
          style={{ breakAfter: idx < sheets.length - 1 ? 'page' : 'auto', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
          <h1 className="text-lg font-bold text-center mb-1">労働者名簿</h1>
          <p className="text-xs text-center text-gray-500 mb-3">一般社団法人たかすスポーツクラブ　（労働基準法第107条）</p>

          <table className="w-full text-sm border border-gray-500 border-collapse">
            <tbody>
              <tr>
                <th className={`${th} w-28`}>氏名</th>
                <td className={td} colSpan={3}>
                  {s.lastName} {s.firstName}
                  <span className="ml-3 text-xs text-gray-500">（{s.lastKana} {s.firstKana}）</span>
                </td>
              </tr>
              <tr>
                <th className={th}>性別</th>
                <td className={`${td} w-32`}>{s.gender ? GENDER_LABELS[s.gender] : ''}</td>
                <th className={`${th} w-28`}>生年月日</th>
                <td className={td}>
                  {s.birthDate || ''}
                  {s.birthDate && <span className="ml-2 text-xs text-gray-500">（満{ageOf(s.birthDate, today)}歳）</span>}
                </td>
              </tr>
              <tr>
                <th className={th}>住所</th>
                <td className={td} colSpan={3}>{s.address || ''}</td>
              </tr>
              <tr>
                <th className={th}>連絡先</th>
                <td className={td} colSpan={3}>
                  {s.phone || ''}{s.phone && s.email ? '　/　' : ''}{s.email || ''}
                </td>
              </tr>
              <tr>
                <th className={th}>従事する業務の種類</th>
                <td className={td} colSpan={3}>
                  {s.position || ''}
                  <span className="ml-3 text-xs text-gray-500">（{EMPLOYMENT_TYPE_LABELS[s.employmentType]}）</span>
                </td>
              </tr>
              <tr>
                <th className={th}>雇入年月日</th>
                <td className={td}>{s.hireDate || ''}</td>
                <th className={th}>職員番号</th>
                <td className={td}>{s.employeeNumber || ''}</td>
              </tr>
              <tr>
                <th className={th}>履歴</th>
                <td className={td} colSpan={3} style={{ height: '4.5em' }}>
                  <div className="whitespace-pre-wrap">
                    {[s.position && `役職・担当: ${s.position}`,
                      s.qualifications && `保有資格: ${s.qualifications}`,
                      s.note && `備考: ${s.note}`].filter(Boolean).join('\n')}
                  </div>
                </td>
              </tr>
              <tr>
                <th className={th}>退職年月日</th>
                <td className={td}>{s.retireDate || ''}</td>
                <th className={th}>退職の事由</th>
                <td className={td}>{s.retireReason || ''}</td>
              </tr>
              <tr>
                <th className={th}>死亡年月日</th>
                <td className={td}>&nbsp;</td>
                <th className={th}>死亡の原因</th>
                <td className={td}>&nbsp;</td>
              </tr>
            </tbody>
          </table>

          <p className="text-xs text-gray-500 mt-2">
            ※ 解雇の場合は退職の事由欄にその理由を記載してください。死亡欄は該当時に記入してください。
          </p>
          <p className="text-xs text-gray-400 mt-1">作成日: {today}</p>
        </section>
      ))}
    </div>
  );
}
