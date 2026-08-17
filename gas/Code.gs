// ============================================
// たかすスポーツクラブ 事務管理システム（労務管理）
// Google Apps Script バックエンド
// ============================================
// 会員管理システム(takasu-member)とは別のスプレッドシートを使う独立バックエンド。
// デプロイ手順は README / 画面の案内を参照。

// --- 設定 ---
// スプレッドシートID は「プロジェクトの設定 → スクリプト プロパティ」で
// SPREADSHEET_ID として設定する（公開リポジトリにIDを残さないため）。
function getSpreadsheetId() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('スクリプト プロパティに SPREADSHEET_ID を設定してください');
  return id;
}

// --- シート定義 ---
// columns: [内部キー, 日本語見出し]。この順序＝列順。データは列位置で内部キーに対応づける。
var SHEETS = {
  auth_users: { name: '管理者', columns: [
    ['email', 'メールアドレス'], ['passwordHash', 'パスワードハッシュ'], ['role', '権限'],
  ] },
  staff: { name: '職員', columns: [
    ['id', 'ID'], ['lastName', '姓'], ['firstName', '名'], ['lastKana', 'セイ'], ['firstKana', 'メイ'],
    ['birthDate', '生年月日'], ['employmentType', '雇用区分'], ['workLocation', '勤務場所'],
    ['position', '役職・担当'], ['hireDate', '入職日'], ['retireDate', '退職日'], ['status', '在職状況'],
    ['phone', '電話番号'], ['email', 'メールアドレス'], ['address', '住所'],
    ['qualifications', '保有資格'], ['note', '備考'], ['createdAt', '作成日時'], ['updatedAt', '更新日時'],
    ['hourlyWage', '時給'], ['employeeNumber', '職員番号'], ['passwordHash', 'パスワードハッシュ'],
    ['monthlyHourLimit', '月間上限時間'],
  ] },
  overtime: { name: '時間外', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['date', '日付'], ['kind', '種別'],
    ['appliedHours', '申請時間'], ['reason', '事由'], ['status', '状態'],
    ['disposition', '処理区分'], ['resultHours', '実績時間'], ['note', '備考'],
    ['startTime', '開始'], ['endTime', '終了'],
  ] },
  comp_leave_use: { name: '代休取得', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['date', '日付'], ['hours', '時間'], ['note', '備考'],
  ] },
  documents: { name: '文書', columns: [
    ['id', 'ID'], ['type', '種別'], ['title', 'タイトル'], ['url', '共有リンク'], ['createdAt', '作成日時'], ['updatedAt', '更新日時'],
  ] },
  expense_categories: { name: '費目マスタ', columns: [
    ['id', 'ID'], ['name', '費目名'], ['order', '並び順'],
  ] },
  budgets: { name: '予算', columns: [
    ['id', 'ID'], ['fiscalYear', '年度'], ['project', '事業'], ['categoryId', '費目ID'], ['amount', '予算額'], ['note', '備考'],
    ['division', '区分'],
  ] },
  expenses: { name: '経費', columns: [
    ['id', 'ID'], ['fiscalYear', '年度'], ['staffId', '申請者ID'], ['date', '日付'], ['project', '事業'],
    ['categoryId', '費目ID'], ['amount', '金額'], ['description', '内容'], ['status', '状態'], ['note', '備考'],
  ] },
  attendance: { name: '勤怠', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['date', '日付'], ['dayType', '区分'],
    ['startTime', '出勤'], ['endTime', '退勤'], ['breakMinutes', '休憩(分)'], ['note', '備考'],
    ['breakStart', '休憩開始'], ['breakEnd', '休憩終了'],
  ] },
  leave: { name: '有給休暇', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['kind', '種別'], ['date', '日付'], ['days', '日数'], ['note', '備考'], ['hours', '時間'], ['status', '状態'],
    ['startTime', '開始'], ['endTime', '終了'],
  ] },
  shift_patterns: { name: 'シフト区分', columns: [
    ['id', 'ID'], ['name', '区分名'], ['startTime', '開始'], ['endTime', '終了'], ['order', '並び順'], ['location', '対象'],
  ] },
  availability: { name: 'シフト希望', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['date', '日付'], ['patternId', '区分ID'],
  ] },
  shifts_confirmed: { name: '確定シフト', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['date', '日付'], ['location', '勤務場所'],
    ['patternId', '区分ID'], ['note', '備考'],
  ] },
  shift_changes: { name: 'シフト変更履歴', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['date', '日付'], ['location', '勤務場所'],
    ['before', '変更前'], ['after', '変更後'], ['changedAt', '変更日時'], ['readAt', '確認日時'],
  ] },
};

function sheetConf(key) {
  const conf = SHEETS[key];
  if (!conf) throw new Error('不明なシート: ' + key);
  return conf;
}
function colKeys(key) { return sheetConf(key).columns.map(function (c) { return c[0]; }); }
function colLabels(key) { return sheetConf(key).columns.map(function (c) { return c[1]; }); }
function colNum(key, fieldKey) {
  const idx = colKeys(key).indexOf(fieldKey);
  return idx < 0 ? -1 : idx + 1;
}

// 論理キーでシートを開く（なければ日本語見出しで新規作成）。
// 時刻("09:00")・年月("2026-07")の自動変換を防ぐため、全列をテキスト書式に固定する。
function getSheet(key) {
  const conf = sheetConf(key);
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  let sheet = ss.getSheetByName(conf.name);
  if (!sheet) {
    sheet = ss.insertSheet(conf.name);
    const labels = colLabels(key);
    sheet.getRange(1, 1, sheet.getMaxRows(), labels.length).setNumberFormat('@'); // テキスト書式
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// --- 初期セットアップ（1回だけ実行）---
function setupSpreadsheet() {
  Object.keys(SHEETS).forEach(function (key) { getSheet(key); });

  // 管理者アカウント作成。パスワードはリポジトリに平文で残さないため Script Properties から読む。
  // 「プロジェクトの設定 > スクリプト プロパティ」で ADMIN_EMAIL / ADMIN_PASSWORD を設定してから実行する。
  // 未設定の場合はデモ用 admin@takasu-sc.jp / admin123 で作成される（本番では必ず設定すること）。
  const authSheet = getSheet('auth_users');
  if (authSheet.getLastRow() <= 1) {
    const props = PropertiesService.getScriptProperties();
    const adminEmail = props.getProperty('ADMIN_EMAIL') || 'admin@takasu-sc.jp';
    const adminPassword = props.getProperty('ADMIN_PASSWORD') || 'admin123';
    authSheet.appendRow([adminEmail, hashPassword(adminPassword), 'admin']);
  }
  Logger.log('セットアップ完了');
}

// 既存シートのヘッダー行を現在の列定義（日本語見出し）に同期する（列追加時に手動実行）。
function syncHeaders() {
  Object.keys(SHEETS).forEach(function (key) {
    const sheet = getSheet(key);
    const labels = colLabels(key);
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(1);
  });
  Logger.log('ヘッダーを同期しました');
}

// 管理者の認証情報を Script Properties (ADMIN_EMAIL / ADMIN_PASSWORD) から再設定する。
// パスワードを忘れた場合や初期化したい場合に GAS エディタから手動実行する。
function resetAdminCredentials() {
  const props = PropertiesService.getScriptProperties();
  const adminEmail = props.getProperty('ADMIN_EMAIL');
  const adminPassword = props.getProperty('ADMIN_PASSWORD');
  if (!adminEmail || !adminPassword) {
    throw new Error('Script Properties に ADMIN_EMAIL と ADMIN_PASSWORD を設定してください');
  }
  const sheet = getSheet('auth_users');
  const data = sheet.getDataRange().getValues();
  const hash = hashPassword(adminPassword);
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === 'admin') {
      sheet.getRange(i + 1, 1, 1, 3).setValues([[adminEmail, hash, 'admin']]);
      Logger.log('管理者認証情報を更新しました');
      return;
    }
  }
  sheet.appendRow([adminEmail, hash, 'admin']);
  Logger.log('管理者アカウントを作成しました');
}

