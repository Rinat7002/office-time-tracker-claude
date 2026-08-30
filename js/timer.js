/* timer.js
 * Вся арифметика времени и переходы между состояниями рабочего дня.
 * Ничего не знает про DOM (это дело ui.js) и хранит состояние через storage.js.
 *
 * Состояния: 'idle' (день не начат) -> 'working' -> 'break' -> 'working' -> ...
 *            -> 'finished'
 *
 * Важно: чтобы таймер не "плыл" и не терял точность при сворачивании вкладки,
 * мы никогда не уменьшаем секунды сами по себе. Вместо этого каждую секунду
 * заново считаем разницу между Date.now() и целевыми метками времени,
 * которые лежат в localStorage.
 */

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseTimeToToday(hhmm, baseDate = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function formatHMS(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatHoursMinutes(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h} ч ${String(m).padStart(2, '0')} мин`;
}

function formatClock(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const Timer = {
  todayKey,
  formatHMS,
  formatHoursMinutes,
  formatClock,

  /**
   * Прибавляет минуты к времени в формате "HH:MM" по циферблату (0-23ч),
   * с переносом через полночь. Возвращает { time: "HH:MM", nextDay: bool }.
   */
  addMinutesToTimeString(hhmm, minutesToAdd) {
    const [h, m] = hhmm.split(':').map(Number);
    const totalMinutes = h * 60 + m + minutesToAdd;
    const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
    const nextDay = totalMinutes >= 1440;
    const outH = Math.floor(wrapped / 60);
    const outM = wrapped % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return { time: `${pad(outH)}:${pad(outM)}`, nextDay };
  },

  /** Плановое время окончания = начало + рабочее время + перерыв. */
  calculateEndTime(startedAtMs, settings) {
    return startedAtMs + settings.workHours * 3600000 + settings.breakMinutes * 60000;
  },

  /** Сколько чистого рабочего времени запланировано (без перерыва), в мс. */
  plannedWorkMs(settings) {
    return settings.workHours * 3600000;
  },

  plannedTotalMs(settings) {
    return settings.workHours * 3600000 + settings.breakMinutes * 60000;
  },

  /** Возвращает актуальное состояние дня, сбрасывая его, если наступил новый день. */
  getState() {
    const state = Storage.loadDayState();
    if (!state) return null;
    if (state.dateKey !== todayKey()) {
      // Новый день — старое состояние в историю (если день не был завершён,
      // просто отбрасываем) и начинаем с чистого листа.
      Storage.clearDayState();
      return null;
    }
    return state;
  },

  isWorkDayToday(settings) {
    const dow = new Date().getDay();
    return settings.workDays.includes(dow);
  },

  startWorkDay() {
    const settings = Storage.loadSettings();
    const now = Date.now();
    const state = {
      status: 'working',
      dateKey: todayKey(),
      startedAt: now,
      plannedEndAt: this.calculateEndTime(now, settings),
      breaks: [],
      finishedAt: null,
      notified: {} // какие уведомления уже показывали, чтобы не дублировать
    };
    Storage.saveDayState(state);
    return state;
  },

  startBreak() {
    const state = this.getState();
    if (!state || state.status !== 'working') return state;
    state.status = 'break';
    state.breaks.push({ start: Date.now(), end: null });
    Storage.saveDayState(state);
    return state;
  },

  endBreak() {
    const state = this.getState();
    if (!state || state.status !== 'break') return state;
    const last = state.breaks[state.breaks.length - 1];
    if (last && last.end === null) last.end = Date.now();
    state.status = 'working';
    Storage.saveDayState(state);
    return state;
  },

  finishWorkDay() {
    const state = this.getState();
    if (!state) return null;
    // если завершаем прямо во время перерыва — закрываем и его
    if (state.status === 'break') {
      const last = state.breaks[state.breaks.length - 1];
      if (last && last.end === null) last.end = Date.now();
    }
    state.status = 'finished';
    state.finishedAt = Date.now();
    Storage.saveDayState(state);

    // Считаем фактические цифры и пишем запись в историю
    const totalBreakMs = state.breaks.reduce(
      (sum, b) => sum + ((b.end || Date.now()) - b.start),
      0
    );
    const totalElapsedMs = state.finishedAt - state.startedAt;
    const workedMs = Math.max(0, totalElapsedMs - totalBreakMs);
    const settings = Storage.loadSettings();

    const startDate = new Date(state.startedAt);
    const endDate = new Date(state.finishedAt);

    Storage.appendHistoryEntry({
      date: state.dateKey,
      start: formatClock(startDate).slice(0, 5),
      end: formatClock(endDate).slice(0, 5),
      plannedMs: this.plannedWorkMs(settings),
      workedMs,
      breakMs: totalBreakMs,
      status: 'Завершён'
    });

    return state;
  },

  /** Суммарное время перерыва, уже потраченное (включая текущий, если он идёт). */
  breakElapsedMs(state) {
    if (!state) return 0;
    return state.breaks.reduce((sum, b) => sum + ((b.end || Date.now()) - b.start), 0);
  },

  /**
   * Главный расчёт "на сейчас": возвращает всё, что нужно интерфейсу,
   * не трогая DOM.
   */
  computeSnapshot() {
    const settings = Storage.loadSettings();
    const state = this.getState();
    const now = Date.now();

    if (!state) {
      const startTarget = parseTimeToToday(settings.startTime, new Date(now));
      const isWorkDay = this.isWorkDayToday(settings);
      if (isWorkDay && startTarget > now) {
        return {
          status: 'idle',
          settings,
          msUntilStart: startTarget - now,
          progress: 0
        };
      }
      return {
        status: isWorkDay ? 'ready' : 'day-off',
        settings,
        progress: 0
      };
    }

    const plannedTotal = this.plannedTotalMs(settings);
    const elapsedTotal = now - state.startedAt;
    const remainingTotal = state.plannedEndAt - now;

    if (state.status === 'finished') {
      const totalBreakMs = this.breakElapsedMs(state);
      const workedMs = Math.max(0, (state.finishedAt - state.startedAt) - totalBreakMs);
      return {
        status: 'finished',
        settings,
        state,
        workedMs,
        breakMs: totalBreakMs,
        progress: 100
      };
    }

    const progress = Math.min(100, Math.max(0, (elapsedTotal / plannedTotal) * 100));

    if (state.status === 'break') {
      const currentBreak = state.breaks[state.breaks.length - 1];
      return {
        status: 'break',
        settings,
        state,
        progress,
        remainingMs: Math.max(0, remainingTotal),
        breakElapsedMs: now - currentBreak.start,
        elapsedMs: Math.max(0, elapsedTotal),
        breakTotalMs: this.breakElapsedMs(state)
      };
    }

    // working
    return {
      status: 'working',
      settings,
      state,
      progress,
      remainingMs: Math.max(0, remainingTotal),
      elapsedMs: Math.max(0, elapsedTotal),
      breakTotalMs: this.breakElapsedMs(state),
      isOvertime: remainingTotal <= 0
    };
  }
};
