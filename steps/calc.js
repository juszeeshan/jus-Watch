/* Jus Steps: pure helpers (no DOM). Used by the page and by the Node unit tests. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.StepsCalc = factory(); })(this, function () {
  'use strict';
  const p2 = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());     // local date, never toISOString()
  const parseISO = (s) => new Date(s + 'T12:00:00');
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
  const weekStart = (s) => addDays(s, -((parseISO(s).getDay() + 6) % 7));                          // Monday
  const weekDates = (s) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(s), i));
  const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const DEFAULTS = { goal: 5000, waterGoal: 8, height: 170, weight: 70, age: 0, sex: 'm', units: 'km', sens: 'normal', keepAwake: true };
  const num = (x, d) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : d);

  const strideM = (p) => num(p.height, 170) * 0.415 / 100;
  const distanceKm = (steps, p) => steps * strideM(p) / 1000;
  const walkKcal = (steps, p) => distanceKm(steps, p) * num(p.weight, 70) * 0.75;                  // ~0.75 kcal per kg per km of walking
  const kcalPerStep = (p) => walkKcal(1, p);
  const bmr = (p) => {                                                                              // Mifflin-St Jeor, kcal per day
    const w = num(p.weight, 70), h = num(p.height, 170), a = num(p.age, 30);
    return Math.round(10 * w + 6.25 * h - 5 * a + (p.sex === 'f' ? -161 : p.sex === 'o' ? -78 : 5));
  };
  const FOODS = [{ e: '🍔', n: 'burger', k: 500 }, { e: '🍕', n: 'slice of pizza', k: 285 }, { e: '🍌', n: 'banana', k: 105 }, { e: '🍪', n: 'cookie', k: 100 }];
  const foodEquiv = (kcal) => {                                                                       // the snack that matches best, e.g. 99 kcal = 1 cookie
    let best = null;
    FOODS.forEach((f) => { if (kcal < f.k * 0.8) return; const count = Math.max(1, Math.round(kcal / f.k)), err = Math.abs(kcal - count * f.k) / kcal; if (!best || err < best.err) best = { e: f.e, n: f.n, count: count, err: err }; });
    return best;
  };
  const paceLabel = (spm) => (spm < 1 ? '' : spm < 60 ? 'Slow' : spm < 100 ? 'Steady' : spm < 130 ? 'Fast ⚡' : 'Brisk 🔥');
  const activeMinutes = (mins, thr) => Object.keys(mins || {}).filter((k) => mins[k] >= (thr || 30)).length;
  const paceNow = (mins, nowMin) => {                                                               // average steps/min over the last 5 minutes that had walking
    let sum = 0, n = 0; for (let m = nowMin; m > nowMin - 5; m--) { const v = (mins || {})[m]; if (v >= 10) { sum += v; n++; } } return n ? Math.round(sum / n) : 0;
  };
  const minutesToWalk = (stepsLeft, spm) => Math.ceil(stepsLeft / Math.max(60, spm || 100));
  const motivation = (pct, left, mins) => {
    if (pct >= 100) return { t: 'Goal reached! 🎉', s: 'Every extra step is a bonus.' };
    if (pct >= 75) return { t: 'Almost there!', s: 'Only ' + left.toLocaleString() + ' steps left. About ' + mins + ' min of walking.' };
    if (pct >= 50) return { t: 'More than halfway!', s: 'Only ' + left.toLocaleString() + ' steps left to reach your goal.', extra: 'About ' + mins + ' min of walking to reach your goal.' };
    if (pct >= 25) return { t: 'Good start!', s: left.toLocaleString() + ' steps to go. A short walk will do it.' };
    return { t: 'Let’s get moving', s: 'A 10-minute walk is roughly 1,000 steps.' };
  };
  const streaks = (days, goal, today) => {                                                          // today unfinished does not break the streak
    const met = (d) => ((days[d] || {}).steps || 0) >= goal;
    let cur = 0, d = today; if (!met(d)) d = addDays(d, -1);
    while (met(d)) { cur++; d = addDays(d, -1); }
    const all = Object.keys(days).filter(met).sort(); let best = 0, run = 0, prev = '';
    all.forEach((x) => { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; });
    return { current: cur, best: best };
  };

  /* Step detector for the phone's accelerometer. push(t_ms, x, y, z) returns how many steps to ADD.
   * Smooth the magnitude, subtract slowly moving gravity, count one step per upward crossing of a threshold, ignore anything faster than
   * ~3.5 steps/s, and only start counting after 4 steps in a row at a walking rhythm (so shaking the phone does not count). */
  const THRESH = { low: 2.0, normal: 1.3, high: 0.9 };
  function StepDetector(sens) { this.th = THRESH[sens] || THRESH.normal; this.reset(); }
  StepDetector.prototype.reset = function () { this.t = 0; this.lp = 0; this.base = 0; this.above = false; this.last = -1e9; this.pending = 0; this.walking = false; };
  StepDetector.prototype.setSens = function (s) { this.th = THRESH[s] || THRESH.normal; };
  StepDetector.prototype.push = function (t, x, y, z) {
    const m = Math.sqrt(x * x + y * y + z * z);
    if (!this.t) { this.t = t; this.lp = m; this.base = m; return 0; }
    const dt = Math.min(0.2, Math.max(0.001, (t - this.t) / 1000)); this.t = t;
    this.lp += (1 - Math.exp(-dt / 0.04)) * (m - this.lp);
    this.base += (1 - Math.exp(-dt / 1.0)) * (m - this.base);
    const d = this.lp - this.base; let add = 0;
    if (!this.above && d > this.th) {
      this.above = true;
      const gap = t - this.last;
      if (gap >= 285) {                                                // faster than ~3.5 steps/second is not walking
        if (gap > 1600) { this.walking = false; this.pending = 0; }    // a pause: need a fresh run of steps
        this.last = t;
        if (this.walking) add = 1; else if (++this.pending >= 4) { this.walking = true; add = this.pending; }
      }
    } else if (this.above && d < this.th * 0.3) this.above = false;
    return add;
  };
  return { isoOf, parseISO, addDays, weekStart, weekDates, LETTERS, NAMES, DEFAULTS, strideM, distanceKm, walkKcal, kcalPerStep, bmr, foodEquiv, paceLabel,
    activeMinutes, paceNow, minutesToWalk, motivation, streaks, StepDetector };
});
