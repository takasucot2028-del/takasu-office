// 事務局側の表示設定（この端末のブラウザに保存する）
//
// 業務データではなく「どの警告を出すか」といった見た目の好みなので、
// スプレッドシートには持たせずローカルに保存する。

const KEY = 'tof_admin_prefs';

export interface AdminPrefs {
  /** ダッシュボードに「年5日の年休取得が未達の職員」を表示するか */
  showLeaveObligation: boolean;
}

const DEFAULTS: AdminPrefs = {
  showLeaveObligation: false,
};

export function getPrefs(): AdminPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AdminPrefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setPref<K extends keyof AdminPrefs>(key: K, value: AdminPrefs[K]): AdminPrefs {
  const next = { ...getPrefs(), [key]: value };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