// --- パスワードハッシュ化（SHA-256）---
function hashPassword(pw) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pw));
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// --- セッション管理（CacheService・TTL 6時間）---
var SESSION_TTL_SECONDS = 21600;

function issueToken(role, staffId) {
  const token = genId() + genId(); // 24文字
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ role: role, staffId: staffId || '' }), SESSION_TTL_SECONDS);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

// 認可: 公開＝ログイン系。従業員アクションは role=staff（自分のデータのみ）。それ以外は管理者専用。
var PUBLIC_ACTIONS = { adminLogin: true, staffLogin: true };
var STAFF_ACTIONS = {
  getMyProfile: true, getMyAttendance: true, punch: true, setMyBreak: true,
  getMyShiftChanges: true, markShiftChangesRead: true,
  getMyAvailability: true, saveMyAvailability: true,
  getMyOvertime: true, addMyOvertime: true,
  getMyLeave: true, addMyLeaveRequest: true, staffChangePassword: true,
  getExpenseContext: true, getMyExpenses: true, addMyExpense: true,
};
// 認証済みなら role を問わず許可（事務局・従業員の両方が閲覧するもの）
var AUTHED_ACTIONS = { getDocuments: true, getTodayWork: true };
function enforceAuth(action, body) {
  if (PUBLIC_ACTIONS[action]) return;
  const session = getSession(body.token);
  if (!session) throw new Error('認証が必要です。再度ログインしてください');
  if (action === 'batch') return; // 中の各サブアクションで個別に認可する
  if (AUTHED_ACTIONS[action]) return; // ログイン済みなら誰でも
  if (STAFF_ACTIONS[action]) {
    if (session.role !== 'staff') throw new Error('従業員のログインが必要です');
    return;
  }
  if (session.role !== 'admin') throw new Error('管理者権限が必要です');
}

// --- Web App エンドポイント ---
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    enforceAuth(action, body);
    const result = (action === 'batch') ? handleBatch(body.requests, body.token) : dispatch(action, body);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 1リクエストで複数処理をまとめて実行する（画面あたりのGAS往復を1回に減らす）。
// 各サブアクションはこのトークンで個別に認可する。
function handleBatch(requests, token) {
  const out = (requests || []).map(function (req) {
    try {
      const b = Object.assign({}, req, { token: token });
      enforceAuth(req.action, b);
      return dispatch(req.action, b);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  return { success: true, data: out };
}

// アクションを対応するハンドラーへ振り分ける（doPost と handleBatch が共用）
function dispatch(action, body) {
  let result;
  switch (action) {
      case 'adminLogin':
        result = handleAdminLogin(body.email, body.password);
        break;
      case 'changePassword':
        result = handleChangePassword(body.oldPassword, body.newPassword);
        break;
      // 従業員ログイン・自分用（session.staffId のみ操作）
      case 'staffLogin':
        result = handleStaffLogin(body.employeeNumber, body.password);
        break;
      case 'getMyProfile':
        result = handleGetMyProfile(getSession(body.token));
        break;
      case 'getMyAttendance':
        result = handleGetMyAttendance(getSession(body.token), body.month);
        break;
      case 'punch':
        result = handlePunch(getSession(body.token), body.punchType);
        break;
      case 'setMyBreak':
        result = handleSetMyBreak(getSession(body.token), body.breakStart, body.breakEnd);
        break;
      case 'getMyShiftChanges':
        result = handleGetMyShiftChanges(getSession(body.token));
        break;
      case 'markShiftChangesRead':
        result = handleMarkShiftChangesRead(getSession(body.token));
        break;
      case 'getMyAvailability':
        result = handleGetMyAvailability(getSession(body.token), body.month);
        break;
      case 'saveMyAvailability':
        result = handleSaveMyAvailability(getSession(body.token), body.month, body.records);
        break;
      case 'getMyOvertime':
        result = handleGetMyOvertime(getSession(body.token));
        break;
      case 'addMyOvertime':
        result = handleAddMyOvertime(getSession(body.token), body.record);
        break;
      case 'getMyLeave':
        result = handleGetMyLeave(getSession(body.token));
        break;
      case 'addMyLeaveRequest':
        result = handleAddMyLeaveRequest(getSession(body.token), body.record);
        break;
      case 'staffChangePassword':
        result = handleStaffChangePassword(getSession(body.token), body.oldPassword, body.newPassword);
        break;
      // 文書（閲覧は事務局・従業員の両方、登録/削除は事務局）
      case 'getDocuments':
        result = handleGetDocuments();
        break;
      case 'saveDocument':
        result = handleSaveDocument(body.doc);
        break;
      case 'deleteDocument':
        result = handleDeleteDocument(body.id);
        break;
      // 会計管理（事務局）
      case 'getExpenseCategories':
        result = handleGetExpenseCategories();
        break;
      case 'saveExpenseCategories':
        result = handleSaveExpenseCategories(body.categories);
        break;
      case 'getBudgets':
        result = handleGetBudgets(body.fiscalYear);
        break;
      case 'saveBudgets':
        result = handleSaveBudgets(body.fiscalYear, body.records);
        break;
      case 'getExpenses':
        result = handleGetExpenses(body.fiscalYear);
        break;
      case 'addExpense':
        result = handleAddExpense(body.record);
        break;
      case 'setExpenseStatus':
        result = handleSetExpenseStatus(body.id, body.status);
        break;
      case 'deleteExpense':
        result = handleDeleteExpense(body.id);
        break;
      // 会計管理（従業員）
      case 'getExpenseContext':
        result = handleGetExpenseContext(body.fiscalYear);
        break;
      case 'getMyExpenses':
        result = handleGetMyExpenses(getSession(body.token));
        break;
      case 'addMyExpense':
        result = handleAddMyExpense(getSession(body.token), body.record);
        break;
      // 管理者：従業員パスワード発行・休暇申請の承認
      case 'setStaffPassword':
        result = handleSetStaffPassword(body.staffId, body.password);
        break;
      case 'setLeaveStatus':
        result = handleSetLeaveStatus(body.id, body.status);
        break;
      case 'getStaff':
        result = handleGetStaff();
        break;
      case 'upsertStaff':
        result = handleUpsertStaff(body.staff);
        break;
      case 'getAttendance':
        result = handleGetAttendance(body.staffId, body.month);
        break;
      case 'saveMonthAttendance':
        result = handleSaveMonthAttendance(body.staffId, body.month, body.records);
        break;
      case 'getShiftPatterns':
        result = handleGetShiftPatterns();
        break;
      case 'saveShiftPatterns':
        result = handleSaveShiftPatterns(body.patterns);
        break;
      case 'getAvailabilityMonth':
        result = handleGetAvailabilityMonth(body.month);
        break;
      case 'saveMonthAvailability':
        result = handleSaveMonthAvailability(body.month, body.staffIds, body.records);
        break;
      case 'getConfirmedMonth':
        result = handleGetConfirmedMonth(body.month);
        break;
      case 'saveMonthConfirmed':
        result = handleSaveMonthConfirmed(body.month, body.location, body.records);
        break;
      case 'getOvertimeMonth':
        result = handleGetOvertimeMonth(body.month);
        break;
      case 'getOvertimeByStaff':
        result = handleGetOvertimeByStaff(body.staffId);
        break;
      case 'saveMonthOvertime':
        result = handleSaveMonthOvertime(body.staffId, body.month, body.records);
        break;
      case 'getCompUse':
        result = handleGetCompUse(body.staffId);
        break;
      case 'addCompUse':
        result = handleAddCompUse(body.record);
        break;
      case 'deleteCompUse':
        result = handleDeleteCompUse(body.id);
        break;
      case 'getAbsencesByDate':
        result = handleGetAbsencesByDate(body.date);
        break;
      case 'getTodayWork':
        result = handleGetTodayWork(body.date);
        break;
      case 'getPendingSummary':
        result = handleGetPendingSummary();
        break;
      case 'getLeave':
        result = handleGetLeave(body.staffId);
        break;
      case 'addLeave':
        result = handleAddLeave(body.record);
        break;
      case 'deleteLeave':
        result = handleDeleteLeave(body.id);
        break;
      default:
        result = { success: false, error: '不明なアクション: ' + action };
    }
    return result;
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- ユーティリティ ---
function genId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

// シートの各行を内部キーのオブジェクトへ変換。
function sheetToObjects(sheet, key) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const keys = colKeys(key);
  const tz = Session.getScriptTimeZone();
  return data.slice(1).map(function (row) {
    const obj = {};
    keys.forEach(function (k, i) {
      const v = row[i];
      // Date 型で入っていた場合、時刻のみ（Sheetsの基準日 1899-12-30）は HH:mm、
      // それ以外は yyyy-MM-dd に戻す（通常はテキスト書式のため文字列で入る）。
      if (Object.prototype.toString.call(v) === '[object Date]') {
        obj[k] = (v.getFullYear() <= 1900)
          ? Utilities.formatDate(v, tz, 'HH:mm')
          : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      } else {
        obj[k] = (v === null || v === undefined) ? '' : v;
      }
    });
    return obj;
  });
}

function findRowIndex(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) return i + 1; // 1-indexed
  }
  return -1;
}

// 同じIDのレコードを1件に絞る（読み取り時の保険）。重複行による二重計上を防ぐ。
// 状態がある場合は承認済(approved)を優先して残す。
function dedupeById_(records) {
  const byId = {};
  const order = [];
  (records || []).forEach(function (r) {
    const id = String(r.id || '');
    if (!id) { order.push(r); return; } // ID無しはそのまま
    const prev = byId[id];
    if (prev === undefined) { byId[id] = r; order.push(r); return; }
    if (String(r.status) === 'approved' && String(prev.status) !== 'approved') {
      order[order.indexOf(prev)] = r; // 承認済みで置き換える
      byId[id] = r;
    }
  });
  return order;
}

// 同じIDの行をすべて返す（1-indexed・昇順）。過去の重複データにも対応するため。
function findAllRowIndexes_(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) rows.push(i + 1);
  }
  return rows;
}

