/* ui.js
 * Всё, что трогает DOM: обновление карточек, кольца прогресса,
 * таблицы истории, графика статистики, модального окна и вкладок.
 * Ничего не знает о том, КАК считается время — только КАК это показать.
 * Логика/обработчики действий (старт дня, перерыв и т.д.) передаются
 * снаружи (из app.js) через объект `controller`.
 */

const RING_RADIUS = 112;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DEPARTURE_OFFSETS = [
  { minutes: 8 * 60, label: 'Уход через 8 ч' },
  { minutes: 8 * 60 + 30, label: 'Уход через 8 ч 30 мин' },
  { minutes: 9 * 60, label: 'Уход через 9 ч' }
];
const MONTH_LABELS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const UI = {
  el: {},
  controller: null,

  init(controller) {
    this.controller = controller;
    this.cacheEls();
    this.initTabs();
    this.initThemeToggle();
    this.initSettingsModal();
    this.initArrivalCalculator();
  },

  cacheEls() {
    this.el = {
      liveDate: document.getElementById('liveDate'),
      liveTime: document.getElementById('liveTime'),
      themeToggle: document.getElementById('themeToggle'),
      settingsBtn: document.getElementById('settingsBtn'),

      arrivalTimeInput: document.getElementById('arrivalTimeInput'),
      arrivalPickBtn: document.getElementById('arrivalPickBtn'),
      departureResults: document.getElementById('departureResults'),

      heroStatus: document.getElementById('heroStatus'),
      ringProgress: document.getElementById('ringProgress'),
      ringCountdown: document.getElementById('ringCountdown'),
      ringCaption: document.getElementById('ringCaption'),
      heroProgressLabel: document.getElementById('heroProgressLabel'),
      heroActions: document.getElementById('heroActions'),

      cardStart: document.getElementById('cardStart'),
      cardEnd: document.getElementById('cardEnd'),
      cardWorkLen: document.getElementById('cardWorkLen'),
      cardBreakLen: document.getElementById('cardBreakLen'),
      cardElapsed: document.getElementById('cardElapsed'),
      cardRemaining: document.getElementById('cardRemaining'),

      historyWrap: document.getElementById('historyWrap'),
      statsSummary: document.getElementById('statsSummary'),
      barChart: document.getElementById('barChart'),

      settingsOverlay: document.getElementById('settingsOverlay'),
      settingsCloseBtn: document.getElementById('settingsCloseBtn'),
      settingsCancelBtn: document.getElementById('settingsCancelBtn'),
      settingsSaveBtn: document.getElementById('settingsSaveBtn'),
      inputStartTime: document.getElementById('inputStartTime'),
      inputWorkHours: document.getElementById('inputWorkHours'),
      inputBreakMinutes: document.getElementById('inputBreakMinutes'),
      daysRow: document.getElementById('daysRow'),

      toast: document.getElementById('toast')
    };
  },

  // ---------------- Вкладки ----------------
  initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');

        if (btn.dataset.tab === 'history') this.renderHistory();
        if (btn.dataset.tab === 'stats') this.renderStats();
      });
    });
  },

  // ---------------- Тема ----------------
  initThemeToggle() {
    const applyTheme = (theme) => {
      document.body.setAttribute('data-theme', theme);
      this.el.themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
    };
    applyTheme(Storage.loadTheme());

    this.el.themeToggle.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });
  },

  // ---------------- Настройки ----------------
  initSettingsModal() {
    const open = () => {
      const s = Storage.loadSettings();
      this.el.inputStartTime.value = s.startTime;
      this.el.inputWorkHours.value = s.workHours;
      this.el.inputBreakMinutes.value = s.breakMinutes;
      this.renderDayChips(s.workDays);
      this.el.settingsOverlay.classList.add('open');
    };
    const close = () => this.el.settingsOverlay.classList.remove('open');

    this.el.settingsBtn.addEventListener('click', open);
    this.el.settingsCloseBtn.addEventListener('click', close);
    this.el.settingsCancelBtn.addEventListener('click', close);
    this.el.settingsOverlay.addEventListener('click', (e) => {
      if (e.target === this.el.settingsOverlay) close();
    });

    this.el.settingsSaveBtn.addEventListener('click', () => {
      const workDays = Array.from(
        this.el.daysRow.querySelectorAll('input[type=checkbox]:checked')
      ).map((cb) => Number(cb.value));

      const settings = {
        startTime: this.el.inputStartTime.value || '09:00',
        workHours: Number(this.el.inputWorkHours.value) || 8,
        breakMinutes: Number(this.el.inputBreakMinutes.value) || 0,
        workDays: workDays.length ? workDays : [1, 2, 3, 4, 5]
      };
      this.controller.onSaveSettings(settings);
      close();
      this.showToast('Настройки сохранены');
    });
  },

  renderDayChips(selectedDays) {
    // 0=вс, 1=пн ... порядок отображения делаем Пн..Вс, привычный для РФ
    const order = [1, 2, 3, 4, 5, 6, 0];
    this.el.daysRow.innerHTML = order
      .map((dow) => {
        const checked = selectedDays.includes(dow) ? 'checked' : '';
        return `
          <label class="day-chip">
            <input type="checkbox" value="${dow}" ${checked}>
            <span>${DAY_LABELS[dow]}</span>
          </label>`;
      })
      .join('');
  },

  // ---------------- Калькулятор времени ухода (Главная) ----------------
  initArrivalCalculator() {
    const input = this.el.arrivalTimeInput;

    // Восстанавливаем последнее введённое время прихода.
    const saved = Storage.loadArrivalInput();
    if (saved) {
      input.value = saved;
      this.renderDepartureResults(saved);
    }

    input.addEventListener('input', () => {
      Storage.saveArrivalInput(input.value);
      this.renderDepartureResults(input.value);
    });

    // Кнопка "Выбрать" — открывает нативный пикер часов/минут.
    // showPicker() работает в Chrome/Edge/Android; там, где его нет
    // (Safari), просто ставим фокус — тап по полю на мобильном сам
    // откроет системное колесо выбора времени.
    this.el.arrivalPickBtn.addEventListener('click', () => {
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          return;
        } catch (e) {
          // падать не должно, но на всякий случай — просто фокусируемся
        }
      }
      input.focus();
      input.click();
    });
  },

  renderDepartureResults(arrivalTimeStr) {
    if (!arrivalTimeStr) {
      this.el.departureResults.innerHTML =
        `<div class="departure-empty">Введите время прихода, чтобы увидеть варианты времени ухода.</div>`;
      return;
    }

    this.el.departureResults.innerHTML = DEPARTURE_OFFSETS.map((offset) => {
      const result = Timer.addMinutesToTimeString(arrivalTimeStr, offset.minutes);
      return `
        <div class="departure-card">
          <div class="duration-label">${offset.label}</div>
          <div class="duration-value">${result.time}</div>
          ${result.nextDay ? '<div class="next-day-note">на следующий день</div>' : ''}
        </div>`;
    }).join('');
  },

  // ---------------- Часы в шапке ----------------
  renderClock(now = new Date()) {
    this.el.liveTime.textContent = Timer.formatClock(now);
    this.el.liveDate.textContent = `${now.getDate()} ${MONTH_LABELS[now.getMonth()]}, ${DAY_LABELS[now.getDay()]}`;
  },

  // ---------------- Кольцо прогресса ----------------
  setRing(progressPercent, statusClass) {
    const offset = RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, progressPercent)) / 100);
    this.el.ringProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
    this.el.ringProgress.style.strokeDashoffset = `${offset}`;
    this.el.ringProgress.setAttribute('class', `ring-progress ${statusClass}`);
  },

  // ---------------- Кнопки действий ----------------
  renderActions(snapshot) {
    const { controller } = this;
    let html = '';

    switch (snapshot.status) {
      case 'idle':
      case 'ready':
        html = `<button class="btn btn-primary" id="btnStart">Начать рабочий день</button>`;
        break;
      case 'day-off':
        html = `<button class="btn btn-primary" id="btnStart">Начать рабочий день</button>`;
        break;
      case 'working':
        html = `
          <button class="btn btn-secondary" id="btnBreak">Начать перерыв</button>
          <button class="btn btn-danger" id="btnFinish">Завершить рабочий день</button>`;
        break;
      case 'break':
        html = `<button class="btn btn-success" id="btnEndBreak">Закончить перерыв</button>
                <button class="btn btn-danger" id="btnFinish">Завершить рабочий день</button>`;
        break;
      case 'finished':
        html = `<button class="btn btn-secondary" disabled>Рабочий день завершён</button>`;
        break;
    }

    this.el.heroActions.innerHTML = html;

    const bind = (id, fn) => {
      const node = document.getElementById(id);
      if (node) node.addEventListener('click', fn);
    };
    bind('btnStart', () => controller.onStartDay());
    bind('btnBreak', () => controller.onStartBreak());
    bind('btnEndBreak', () => controller.onEndBreak());
    bind('btnFinish', () => controller.onFinishDay());
  },

  // ---------------- Главный экран целиком ----------------
  renderHero(snapshot) {
    const s = snapshot.settings;
    const plannedEndLabel = (() => {
      if (snapshot.state) return new Date(snapshot.state.plannedEndAt);
      const [h, m] = s.startTime.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return new Date(d.getTime() + s.workHours * 3600000 + s.breakMinutes * 60000);
    })();

    switch (snapshot.status) {
      case 'day-off': {
        this.el.heroStatus.textContent = 'Сегодня не рабочий день';
        this.el.heroStatus.className = 'hero-status';
        this.setRing(0, '');
        this.el.ringCountdown.textContent = '—:—:—';
        this.el.ringCaption.textContent = 'По расписанию сегодня выходной';
        this.el.heroProgressLabel.innerHTML = 'Прогресс рабочего дня: <strong>0%</strong>';
        break;
      }
      case 'idle': {
        this.el.heroStatus.textContent = 'Рабочий день ещё не начался';
        this.el.heroStatus.className = 'hero-status';
        this.setRing(0, '');
        this.el.ringCountdown.textContent = Timer.formatHMS(snapshot.msUntilStart);
        this.el.ringCaption.textContent = `До начала в ${s.startTime}`;
        this.el.heroProgressLabel.innerHTML = 'Прогресс рабочего дня: <strong>0%</strong>';
        break;
      }
      case 'ready': {
        this.el.heroStatus.textContent = 'Готово к началу рабочего дня';
        this.el.heroStatus.className = 'hero-status';
        this.setRing(0, '');
        this.el.ringCountdown.textContent = '00:00:00';
        this.el.ringCaption.textContent = 'Нажмите «Начать рабочий день»';
        this.el.heroProgressLabel.innerHTML = 'Прогресс рабочего дня: <strong>0%</strong>';
        break;
      }
      case 'working': {
        const overtime = snapshot.isOvertime;
        this.el.heroStatus.textContent = overtime ? 'Переработка' : 'Идёт рабочий день';
        this.el.heroStatus.className = `hero-status ${overtime ? 'state-overtime' : 'state-working'}`;
        this.setRing(snapshot.progress, overtime ? 'state-overtime' : '');
        this.el.ringCountdown.textContent = Timer.formatHMS(snapshot.remainingMs);
        this.el.ringCaption.textContent = overtime ? 'Времени сверх плана' : 'Осталось рабочего времени';
        this.el.heroProgressLabel.innerHTML = `Прогресс рабочего дня: <strong>${Math.round(snapshot.progress)}%</strong>`;
        break;
      }
      case 'break': {
        this.el.heroStatus.textContent = 'Перерыв';
        this.el.heroStatus.className = 'hero-status state-break';
        this.setRing(snapshot.progress, 'state-break');
        this.el.ringCountdown.textContent = Timer.formatHMS(snapshot.breakElapsedMs);
        this.el.ringCaption.textContent = 'Длительность перерыва';
        this.el.heroProgressLabel.innerHTML = `Прогресс рабочего дня: <strong>${Math.round(snapshot.progress)}%</strong>`;
        break;
      }
      case 'finished': {
        this.el.heroStatus.textContent = 'Рабочий день завершён 🎉';
        this.el.heroStatus.className = 'hero-status state-finished';
        this.setRing(100, 'state-finished');
        this.el.ringCountdown.textContent = Timer.formatHMS(snapshot.workedMs);
        this.el.ringCaption.textContent = 'Вы отработали сегодня';
        this.el.heroProgressLabel.innerHTML = 'Прогресс рабочего дня: <strong>100%</strong>';
        break;
      }
    }

    // Карточки
    const state = snapshot.state;
    this.el.cardStart.textContent = state ? Timer.formatClock(new Date(state.startedAt)).slice(0, 5) : s.startTime;
    this.el.cardEnd.textContent = Timer.formatClock(plannedEndLabel).slice(0, 5);
    this.el.cardWorkLen.textContent = Timer.formatHoursMinutes(s.workHours * 3600000);
    this.el.cardBreakLen.textContent = `${Math.floor(s.breakMinutes / 60)} ч ${String(s.breakMinutes % 60).padStart(2, '0')} мин`;

    if (snapshot.status === 'working' || snapshot.status === 'break') {
      this.el.cardElapsed.textContent = Timer.formatHoursMinutes(snapshot.elapsedMs);
      this.el.cardRemaining.textContent = Timer.formatHoursMinutes(snapshot.remainingMs);
    } else if (snapshot.status === 'finished') {
      this.el.cardElapsed.textContent = Timer.formatHoursMinutes(snapshot.workedMs);
      this.el.cardRemaining.textContent = '0 ч 00 мин';
    } else {
      this.el.cardElapsed.textContent = '0 ч 00 мин';
      this.el.cardRemaining.textContent = Timer.formatHoursMinutes(s.workHours * 3600000);
    }

    this.renderActions(snapshot);
  },

  // ---------------- История ----------------
  renderHistory() {
    const history = Storage.loadHistory();
    if (history.length === 0) {
      this.el.historyWrap.innerHTML = `<div class="empty-state">Пока нет завершённых рабочих дней.<br>Начните день на вкладке «Главная».</div>`;
      return;
    }

    const rows = history
      .map((e) => `
        <tr>
          <td>${this.formatDateLabel(e.date)}</td>
          <td class="mono">${e.start}</td>
          <td class="mono">${e.end}</td>
          <td class="mono">${Timer.formatHoursMinutes(e.workedMs)}</td>
          <td><span class="status-chip">${e.status}</span></td>
        </tr>`)
      .join('');

    this.el.historyWrap.innerHTML = `
      <table class="history-table">
        <thead>
          <tr><th>Дата</th><th>Начало</th><th>Окончание</th><th>Отработано</th><th>Статус</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  formatDateLabel(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  },

  // ---------------- Статистика ----------------
  renderStats() {
    const history = Storage.loadHistory();
    const stats = Statistics.calculate(history);

    if (stats.count === 0) {
      this.el.statsSummary.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Статистика появится после первого завершённого рабочего дня.</div>`;
      this.el.barChart.innerHTML = '';
      return;
    }

    this.el.statsSummary.innerHTML = `
      <div class="stat-card"><div class="label">Рабочих дней</div><div class="value">${stats.count}</div></div>
      <div class="stat-card"><div class="label">Всего отработано</div><div class="value">${Timer.formatHoursMinutes(stats.totalWorkedMs)}</div></div>
      <div class="stat-card"><div class="label">В среднем за день</div><div class="value">${Timer.formatHoursMinutes(stats.avgWorkedMs)}</div></div>
      <div class="stat-card"><div class="label">Среднее начало</div><div class="value">${stats.avgStart}</div></div>
      <div class="stat-card"><div class="label">Самый длинный день</div><div class="value">${Timer.formatHoursMinutes(stats.longestDay.workedMs)}</div></div>
      <div class="stat-card"><div class="label">Самый короткий день</div><div class="value">${Timer.formatHoursMinutes(stats.shortestDay.workedMs)}</div></div>
    `;

    const days = Statistics.recentDays(history, 14);
    const maxMs = Math.max(...days.map((d) => d.workedMs), 1);

    this.el.barChart.innerHTML = days
      .map((d) => {
        const heightPct = Math.max(4, Math.round((d.workedMs / maxMs) * 100));
        const [, m, day] = d.date.split('-');
        return `
          <div class="bar-col">
            <div class="bar" style="height:${heightPct}%" title="${this.formatDateLabel(d.date)}: ${Timer.formatHoursMinutes(d.workedMs)}"></div>
            <div class="bar-label">${day}.${m}</div>
          </div>`;
      })
      .join('');
  },

  // ---------------- Тосты ----------------
  showToast(message, durationMs = 2600) {
    this.el.toast.textContent = message;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), durationMs);
  }
};
