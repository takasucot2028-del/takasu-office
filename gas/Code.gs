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
  ] },
  attendance: { name: '勤怠', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['date', '日付'], ['dayType', '区分'],
    ['startTime', '出勤'], ['endTime', '退勤'], ['breakMinutes', '休憩(分)'], ['note', '備考'],
  ] },
  leave: { name: '有給休暇', columns: [
    ['id', 'ID'], ['staffId', '職員ID'], ['kind', '種別'], ['date', '日付'], ['days', '日数'], ['note', '備考'],
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

function issueToken(role) {
  const token = genId() + genId(); // 24文字
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ role: role }), SESSION_TTL_SECONDS);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

// 認可: adminLogin 以外はすべて管理者トークン必須。
var PUBLIC_ACTIONS = { adminLogin: true };
function enforceAuth(action, body) {
  if (PUBLIC_ACTIONS[action]) return;
  const session = getSession(body.token);
  if (!session) throw new Error('認証が必要です。再度ログインしてください');
  if (session.role !== 'admin') throw new Error('管理者権限が必要です');
}

// --- Web App エンドポイント ---
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    enforceAuth(action, body);
    let result;

    switch (action) {
      case 'adminLogin':
        result = handleAdminLogin(body.email, body.password);
        break;
      case 'changePassword':
        result = handleChangePassword(body.oldPassword, body.newPassword);
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

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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
      // 万一 Date 型で入っていた場合は yyyy-MM-dd の文字列へ戻す（通常はテキスト書式のため文字列）。
      obj[k] = (Object.prototype.toString.call(v) === '[object Date]')
        ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
        : (v === null || v === undefined ? '' : v);
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
  return { success: true, data: sheetToObjects(sheet, 'staff') };
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
    sheet.appendRow(objectToRow('staff', next));
  } else {
    // createdAt は既存値を保持
    const existingCreated = sheet.getRange(rowIndex, colNum('staff', 'createdAt')).getValue();
    next.createdAt = existingCreated || staff.createdAt || now;
    const row = objectToRow('staff', next);
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }
  return { success: true, data: next };
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
    const rowDate = String(data[i][2]);
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
  const sheet = getSheet('shift_patterns');
  const labels = colLabels('shift_patterns');
  const ncol = labels.length;
  sheet.clearContents();
  sheet.getRange(1, 1, sheet.getMaxRows(), ncol).setNumberFormat('@');
  sheet.getRange(1, 1, 1, ncol).setValues([labels]);
  sheet.setFrozenRows(1);
  const list = patterns || [];
  if (list.length) {
    const rows = list.map(function (p) { return objectToRow('shift_patterns', p); });
    sheet.getRange(2, 1, rows.length, ncol).setValues(rows);
  }
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
    const rowDate = String(data[i][2]);
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
function handleSaveMonthConfirmed(month, location, records) {
  const sheet = getSheet('shifts_confirmed');
  const ncol = colKeys('shifts_confirmed').length;
  const data = sheet.getDataRange().getValues();
  const kept = [];
  for (let i = 1; i < data.length; i++) {
    const rowDate = String(data[i][2]);
    const rowLoc = String(data[i][3]);
    if (rowDate.slice(0, 7) === month && rowLoc === String(location)) continue;
    kept.push(data[i].slice(0, ncol));
  }
  const newRows = (records || []).map(function (r) { return objectToRow('shifts_confirmed', r); });
  const out = [colLabels('shifts_confirmed')].concat(kept).concat(newRows);
  sheet.clearContents();
  sheet.getRange(1, 1, sheet.getMaxRows(), ncol).setNumberFormat('@');
  sheet.getRange(1, 1, out.length, ncol).setValues(out);
  sheet.setFrozenRows(1);
  return { success: true };
}

// --- ハンドラー：有給休暇 ---
function handleGetLeave(staffId) {
  const sheet = getSheet('leave');
  const records = sheetToObjects(sheet, 'leave').filter(function (r) { return String(r.staffId) === String(staffId); });
  records.forEach(function (r) { r.days = Number(r.days) || 0; });
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { success: true, data: records };
}

function handleAddLeave(record) {
  if (!record || !record.id) return { success: false, error: '有給記録が不正です' };
  const sheet = getSheet('leave');
  sheet.appendRow(objectToRow('leave', record));
  return { success: true };
}

function handleDeleteLeave(id) {
  const sheet = getSheet('leave');
  const rowIndex = findRowIndex(sheet, 0, id);
  if (rowIndex < 0) return { success: false, error: '有給記録が見つかりません' };
  sheet.deleteRow(rowIndex);
  return { success: true };
}