// 同じIDの行をすべて削除する（重複が残って「削除できない」状態を防ぐ）。
function deleteRowsById_(sheetKey, id) {
  const sheet = getSheet(sheetKey);
  const rows = findAllRowIndexes_(sheet, 0, id);
  for (let k = rows.length - 1; k >= 0; k--) sheet.deleteRow(rows[k]); // 下から消す
  return rows.length;
}

// セル値を yyyy-MM-dd 文字列へ正規化する。日付がDate型に変換されていても正しく比較できる。
function cellYmd_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v).trim();
}

/**
 * 【保守用・手動実行】同じIDが重複している行を1行に整理する。
 * 過去のリトライ等で二重登録されたデータの後始末に使う（GASエディタから実行）。
 * 状態列がある場合は「承認済(approved)」の行を優先して残す。
 */
function cleanupDuplicateIds() {
  const targets = ['expenses', 'leave', 'comp_leave_use', 'overtime', 'documents'];
  const report = [];
  targets.forEach(function (key) {
    const sheet = getSheet(key);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    const keys = colKeys(key);
    const statusCol = keys.indexOf('status');
    const seen = {};          // id -> 残す行番号(1-indexed)
    const removeRows = [];
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][0]);
      if (!id) continue;
      const rowNo = i + 1;
      if (seen[id] === undefined) { seen[id] = rowNo; continue; }
      // 既出。承認済みの方を残す（状態列がある場合）
      const keptRow = seen[id];
      const thisApproved = statusCol >= 0 && String(data[rowNo - 1][statusCol]) === 'approved';
      const keptApproved = statusCol >= 0 && String(data[keptRow - 1][statusCol]) === 'approved';
      if (thisApproved && !keptApproved) { removeRows.push(keptRow); seen[id] = rowNo; }
      else { removeRows.push(rowNo); }
    }
    removeRows.sort(function (a, b) { return a - b; });
    for (let k = removeRows.length - 1; k >= 0; k--) sheet.deleteRow(removeRows[k]); // 下から消す
    report.push(sheetConf(key).name + ': ' + removeRows.length + '件の重複を削除');
  });
  const msg = report.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * シートの内容を丸ごと置き換える。
 * clearContents() で全消去すると、書き込み完了までの一瞬「空」の状態ができ、
 * その間に読み取りが入ると空データを返してしまう。これを避けるため、
 * 上書き＋余剰行の削除で置き換える。
 */
function replaceSheetRows_(sheetKey, rows) {
  const sheet = getSheet(sheetKey);
  const labels = colLabels(sheetKey);
  const ncol = labels.length;
  const out = [labels].concat(rows || []);
  const lastRow = sheet.getLastRow();
  const maxRows = sheet.getMaxRows();
  if (maxRows < out.length) sheet.insertRowsAfter(maxRows, out.length - maxRows);
  const range = sheet.getRange(1, 1, out.length, ncol);
  range.setNumberFormat('@');   // 時刻・年月の自動変換を防ぐ
  range.setValues(out);
  if (lastRow > out.length) sheet.deleteRows(out.length + 1, lastRow - out.length); // 余剰行を削除
  sheet.setFrozenRows(1);
}

// 同じIDが無ければ追加する（冪等）。リトライで二重登録されないようにする。
function appendUnique_(sheetKey, record) {
  const sheet = getSheet(sheetKey);
  if (findRowIndex(sheet, 0, record.id) >= 0) return; // 既に登録済み（リトライ）→追加しない
  sheet.appendRow(objectToRow(sheetKey, record));
}

// オブジェクトを列順の行配列へ変換
function objectToRow(key, obj) {
  return colKeys(key).map(function (k) {
    const v = obj[k];
    return (v === undefined || v === null) ? '' : v;
  });
}

