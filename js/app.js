/* app.js
 * Точка входа. Собирает timer.js + storage.js + ui.js вместе,
 * запускает тикающий цикл раз в секунду и отвечает за уведомления
 * (это единственная "сквозная" обязанность, которая не относится
 * чисто ни к времени, ни к DOM).
 */

(function () {
  const NOTIFY_THRESHOLDS = [
    { key: '30min', ms: 30 * 60000, text: 'До конца рабочего дня осталось 30 минут.' },
    { key: '10min', ms: 10 * 60000, text: 'Осталось 10 минут рабочего времени.' },
    { key: 'end', ms: 0, text: 'Рабочий день завершён.' }
  ];

  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function fireNotification(text) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Office Time Tracker', { body: text });
      } catch (e) {
        // Notification API может быть недоступен в некоторых окружениях —
        // приложение продолжает работать без уведомлений.
      }
    }
  }

  /** Проверяет пороги уведомлений и помечает уже показанные, чтобы не дублировать. */
  function checkNotifications(snapshot) {
    if (snapshot.status !== 'working' || !snapshot.state) return;
    const state = snapshot.state;
    state.notified = state.notified || {};
    let changed = false;

    NOTIFY_THRESHOLDS.forEach((t) => {
      const alreadyShown = !!state.notified[t.key];
      const reached = snapshot.remainingMs <= t.ms;
      if (reached && !alreadyShown) {
        fireNotification(t.text);
        state.notified[t.key] = true;
        changed = true;
      }
    });

    if (changed) Storage.saveDayState(state);
  }

  const controller = {
    onStartDay() {
      requestNotificationPermission();
      Timer.startWorkDay();
      tick();
      UI.showToast('Рабочий день начат');
    },
    onStartBreak() {
      Timer.startBreak();
      tick();
    },
    onEndBreak() {
      Timer.endBreak();
      tick();
    },
    onFinishDay() {
      Timer.finishWorkDay();
      tick();
      UI.showToast('Рабочий день завершён');
      UI.renderHistory();
      UI.renderStats();
    },
    onSaveSettings(settings) {
      Storage.saveSettings(settings);
      tick();
    }
  };

  function tick() {
    const now = new Date();
    UI.renderClock(now);

    const snapshot = Timer.computeSnapshot();
    UI.renderHero(snapshot);
    checkNotifications(snapshot);
  }

  document.addEventListener('DOMContentLoaded', () => {
    UI.init(controller);
    tick();
    // Раз в секунду — этого достаточно для countdown, и не нагружает CPU.
    setInterval(tick, 1000);

    // Если пользователь вернулся из фонового таба, пересчитываем сразу,
    // а не ждём следующего тика — на случай если браузер троттлил таймеры.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();
    });
  });
})();
