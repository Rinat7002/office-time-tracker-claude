/* storage.js
 * Единственная точка доступа к localStorage.
 * Ничего не знает про DOM и про то, как считается время —
 * просто кладёт и достаёт данные.
 */

const STORAGE_KEYS = {
  SETTINGS: 'ott_settings',
  DAY_STATE: 'ott_day_state',
  HISTORY: 'ott_history',
  THEME: 'ott_theme',
  ARRIVAL_INPUT: 'ott_arrival_input'
};

const DEFAULT_SETTINGS = {
  startTime: '09:00',      // "HH:MM"
  workHours: 8,            // часы
  breakMinutes: 60,        // минуты
  workDays: [1, 2, 3, 4, 5] // 0=вс ... 6=сб (ISO-подобно, но 0=вс как в Date.getDay())
};

function safeParse(json, fallback) {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    console.warn('storage: не удалось распарсить JSON, использую значение по умолчанию', e);
    return fallback;
  }
}

const Storage = {
  // ---------- Настройки ----------
  loadSettings() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEYS.SETTINGS), {});
    return { ...DEFAULT_SETTINGS, ...stored };
  },

  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  // ---------- Состояние текущего рабочего дня ----------
  // Формат:
  // {
  //   status: 'idle' | 'working' | 'break' | 'finished',
  //   dateKey: '2026-08-30',
  //   startedAt: <timestamp ms> | null,
  //   plannedEndAt: <timestamp ms> | null,
  //   breaks: [{ start: ms, end: ms|null }],
  //   finishedAt: <timestamp ms> | null
  // }
  loadDayState() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.DAY_STATE), null);
  },

  saveDayState(state) {
    localStorage.setItem(STORAGE_KEYS.DAY_STATE, JSON.stringify(state));
  },

  clearDayState() {
    localStorage.removeItem(STORAGE_KEYS.DAY_STATE);
  },

  // ---------- История ----------
  loadHistory() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.HISTORY), []);
  },

  saveHistory(history) {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  },

  appendHistoryEntry(entry) {
    const history = this.loadHistory();
    history.unshift(entry); // новые дни сверху
    this.saveHistory(history);
    return history;
  },

  // ---------- Время прихода (калькулятор на главном экране) ----------
  loadArrivalInput() {
    return localStorage.getItem(STORAGE_KEYS.ARRIVAL_INPUT) || '';
  },

  saveArrivalInput(value) {
    localStorage.setItem(STORAGE_KEYS.ARRIVAL_INPUT, value);
  },

  // ---------- Тема ----------
  loadTheme() {
    return localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
  },

  saveTheme(theme) {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }
};