// --- ハンドラー：認証 ---
function handleAdminLogin(email, password) {
  const sheet = getSheet('auth_users');
  const users = sheetToObjects(sheet, 'auth_users');
  const hash = hashPassword(password);
  const user = users.find(function (u) { return u.email === email && u.passwordHash === hash; });
  if (!user) return { success: false, error: 'メールアドレスまたはパスワードが正しくありません' };
  return { success: true, token: issueToken('admin'), role: 'admin' };
}

function handleChangePassword(oldPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    return { success: false, error: '新しいパスワードは6文字以上で入力してください' };
  }
  const sheet = getSheet('auth_users');
  const data = sheet.getDataRange().getValues();
  const oldHash = hashPassword(oldPassword);
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === 'admin') {
      if (String(data[i][1]) !== oldHash) {
        return { success: false, error: '現在のパスワードが正しくありません' };
      }
      sheet.getRange(i + 1, 2).setValue(hashPassword(newPassword));
      return { success: true };
    }
  }
  return { success: false, error: '管理者アカウントが見つかりません' };
}

// --- ハンドラー：職員 ---
function handleGetStaff() {
  const sheet = getSheet('staff');
  const list = sheetToObjects(sheet, 'staff');
  list.forEach(function (s) {
    s.hourlyWage = Number(s.hourlyWage) || 0;
    s.monthlyHourLimit = Number(s.monthlyHourLimit) || 0;
    s.hasPassword = !!(s.passwordHash && String(s.passwordHash).length);
    delete s.passwordHash; // ハッシュは返さない
  });
  return { success: true, data: list };
}

function handleUpsertStaff(staff) {
  if (!staff || !staff.id) return { success: false, error: '職員データが不正です' };
  const sheet = getSheet('staff');
  const now = new Date().toISOString();
  const rowIndex = findRowIndex(sheet, 0, staff.id);
  const next = {};
  Object.keys(staff).forEach(function (k) { next[k] = staff[k]; });
  next.updatedAt = now;
  if (rowIndex < 0) {
    next.createdAt = staff.createdAt || now;
    next.passwordHash = ''; // 新規はパスワード未設定
    sheet.appendRow(objectToRow('staff', next));
  } else {
    // createdAt と パスワードハッシュ は既存値を保持（フォームからは送られないため）
    const existingCreated = sheet.getRange(rowIndex, colNum('staff', 'createdAt')).getValue();
    next.createdAt = existingCreated || staff.createdAt || now;
    next.passwordHash = sheet.getRange(rowIndex, colNum('staff', 'passwordHash')).getValue();
    const row = objectToRow('staff', next);
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }
  delete next.passwordHash;
  return { success: true, data: next };
}

// 管理者：従業員のログインパスワードを設定/リセット
function handleSetStaffPassword(staffId, password) {
  if (!password || String(password).length < 4) {
    return { success: false, error: 'パスワードは4文字以上で入力してください' };
  }
  const sheet = getSheet('staff');
  const rowIndex = findRowIndex(sheet, 0, staffId);
  if (rowIndex < 0) return { success: false, error: '職員が見つかりません' };
  sheet.getRange(rowIndex, colNum('staff', 'passwordHash')).setValue(hashPassword(password));
  return { success: true };
}

// --- ハンドラー：勤怠 ---
function handleGetAttendance(staffId, month) {
  const sheet = getSheet('attendance');
  const records = sheetToObjects(sheet, 'attendance').filter(function (r) {
    return String(r.staffId) === String(staffId) && String(r.date).slice(0, 7) === month;
  });
  records.forEach(function (r) { r.breakMinutes = Number(r.breakMinutes) || 0; });
  return { success: true, data: records };
}

// 指定職員・指定月の勤怠を丸ごと置換する。ループ削除を避け一括で書き直す。
function handleSaveMonthAttendance(staffId, month, records) {
  const sheet = getSheet('attendance');
  const ncol = colKeys('attendance').length;
  const data = sheet.getDataRange().getValues();

  // 対象（staffId かつ 対象月）以外の行を残す
  const kept = [];
  for (let i = 1; i < data.length; i++) {
    const rowStaff = String(data[i][1]);
    const rowDate = cellYmd_(data[i][2]);
    if (rowStaff === String(staffId) && rowDate.slice(0, 7) === month) continue;
    kept.push(data[i].slice(0, ncol));
  }
  const newRows = (records || []).map(function (r) { return objectToRow('attendance', r); });
  const out = [colLabels('attendance')].concat(kept).concat(newRows);

  sheet.clearContents();
  sheet.getRange(1, 1, sheet.getMaxRows(), ncol).setNumberFormat('@');
  sheet.getRange(1, 1, out.length, ncol).setValues(out);
  sheet.setFrozenRows(1);
  return { success: true };
}

// --- ハンドラー：シフト区分マスタ ---
function handleGetShiftPatterns() {
  const sheet = getSheet('shift_patterns');
  const list = sheetToObjects(sheet, 'shift_patterns')
    .filter(function (p) { return p.id; })
    .map(function (p) { return { id: String(p.id), name: String(p.name), startTime: String(p.startTime), endTime: String(p.endTime), order: Number(p.order) || 0, location: String(p.location || '') }; });
  return { success: true, data: list };
}

// 区分マスタを丸ごと保存（見出しごと書き直す）。
function handleSaveShiftPatterns(patterns) {
  const list = patterns || [];
  const rows = list.map(function (p) { return objectToRow('shift_patterns', p); });
  replaceSheetRows_('shift_patterns', rows); // 全消去せず置換（保存中に空が読まれるのを防ぐ）
  return { success: true, data: { saved: list.length } };
}

// --- ハンドラー：シフト希望（区分ごと・1日複数可） ---
function handleGetAvailabilityMonth(month) {
  const sheet = getSheet('availability');
  const records = sheetToObjects(sheet, 'availability').filter(function (r) {
    return String(r.date).slice(0, 7) === month;
  });
  return { success: true, data: records };
}

// 指定月・表に出ている職員群の希望を差し替える。
function handleSaveMonthAvailability(month, staffIds, records) {
  const sheet = getSheet('availability');
  const ncol = colKeys('availability').length;
  const ids = {};
  (staffIds || []).forEach(function (id) { ids[String(id)] = true; });
  const data = sheet.getDataRange().getValues();
  const kept = [];
  for (let i = 1; i < data.length; i++) {
    const rowStaff = String(data[i][1]);
    const rowDate = cellYmd_(data[i][2]);
    if (rowDate.slice(0, 7) === month && ids[rowStaff]) continue; // 対象は捨てて入れ直す
    kept.push(data[i].slice(0, ncol));
  }
  const newRows = (records || []).map(function (r) { return objectToRow('availability', r); });
  const out = [colLabels('availability')].concat(kept).concat(newRows);
  sheet.clearContents();
  sheet.getRange(1, 1, sheet.getMaxRows(), ncol).setNumberFormat('@');
  sheet.getRange(1, 1, out.length, ncol).setValues(out);
  sheet.setFrozenRows(1);
  return { success: true };
}

// --- ハンドラー：確定シフト ---
function handleGetConfirmedMonth(month) {
  const sheet = getSheet('shifts_confirmed');
  const records = sheetToObjects(sheet, 'shifts_confirmed').filter(function (r) {
    return String(r.date).slice(0, 7) === month;
  });
  return { success: true, data: records };
}

