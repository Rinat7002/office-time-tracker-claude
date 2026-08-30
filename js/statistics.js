/* statistics.js
 * Считает агрегаты по истории рабочих дней. Не трогает DOM и localStorage
 * напрямую — получает массив истории и возвращает готовые числа.
 */

const Statistics = {
  calculate(history) {
    if (!history || history.length === 0) {
      return {
        count: 0,
        totalWorkedMs: 0,
        avgWorkedMs: 0,
        avgStart: '—',
        longestDay: null,
        shortestDay: null
      };
    }

    const count = history.length;
    const totalWorkedMs = history.reduce((sum, e) => sum + e.workedMs, 0);
    const avgWorkedMs = totalWorkedMs / count;

    // среднее время начала — усредняем минуты от полуночи
    const avgStartMinutes =
      history.reduce((sum, e) => {
        const [h, m] = e.start.split(':').map(Number);
        return sum + h * 60 + m;
      }, 0) / count;
    const avgH = Math.floor(avgStartMinutes / 60);
    const avgM = Math.round(avgStartMinutes % 60);
    const avgStart = `${String(avgH).padStart(2, '0')}:${String(avgM).padStart(2, '0')}`;

    const longestDay = history.reduce((max, e) => (e.workedMs > max.workedMs ? e : max), history[0]);
    const shortestDay = history.reduce((min, e) => (e.workedMs < min.workedMs ? e : min), history[0]);

    return { count, totalWorkedMs, avgWorkedMs, avgStart, longestDay, shortestDay };
  },

  /** Последние N дней в хронологическом порядке (для графика). */
  recentDays(history, n = 14) {
    return [...history].slice(0, n).reverse();
  }
};
