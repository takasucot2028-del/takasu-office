import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Input, Select, Button, Table, Th, Td, Badge } from '../../components/UI';
import { listStaff } from '../../utils/store';
import { EMPLOYMENT_TYPE_LABELS, STAFF_STATUS_LABELS, WORK_LOCATION_LABELS } from '../../utils/constants';
import type { EmploymentType, StaffStatus, WorkLocation } from '../../types';

export default function StaffList() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | EmploymentType>('');
  const [locationFilter, setLocationFilter] = useState<'' | WorkLocation>('');
  const [statusFilter, setStatusFilter] = useState<'' | StaffStatus>('active');

  const allStaff = useMemo(() => listStaff(), []);

  const filtered = allStaff.filter(s => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (typeFilter && s.employmentType !== typeFilter) return false;
    if (locationFilter && s.workLocation !== locationFilter) return false;
    if (keyword) {
      const k = keyword.trim();
      const target = `${s.lastName}${s.firstName} ${s.lastKana}${s.firstKana} ${s.position}`;
      if (!target.includes(k)) return false;
    }
    return true;
  });

  const exportExcel = () => {
    const rows = [
      ['氏名', 'フリガナ', '雇用区分', '勤務場所', '役職・担当', '入職日', '在職状況', '電話番号', 'メールアドレス', '住所', '保有資格', '備考'],
      ...filtered.map(s => [
        `${s.lastName} ${s.firstName}`,
        `${s.lastKana} ${s.firstKana}`,
        EMPLOYMENT_TYPE_LABELS[s.employmentType],
        s.workLocation ? WORK_LOCATION_LABELS[s.workLocation] : '',
        s.position,
        s.hireDate,
        STAFF_STATUS_LABELS[s.status],
        s.phone,
        s.email,
        s.address,
        s.qualifications,
        s.note,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 24 }, { wch: 30 }, { wch: 20 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '職員名簿');
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `職員名簿_${today}.xlsx`);
  };

  return (
    <PageContainer title="職員名簿">
      <Card className="mb-4">
        <div className="grid sm:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <Input
              placeholder="氏名・フリガナ・役職で検索"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
            />
          </div>
          <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value as '' | EmploymentType)}>
            <option value="">雇用区分: すべて</option>
            {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
          <Select value={locationFilter} onChange={e => setLocationFilter(e.target.value as '' | WorkLocation)}>
            <option value="">勤務場所: すべて</option>
            {Object.entries(WORK_LOCATION_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as '' | StaffStatus)}>
            <option value="">在職状況: すべて</option>
            <option value="active">在職</option>
            <option value="retired">退職</option>
          </Select>
        </div>
      </Card>

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">{filtered.length}名</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={exportExcel}>Excel出力</Button>
          <Button size="sm" onClick={() => navigate('/labor/staff/new')}>新規職員登録</Button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>氏名</Th>
              <Th>フリガナ</Th>
              <Th>雇用区分</Th>
              <Th>勤務場所</Th>
              <Th>役職・担当</Th>
              <Th>入職日</Th>
              <Th>在職状況</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <Td>
                  <Link to={`/labor/staff/${s.id}`} className="text-blue-600 hover:underline font-medium">
                    {s.lastName} {s.firstName}
                  </Link>
                </Td>
                <Td>{s.lastKana} {s.firstKana}</Td>
                <Td>{EMPLOYMENT_TYPE_LABELS[s.employmentType]}</Td>
                <Td>{s.workLocation ? WORK_LOCATION_LABELS[s.workLocation] : <span className="text-gray-400">未設定</span>}</Td>
                <Td>{s.position}</Td>
                <Td>{s.hireDate}</Td>
                <Td>
                  <Badge color={s.status === 'active' ? 'green' : 'gray'}>
                    {STAFF_STATUS_LABELS[s.status]}
                  </Badge>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <Td className="text-center text-gray-400 py-8" colSpan={7}>
                  該当する職員がいません
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </PageContainer>
  );
}