// 指定月・指定勤務場所の確定シフトを差し替える。
// 置き換え前後を比較し、職員ごとの変更内容を「シフト変更履歴」に記録する（従業員への通知に使う）。
function handleSaveMonthConfirmed(month, location, records) {
  const sheet = getSheet('shifts_confirmed');
  const ncol = colKeys('shifts_confirmed').length;
  const data = sheet.getDataRange().getValues();
  const kept = [];
  const oldTargets = []; // 置き換え対象（同月・同勤務場所）の既存データ
  for (let i = 1; i < data.length; i++) {
    const rowDate = cellYmd_(data[i][2]);
    const rowLoc = String(data[i][3]);
    if (rowDate.slice(0, 7) === month && rowLoc === String(location)) {
      oldTargets.push({ staffId: String(data[i][1]), date: rowDate, patternId: String(data[i][4]) });
      continue;
    }
    kept.push(data[i].slice(0, ncol));
  }
  const newRows = (records || []).map(function (r) { return objectToRow('shifts_confirmed', r); });
  replaceSheetRows_('shifts_confirmed', kept.concat(newRows)); // 全消去せず置換

  recordShiftChanges_(month, location, oldTargets, records || []);
  return { success: true };
}

// 変更前後を職員×日で比較し、差分だけを履歴に追加する。
function recordShiftChanges_(month, location, oldList, newList) {
  const patName = {};
  sheetToObjects(getSheet('shift_patterns'), 'shift_patterns').forEach(function (p) { patName[p.id] = p.name; });
  const label = function (ids) {
    if (!ids.length) return 'なし';
    return ids.map(function (id) { return patName[id] || id; }).join(' ');
  };
  // 職員×日ごとに区分IDをまとめる
  const group = function (list) {
    const m = {};
    list.forEach(function (r) {
      const key = String(r.staffId) + '|' + String(r.date);
      (m[key] = m[key] || []).push(String(r.patternId));
    });
    Object.keys(m).forEach(function (k) { m[k].sort(); });
    return m;
  };
  const before = group(oldList), after = group(newList);
  const keys = {};
  Object.keys(before).forEach(function (k) { keys[k] = true; });
  Object.keys(after).forEach(function (k) { keys[k] = true; });

  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const rows = [];
  Object.keys(keys).forEach(function (k) {
    const b = before[k] || [], a = after[k] || [];
    if (b.join(',') === a.join(',')) return; // 変更なし
    const parts = k.split('|');
    rows.push(objectToRow('shift_changes', {
      id: genId('sc'), staffId: parts[0], date: parts[1], location: location,
      before: label(b), after: label(a), changedAt: now, readAt: '',
    }));
  });
  if (!rows.length) return;
  const sheet = getSheet('shift_changes');
  const ncol = colKeys('shift_changes').length;
  const start = sheet.getLastRow() + 1;
  if (sheet.getMaxRows() < start + rows.length) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length);
  const range = sheet.getRange(start, 1, rows.length, ncol);
  range.setNumberFormat('@');
  range.setValues(rows);
}

// --- ハンドラー：時間外・休日勤務 ---
function handleGetOvertimeMonth(month) {
  const sheet = getSheet('overtime');
  const records = dedupeById_(sheetToObjects(sheet, 'overtime').filter(function (r) {
    return String(r.date).slice(0, 7) === month;
  }));
  records.forEach(function (r) { r.appliedHours = Number(r.appliedHours) || 0; r.resultHours = Number(r.resultHours) || 0; });
  return { success: true, data: records };
}

function handleGetOvertimeByStaff(staffId) {
  const sheet = getSheet('overtime');
  const records = dedupeById_(sheetToObjects(sheet, 'overtime').filter(function (r) { return String(r.staffId) === String(staffId); }));
  records.forEach(function (r) { r.appliedHours = Number(r.appliedHours) || 0; r.resultHours = Number(r.resultHours) || 0; });
  return { success: true, data: records };
}

// 指定職員・指定月の時間外を丸ごと置換する。
function handleSaveMonthOvertime(staffId, month, records) {
  const sheet = getSheet('overtime');
  const ncol = colKeys('overtime').length;
  const data = sheet.getDataRange().getValues();
  const kept = [];
  for (let i = 1; i < data.length; i++) {
    const rowStaff = String(data[i][1]);
    const rowDate = cellYmd_(data[i][2]);
    if (rowStaff === String(staffId) && rowDate.slice(0, 7) === month) continue;
    kept.push(data[i].slice(0, ncol));
  }
  const newRows = (records || []).map(function (r) { return objectToRow('overtime', r); });
  const out = [colLabels('overtime')].concat(kept).concat(newRows);
  sheet.clearContents();
  sheet.getRange(1, 1, sheet.getMaxRows(), ncol).setNumberFormat('@');
  sheet.getRange(1, 1, out.length, ncol).setValues(out);
  sheet.setFrozenRows(1);
  return { success: true };
}

// --- ハンドラー：代休取得（消化） ---
function handleGetCompUse(staffId) {
  const sheet = getSheet('comp_leave_use');
  const records = sheetToObjects(sheet, 'comp_leave_use').filter(function (r) { return String(r.staffId) === String(staffId); });
  records.forEach(function (r) { r.hours = Number(r.hours) || 0; });
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: records };
}

function handleAddCompUse(record) {
  if (!record || !record.id) return { success: false, error: '代休取得の記録が不正です' };
  appendUnique_('comp_leave_use', record);
  return { success: true };
}

function handleDeleteCompUse(id) {
  deleteRowsById_('comp_leave_use', id); // 同一IDの重複行もまとめて削除（0件でも成功＝冪等）
  return { success: true };
}

// --- ハンドラー：本日の休暇（有給取得・代休取得） ---
function handleGetAbsencesByDate(date) {
  var leave = sheetToObjects(getSheet('leave'), 'leave').filter(function (r) {
    return String(r.date) === String(date) && r.kind === 'use' && String(r.status || 'approved') === 'approved';
  });
  leave.forEach(function (r) { r.days = Number(r.days) || 0; r.hours = Number(r.hours) || 0; });
  var comp = sheetToObjects(getSheet('comp_leave_use'), 'comp_leave_use').filter(function (r) {
    return String(r.date) === String(date);
  });
  comp.forEach(function (r) { r.hours = Number(r.hours) || 0; });
  return { success: true, data: { leave: leave, comp: comp } };
}

// 未承認（要対応）の申請をまとめて返す。件数に加えて「誰の・いつ・何の申請か」も返す。
function handleGetPendingSummary() {
  const nameOf = {};
  sheetToObjects(getSheet('staff'), 'staff').forEach(function (s) {
    nameOf[s.id] = ((s.lastName || '') + ' ' + (s.firstName || '')).trim();
  });
  const who = function (id) { return nameOf[id] || '(不明)'; };

  const exp = dedupeById_(sheetToObjects(getSheet('expenses'), 'expenses'))
    .filter(function (e) { return String(e.status) === 'requested'; });
  const ot = dedupeById_(sheetToObjects(getSheet('overtime'), 'overtime'))
    .filter(function (r) { return String(r.status) === 'applied'; });
  const lv = dedupeById_(sheetToObjects(getSheet('leave'), 'leave'))
    .filter(function (r) { return String(r.status) === 'requested'; });

  const items = [];
  ot.forEach(function (r) {
    const span = (r.startTime && r.endTime) ? (r.startTime + '〜' + r.endTime) : ((Number(r.appliedHours) || 0) + 'h');
    items.push({ type: 'overtime', staffName: who(r.staffId), date: String(r.date), detail: span });
  });
  lv.forEach(function (r) {
    const h = Number(r.hours) || 0, d = Number(r.days) || 0;
    const span = (r.startTime && r.endTime) ? (r.startTime + '〜' + r.endTime) : (h > 0 ? h + '時間' : d + '日');
    items.push({ type: 'leave', staffName: who(r.staffId), date: String(r.date), detail: span });
  });
  exp.forEach(function (e) {
    const amount = Number(e.amount) || 0;
    items.push({
      type: 'expense', staffName: e.staffId ? who(e.staffId) : '事務局',
      date: String(e.date), detail: (e.project || '') + ' ¥' + amount.toLocaleString(),
    });
  });
  items.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }); // 新しい順

  return {
    success: true,
    data: { expenses: exp.length, overtime: ot.length, leave: lv.length, items: items.slice(0, 50) },
  };
}

// 従業員も閲覧できる「本日の勤務・休暇」。氏名・シフト時間・休暇のみ返す（個人情報は含めない）。
function handleGetTodayWork(date) {
  var d = String(date);
  var nameOf = {};
  sheetToObjects(getSheet('staff'), 'staff').forEach(function (s) {
    nameOf[s.id] = ((s.lastName || '') + ' ' + (s.firstName || '')).trim();
  });
  var patMap = {};
  sheetToObjects(getSheet('shift_patterns'), 'shift_patterns').forEach(function (p) { patMap[p.id] = p; });
  var shifts = sheetToObjects(getSheet('shifts_confirmed'), 'shifts_confirmed')
    .filter(function (r) { return String(r.date) === d; })
    .map(function (r) {
      var p = patMap[r.patternId] || {};
      return {
        location: r.location, staffName: nameOf[r.staffId] || '(不明)',
        patternName: p.name || '', startTime: p.startTime || '', endTime: p.endTime || '',
        order: Number(p.order) || 99,
      };
    });
  var leave = sheetToObjects(getSheet('leave'), 'leave')
    .filter(function (r) { return String(r.date) === d && r.kind === 'use' && String(r.status || 'approved') === 'approved'; })
    .map(function (r) { return { staffName: nameOf[r.staffId] || '(不明)', days: Number(r.days) || 0, hours: Number(r.hours) || 0, note: r.note || '' }; });
  var comp = sheetToObjects(getSheet('comp_leave_use'), 'comp_leave_use')
    .filter(function (r) { return String(r.date) === d; })
    .map(function (r) { return { staffName: nameOf[r.staffId] || '(不明)', hours: Number(r.hours) || 0, note: r.note || '' }; });
  return { success: true, data: { shifts: shifts, leave: leave, comp: comp } };
}

// --- ハンドラー：有給休暇 ---
function handleGetLeave(staffId) {
  const sheet = getSheet('leave');
  const records = dedupeById_(sheetToObjects(sheet, 'leave').filter(function (r) { return String(r.staffId) === String(staffId); }));
  records.forEach(function (r) { r.days = Number(r.days) || 0; r.hours = Number(r.hours) || 0; r.status = String(r.status || 'approved'); });
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: records };
}

function handleAddLeave(record) {
  if (!record || !record.id) return { success: false, error: '有給記録が不正です' };
  if (!record.status) record.status = 'approved';
  appendUnique_('leave', record);
  return { success: true };
}

function handleDeleteLeave(id) {
  deleteRowsById_('leave', id); // 同一IDの重複行もまとめて削除（0件でも成功＝冪等）
  return { success: true };
}

// --- ハンドラー：文書 ---
function handleGetDocuments() {
  const records = sheetToObjects(getSheet('documents'), 'documents');
  records.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  return { success: true, data: records };
}

function handleSaveDocument(doc) {
  if (!doc || !doc.id) return { success: false, error: '文書データが不正です' };
  const sheet = getSheet('documents');
  const now = new Date().toISOString();
  const rowIndex = findRowIndex(sheet, 0, doc.id);
  const next = { id: doc.id, type: doc.type, title: doc.title, url: doc.url, createdAt: doc.createdAt || now, updatedAt: now };
  if (rowIndex < 0) {
    sheet.appendRow(objectToRow('documents', next));
  } else {
    const existingCreated = sheet.getRange(rowIndex, colNum('documents', 'createdAt')).getValue();
    next.createdAt = existingCreated || next.createdAt;
    sheet.getRange(rowIndex, 1, 1, colKeys('documents').length).setValues([objectToRow('documents', next)]);
  }
  return { success: true, data: next };
}

function handleDeleteDocument(id) {
  deleteRowsById_('documents', id); // 同一IDの重複行もまとめて削除（0件でも成功＝冪等）
  return { success: true };
}

// ============================================================
// 会計管理（事業予算・経費）
// ============================================================
function handleGetExpenseCategories() {
  const list = sheetToObjects(getSheet('expense_categories'), 'expense_categories')
    .filter(function (c) { return c.id; })
    .map(function (c) { return { id: String(c.id), name: String(c.name), order: Number(c.order) || 0 }; });
  return { success: true, data: list };
}
function handleSaveExpenseCategories(categories) {
  const sheet = getSheet('expense_categories');
  const labels = colLabels('expense_categories');
  const ncol = labels.length;
  sheet.clearContents();
  sheet.getRange(1, 1, sheet.getMaxRows(), ncol).setNumberFormat('@');
  sheet.getRange(1, 1, 1, ncol).setValues([labels]);
  sheet.setFrozenRows(1);
  const list = categories || [];
  if (list.length) {
    const rows = list.map(function (c) { return objectToRow('expense_categories', c); });
    sheet.getRange(2, 1, rows.length, ncol).setValues(rows);
  }
  return { success: true, data: { saved: list.length } };
}

function handleGetBudgets(fiscalYear) {
  const records = sheetToObjects(getSheet('budgets'), 'budgets').filter(function (b) {
    return Number(b.fiscalYear) === Number(fiscalYear);
  });
  records.forEach(function (b) { b.fiscalYear = Number(b.fiscalYear) || 0; b.amount = Number(b.amount) || 0; });
  return { success: true, data: records };
}
// 指定年度の予算を丸ごと置換
function handleSaveBudgets(fiscalYear, records) {
  const sheet = getSheet('budgets');
  const ncol = colKeys('budgets').length;
  const data = sheet.getDataRange().getValues();
  const kept = [];
  for (let i = 1; i < data.length; i++) {
    if (Number(data[i][1]) === Number(fiscalYear)) continue;
    kept.push(data[i].slice(0, ncol));
  }
  const newRows = (records || []).map(function (r) { return objectToRow('budgets', r); });
  replaceSheetRows_('budgets', kept.concat(newRows)); // 全消去せず置換（保存中に空が読まれるのを防ぐ）
  return { success: true };
}

function normalizeExpense_(e) {
  e.fiscalYear = Number(e.fiscalYear) || 0;
  e.amount = Number(e.amount) || 0;
  e.status = String(e.status || 'requested');
  return e;
}
function handleGetExpenses(fiscalYear) {
  const records = dedupeById_(sheetToObjects(getSheet('expenses'), 'expenses')
    .filter(function (e) { return Number(e.fiscalYear) === Number(fiscalYear); })
    .map(normalizeExpense_));
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: records };
}
function handleAddExpense(record) {
  if (!record || !record.id) return { success: false, error: '経費データが不正です' };
  if (!record.status) record.status = 'approved';
  appendUnique_('expenses', record);
  return { success: true };
}
function handleSetExpenseStatus(id, status) {
  const sheet = getSheet('expenses');
  const rows = findAllRowIndexes_(sheet, 0, id); // 重複行があっても状態が食い違わないよう全行更新
  if (!rows.length) return { success: false, error: '経費が見つかりません' };
  const col = colNum('expenses', 'status');
  rows.forEach(function (r) { sheet.getRange(r, col).setValue(status); });
  return { success: true };
}
function handleDeleteExpense(id) {
  deleteRowsById_('expenses', id); // 同一IDの重複行もまとめて削除（0件でも成功＝冪等）
  return { success: true };
}

// 従業員：申請フォーム用の年度コンテキスト（事業/費目と残額。個別経費は返さない）
function handleGetExpenseContext(fiscalYear) {
  const cats = handleGetExpenseCategories().data;
  const budgets = handleGetBudgets(fiscalYear).data;
  const expenses = sheetToObjects(getSheet('expenses'), 'expenses')
    .filter(function (e) { return Number(e.fiscalYear) === Number(fiscalYear) && String(e.status) === 'approved'; })
    .map(normalizeExpense_);
  const usedOf = function (project, categoryId) {
    return expenses.reduce(function (s, e) {
      return (e.project === project && String(e.categoryId) === String(categoryId)) ? s + e.amount : s;
    }, 0);
  };
  const lines = budgets.map(function (b) {
    const used = usedOf(b.project, b.categoryId);
    return { project: b.project, categoryId: String(b.categoryId), budget: b.amount, used: used, remaining: b.amount - used };
  });
  return { success: true, data: { categories: cats, lines: lines } };
}
function handleGetMyExpenses(session) {
  const staff = staffOf_(session);
  const records = sheetToObjects(getSheet('expenses'), 'expenses')
    .filter(function (e) { return String(e.staffId) === staff.id; })
    .map(normalizeExpense_);
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: records };
}
// 従業員の経費申請（status=requested、申請者=セッションのstaffId）
function handleAddMyExpense(session, record) {
  const staff = staffOf_(session);
  if (!record || !record.date) return { success: false, error: '申請内容が不正です' };
  const rec = {
    id: record.id || genId('ex'), fiscalYear: Number(record.fiscalYear) || 0, staffId: staff.id,
    date: record.date, project: record.project || '', categoryId: record.categoryId || '',
    amount: Number(record.amount) || 0, description: record.description || '',
    status: 'requested', note: '',
  };
  appendUnique_('expenses', rec);
  return { success: true };
}

// 管理者：休暇申請の承認/却下
function handleSetLeaveStatus(id, status) {
  const sheet = getSheet('leave');
  const rows = findAllRowIndexes_(sheet, 0, id); // 重複行があっても状態が食い違わないよう全行更新
  if (!rows.length) return { success: false, error: '有給記録が見つかりません' };
  const col = colNum('leave', 'status');
  rows.forEach(function (r) { sheet.getRange(r, col).setValue(status); });
  return { success: true };
}

// ============================================================
// 従業員（staff）自分用ハンドラー。session.staffId のデータのみ操作する。
// ============================================================
function staffOf_(session) {
  const id = session && session.staffId;
  if (!id) throw new Error('従業員のログインが必要です');
  const staff = sheetToObjects(getSheet('staff'), 'staff').find(function (s) { return s.id === id; });
  if (!staff) throw new Error('職員が見つかりません');
  return staff;
}
function stripStaff_(s) {
  const out = {}; Object.keys(s).forEach(function (k) { if (k !== 'passwordHash') out[k] = s[k]; });
  out.hourlyWage = Number(out.hourlyWage) || 0;
  out.monthlyHourLimit = Number(out.monthlyHourLimit) || 0;
  return out;
}

function handleStaffLogin(employeeNumber, password) {
  const num = String(employeeNumber || '').trim();
  if (!num) return { success: false, error: '職員番号を入力してください' };
  const staff = sheetToObjects(getSheet('staff'), 'staff').find(function (s) {
    return String(s.employeeNumber || '').trim() === num;
  });
  if (!staff || staff.status === 'retired') return { success: false, error: '職員番号またはパスワードが正しくありません' };
  if (!staff.passwordHash || String(staff.passwordHash) !== hashPassword(password)) {
    return { success: false, error: '職員番号またはパスワードが正しくありません' };
  }
  return { success: true, token: issueToken('staff', staff.id), role: 'staff', staff: stripStaff_(staff) };
}

function handleGetMyProfile(session) {
  return { success: true, data: stripStaff_(staffOf_(session)) };
}

function handleGetMyAttendance(session, month) {
  const staff = staffOf_(session);
  const records = sheetToObjects(getSheet('attendance'), 'attendance').filter(function (r) {
    return String(r.staffId) === staff.id && String(r.date).slice(0, 7) === month;
  });
  records.forEach(function (r) { r.breakMinutes = Number(r.breakMinutes) || 0; });
  return { success: true, data: records };
}

// 打刻（出勤=in / 退勤=out）。サーバー時刻で当日レコードを更新。
function handlePunch(session, punchType) {
  const staff = staffOf_(session);
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const now = Utilities.formatDate(new Date(), tz, 'HH:mm');
  const sheet = getSheet('attendance');
  const ncol = colKeys('attendance').length;

  // 生値の日付を yyyy-MM-dd に整形して比較（旧データで日付がDate化していても照合できる）
  const data = sheet.getDataRange().getValues();
  const ymd = function (v) {
    return (Object.prototype.toString.call(v) === '[object Date]')
      ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v == null ? '' : v).trim();
  };
  // 当日・当該職員の行をすべて集める（重複があれば統合する）
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === staff.id && ymd(data[i][2]) === today) rows.push(i + 1);
  }

  // 既存の（整形済み）当日レコードから開始・終了を引き継ぐ
  const objs = sheetToObjects(sheet, 'attendance').filter(function (r) {
    return String(r.staffId) === staff.id && String(r.date) === today;
  });
  const firstOf = function (key) { for (let j = 0; j < objs.length; j++) { if (objs[j][key]) return objs[j][key]; } return ''; };
  const rec = {
    id: staff.id + '_' + today, staffId: staff.id, date: today, dayType: 'work',
    startTime: firstOf('startTime'), endTime: firstOf('endTime'),
    breakMinutes: Number(firstOf('breakMinutes')) || 0, note: firstOf('note'),
    breakStart: firstOf('breakStart'), breakEnd: firstOf('breakEnd'),
  };
  if (punchType === 'in') rec.startTime = now; else rec.endTime = now;

  const target = rows.length ? rows[0] : sheet.getLastRow() + 1;
  sheet.getRange(target, 1, 1, ncol).setNumberFormat('@'); // テキスト書式で保存（時刻の自動変換を防ぐ）
  sheet.getRange(target, 1, 1, ncol).setValues([objectToRow('attendance', rec)]);
  // 重複行（2件目以降）を削除。行番号の大きい方から消す。
  for (let k = rows.length - 1; k >= 1; k--) sheet.deleteRow(rows[k]);

  return { success: true, data: { date: today, time: now, punchType: punchType } };
}

// 従業員が当日の休憩を時刻（開始〜終了）で保存する。休憩分＝終了−開始 を計算。
// 当日レコードの休憩のみ更新（出退勤・区分は保持）。
function handleSetMyBreak(session, breakStart, breakEnd) {
  const staff = staffOf_(session);
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const sheet = getSheet('attendance');
  const ncol = colKeys('attendance').length;

  const data = sheet.getDataRange().getValues();
  const ymd = function (v) {
    return (Object.prototype.toString.call(v) === '[object Date]')
      ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v == null ? '' : v).trim();
  };
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === staff.id && ymd(data[i][2]) === today) rows.push(i + 1);
  }
  const objs = sheetToObjects(sheet, 'attendance').filter(function (r) {
    return String(r.staffId) === staff.id && String(r.date) === today;
  });
  const firstOf = function (key) { for (let j = 0; j < objs.length; j++) { if (objs[j][key]) return objs[j][key]; } return ''; };
  const bs = String(breakStart || '').trim();
  const be = String(breakEnd || '').trim();
  const mins = breakMinutesBetween_(bs, be);
  const rec = {
    id: staff.id + '_' + today, staffId: staff.id, date: today,
    dayType: firstOf('dayType') || 'work',
    startTime: firstOf('startTime'), endTime: firstOf('endTime'),
    breakMinutes: mins, note: firstOf('note'),
    breakStart: bs, breakEnd: be,
  };
  const target = rows.length ? rows[0] : sheet.getLastRow() + 1;
  sheet.getRange(target, 1, 1, ncol).setNumberFormat('@');
  sheet.getRange(target, 1, 1, ncol).setValues([objectToRow('attendance', rec)]);
  for (let k = rows.length - 1; k >= 1; k--) sheet.deleteRow(rows[k]);

  return { success: true, data: { date: today, breakMinutes: mins, breakStart: bs, breakEnd: be } };
}

// 休憩の時刻範囲（HH:mm〜HH:mm）から休憩分数を求める。両方揃っていないときは 0。
function breakMinutesBetween_(start, end) {
  const re = /^(\d{1,2}):(\d{2})$/;
  const s = re.exec(String(start || '')), e = re.exec(String(end || ''));
  if (!s || !e) return 0;
  const min = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  return min > 0 ? min : 0;
}

// 自分のシフト変更のうち未確認のものを返す（新しい順）
function handleGetMyShiftChanges(session) {
  const staff = staffOf_(session);
  const list = sheetToObjects(getSheet('shift_changes'), 'shift_changes')
    .filter(function (r) { return String(r.staffId) === staff.id && !String(r.readAt || '').trim(); });
  list.sort(function (a, b) { return String(b.changedAt).localeCompare(String(a.changedAt)); });
  return { success: true, data: list.slice(0, 50) };
}

// 自分のシフト変更をすべて確認済みにする
function handleMarkShiftChangesRead(session) {
  const staff = staffOf_(session);
  const sheet = getSheet('shift_changes');
  const data = sheet.getDataRange().getValues();
  const col = colNum('shift_changes', 'readAt');
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== staff.id) continue;
    if (String(data[i][col - 1] || '').trim()) continue; // 既に確認済み
    sheet.getRange(i + 1, col).setValue(now);
  }
  return { success: true };
}

function handleGetMyAvailability(session, month) {
  const staff = staffOf_(session);
  const records = sheetToObjects(getSheet('availability'), 'availability').filter(function (r) {
    return String(r.staffId) === staff.id && String(r.date).slice(0, 7) === month;
  });
  return { success: true, data: records };
}

// 自分の当月希望を置換
function handleSaveMyAvailability(session, month, records) {
  const staff = staffOf_(session);
  const sheet = getSheet('availability');
  const ncol = colKeys('availability').length;
  const data = sheet.getDataRange().getValues();
  const kept = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === staff.id && cellYmd_(data[i][2]).slice(0, 7) === month) continue;
    kept.push(data[i].slice(0, ncol));
  }
  const mine = (records || []).map(function (r) {
    return objectToRow('availability', { id: r.id, staffId: staff.id, date: r.date, patternId: r.patternId });
  });
  const out = [colLabels('availability')].concat(kept).concat(mine);
  sheet.clearContents();
  sheet.getRange(1, 1, sheet.getMaxRows(), ncol).setNumberFormat('@');
  sheet.getRange(1, 1, out.length, ncol).setValues(out);
  sheet.setFrozenRows(1);
  return { success: true };
}

function handleGetMyOvertime(session) {
  const staff = staffOf_(session);
  const records = sheetToObjects(getSheet('overtime'), 'overtime').filter(function (r) { return String(r.staffId) === staff.id; });
  records.forEach(function (r) { r.appliedHours = Number(r.appliedHours) || 0; r.resultHours = Number(r.resultHours) || 0; });
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: records };
}

// 従業員の時間外申請（status=applied、実績・処理は事務局側）
function handleAddMyOvertime(session, record) {
  const staff = staffOf_(session);
  if (!record || !record.date) return { success: false, error: '申請内容が不正です' };
  const rec = {
    id: record.id || genId('ot'), staffId: staff.id, date: record.date,
    kind: record.kind || 'overtime',
    appliedHours: Number(record.appliedHours) || 0, reason: record.reason || '',
    status: 'applied', disposition: '', resultHours: 0, note: '',
    startTime: String(record.startTime || ''), endTime: String(record.endTime || ''),
  };
  appendUnique_('overtime', rec);
  return { success: true };
}

function handleGetMyLeave(session) {
  const staff = staffOf_(session);
  const records = sheetToObjects(getSheet('leave'), 'leave').filter(function (r) { return String(r.staffId) === staff.id; });
  records.forEach(function (r) { r.days = Number(r.days) || 0; r.hours = Number(r.hours) || 0; r.status = String(r.status || 'approved'); });
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: records };
}

// 従業員の休暇申請（kind=use、status=requested）
function handleAddMyLeaveRequest(session, record) {
  const staff = staffOf_(session);
  if (!record || !record.date) return { success: false, error: '申請内容が不正です' };
  const rec = {
    id: record.id || genId('lv'), staffId: staff.id, kind: 'use', date: record.date,
    days: Number(record.days) || 0, hours: Number(record.hours) || 0,
    status: 'requested', note: record.note || '',
    startTime: String(record.startTime || ''), endTime: String(record.endTime || ''),
  };
  appendUnique_('leave', rec);
  return { success: true };
}

function handleStaffChangePassword(session, oldPassword, newPassword) {
  const staff = staffOf_(session);
  if (!newPassword || String(newPassword).length < 4) {
    return { success: false, error: 'パスワードは4文字以上で入力してください' };
  }
  if (!staff.passwordHash || String(staff.passwordHash) !== hashPassword(oldPassword)) {
    return { success: false, error: '現在のパスワードが正しくありません' };
  }
  const sheet = getSheet('staff');
  const rowIndex = findRowIndex(sheet, 0, staff.id);
  sheet.getRange(rowIndex, colNum('staff', 'passwordHash')).setValue(hashPassword(newPassword));
  return { success: true };
}
