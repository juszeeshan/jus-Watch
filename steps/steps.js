/* Jus Steps: a step counter inside the Jus Daylog PWA. Local-first (localStorage). Counts steps from the phone's motion sensor
 * while this page is open; steps from your phone's Health app can be added by hand. */
(() => {
  'use strict';
  const C = StepsCalc, KEY = 'jd-steps-v1', $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Math.round(n).toLocaleString();
  const todayISO = () => C.isoOf(new Date());
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  /* ---------- storage ---------- */
  let S;
  function load() {
    let o = null; try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
    S = { settings: Object.assign({}, C.DEFAULTS, (o && o.settings) || {}), days: (o && o.days) || {}, paused: !!(o && o.paused) };
    const old = C.addDays(todayISO(), -8);                          // keep per-minute detail for a week only; older days keep just the totals
    Object.keys(S.days).forEach((d) => { const x = S.days[d]; if (d < old && x.mins) { x.am = (x.am || 0) + C.activeMinutes(x.mins); delete x.mins; } });
  }
  let saveTimer = null;
  function save(now) { clearTimeout(saveTimer); const go = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } }; if (now) go(); else saveTimer = setTimeout(go, 1500); }
  const day = (d) => (S.days[d] = S.days[d] || { steps: 0, mins: {}, am: 0, mood: 0, note: '', water: 0 });
  const peek = (d) => S.days[d] || { steps: 0, mins: {}, am: 0, mood: 0, note: '', water: 0 };

  /* ---------- UI state ---------- */
  const ui = { tab: 'today', sel: todayISO(), status: 'idle', msg: '' };
  let toastTimer = null;
  function toast(t) { let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); } el.textContent = t; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3200); }

  /* ---------- counting ---------- */
  const det = new C.StepDetector(); let listening = false, seenSample = false, wake = null;
  function addSteps(n) {
    if (!(n > 0)) return;
    const t = todayISO(), d = day(t), before = d.steps, goal = S.settings.goal;
    d.steps += n; const m = nowMin(); d.mins[m] = (d.mins[m] || 0) + n;
    if (before < goal && d.steps >= goal) { toast('Daily goal reached! 🎉'); try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) { /* ignore */ } }
    save(); drawSoon();
  }
  function feed(t, x, y, z) { seenSample = true; if (S.paused) return 0; const n = det.push(t, x, y, z); if (n) addSteps(n); return n; }
  function onMotion(e) { const a = e.accelerationIncludingGravity; if (a && a.x != null && a.y != null && a.z != null) feed(performance.now(), a.x, a.y, a.z); }
  async function startCounting() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {      // iPhone: needs a tap
        const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') { ui.status = 'denied'; draw(); return; }
      }
      if (!('DeviceMotionEvent' in window)) { ui.status = 'nosensor'; draw(); return; }
      if (!listening) { window.addEventListener('devicemotion', onMotion); listening = true; }
      det.reset(); seenSample = false; ui.status = 'counting'; S.paused = false; try { localStorage.setItem('jd-steps-on', '1'); } catch (e) { /* ignore */ }
      keepAwake(); save(true); draw();
      setTimeout(() => { if (!seenSample && ui.status === 'counting') { ui.status = 'nosensor'; draw(); } }, 4500);
    } catch (err) { ui.status = 'denied'; draw(); }
  }
  async function keepAwake() {
    try { if (S.settings.keepAwake && ui.status === 'counting' && 'wakeLock' in navigator && !wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { det.reset(); keepAwake(); draw(); } else save(true); });
  window.addEventListener('pagehide', () => save(true));

  /* ---------- drawing ---------- */
  let drawTimer = null; const drawSoon = () => { if (!drawTimer) drawTimer = setTimeout(() => { drawTimer = null; draw(); }, 900); };
  const dist = (km) => (S.settings.units === 'mi' ? (km * 0.621371).toFixed(2) + ' mi' : km.toFixed(2) + ' km');
  const TABS = [['today', '🏠', 'Today'], ['stats', '👥', 'Stats'], ['goals', '🎯', 'Goals'], ['report', '📊', 'Report'], ['settings', '⚙️', 'Settings']];
  function ring(pct, r, w) { const c = 2 * Math.PI * r; return `<circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--card2)" stroke-width="${w}"/><circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(c * Math.min(1, pct)).toFixed(1)} ${c.toFixed(1)}"/>`; }

  function statusLine() {
    if (ui.status === 'counting' && !S.paused) return '<span class="pill">● Counting</span>';
    if (S.paused) return '<span class="pill warn">❚❚ Paused</span>';
    if (ui.status === 'nosensor') return '<span class="pill warn">No motion sensor</span>';
    if (ui.status === 'denied') return '<span class="pill warn">Permission needed</span>';
    return '';
  }
  function todayView() {
    const T = todayISO(), sel = ui.sel, isToday = sel === T, d = peek(sel), P = S.settings, goal = P.goal, steps = d.steps;
    const pct = steps / goal, left = Math.max(0, goal - steps);
    const wk = C.weekDates(sel), wkSteps = wk.reduce((a, x) => a + peek(x).steps, 0), wkGoal = goal * 7, wkPct = Math.min(1, wkSteps / wkGoal);
    const idx = wk.indexOf(T), daysLeft = idx < 0 ? 0 : 7 - idx;
    const km = C.distanceKm(steps, P), walk = C.walkKcal(steps, P), bmr = C.bmr(P), rest = isToday ? bmr * nowMin() / 1440 : bmr, total = rest + walk, projected = bmr + walk;
    const active = C.activeMinutes(d.mins) + (d.am || 0), spm = isToday ? C.paceNow(d.mins, nowMin()) : 0;
    const msg = C.motivation(pct * 100, left, C.minutesToWalk(left, spm)), food = C.foodEquiv(walk), more = left ? Math.round(C.kcalPerStep(P) * left) : 0;
    const start = ui.status !== 'counting' && isToday ? `<section class="card banner center"><b>Start the step counter</b><p class="muted small">Counts steps with your phone’s motion sensor while this page is open${P.keepAwake ? ' and the screen stays on' : ''}.</p><button class="btn wide" data-a="start">Start counting</button>${ui.status === 'nosensor' ? '<p class="small muted">No motion sensor was found. You can still add steps by hand in Settings.</p>' : ''}${ui.status === 'denied' ? '<p class="small muted">Motion access was blocked. Allow it in your browser’s site settings, then tap Start again.</p>' : ''}</section>` : '';
    const dateLabel = new Date(sel + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return `<div class="center"><div class="muted small">${esc(dateLabel)}</div><h1>${isToday ? 'Today’s Progress' : 'Progress'}</h1>
      ${isToday && ui.status === 'counting' ? `<button class="btn small ghost" data-a="pause">${S.paused ? '▶ Resume' : '❚❚ Pause'}</button>` : statusLine()}</div>
      ${start}
      <div class="ringbox"><svg viewBox="0 0 200 200">${ring(pct, 90, 8)}</svg><div class="in"><div class="ico">👣</div><div class="big">${fmt(steps)}</div><div class="muted">/ ${fmt(goal)} steps</div><div><span class="pill">${Math.round(pct * 100)}%</span></div></div></div>
      <div class="days">${wk.map((x, i) => `<button class="day ${x === sel ? 'on' : ''} ${peek(x).steps >= goal ? 'met' : ''} ${x > T ? 'fut' : ''}" data-a="sel" data-d="${x}">${C.LETTERS[i]}</button>`).join('')}</div>
      <section class="card row"><div class="mini"><svg viewBox="0 0 200 200">${ring(wkPct, 84, 16)}</svg><b>${Math.round(wkPct * 100)}%</b></div><div><div class="muted small"><b>This week</b></div><div style="font-size:21px;font-weight:800">${fmt(wkSteps)} / ${fmt(wkGoal)}</div><div class="muted small">${fmt(Math.max(0, wkGoal - wkSteps))} steps to go · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left</div></div></section>
      <div class="grid2"><section class="card stat"><div class="ic" style="color:var(--blue)">📍</div><div class="muted small">Distance</div><b>${dist(km)}</b><div class="muted small">⚽ Football fields: ${Math.round(km * 1000 / 105)}</div></section>
      <section class="card stat"><div class="ic" style="color:var(--orange)">🔥</div><div class="muted small">Calories</div><b>${fmt(walk)} kcal</b></section></div>
      <section class="card"><h2>🔥 Daily Calorie Burn</h2><div style="font-size:26px;font-weight:800">${fmt(total)} kcal ${isToday ? 'today' : ''}</div>${isToday ? `<div class="muted small">By midnight: about ${fmt(projected)} kcal</div>` : ''}
        <div class="bar" style="margin:10px 0"><i style="width:${(rest / (isToday ? projected : total) * 100).toFixed(1)}%;background:var(--card2);filter:brightness(1.4)"></i><i style="width:${(walk / (isToday ? projected : total) * 100).toFixed(1)}%;background:var(--accent2)"></i></div>
        <div class="legend" style="flex-direction:column;gap:4px"><span style="--c:#6b7a92">At rest so far: ${fmt(rest)} kcal</span><span style="--c:var(--accent2)">Walking: +${fmt(walk)} kcal</span></div>
        ${food ? `<div class="small muted" style="margin-top:8px">🍽️ About the same as: ${food.e} × ${food.count} (${esc(food.n)})</div>` : ''}
        ${more ? `<div class="small" style="margin-top:6px;color:var(--blue)">👟 Reach ${fmt(goal)} steps → +${more} kcal</div>` : ''}
        ${!P.age ? '<div class="small muted" style="margin-top:6px">Add your age (Goals tab) for a more accurate number.</div>' : ''}</section>
      <div class="grid2"><section class="card stat"><div class="ic" style="color:var(--accent)">⏱</div><div class="muted small">Active Time</div><b>${active} min</b></section>
      <section class="card stat"><div class="ic" style="color:var(--accent)">👣</div><div class="muted small">Goal</div><b>${fmt(goal)} steps</b></section>
      <section class="card stat"><div class="ic" style="color:var(--accent)">📈</div><div class="muted small">Pace</div><b>${spm ? spm + ' steps/min' : '—'}</b><div class="muted small">${C.paceLabel(spm)}</div></section></div>
      <section class="card row"><div class="ic" style="font-size:30px">🎯</div><div><b>${esc(msg.t)}</b><div class="muted small">${esc(msg.s)}</div>${msg.extra ? `<div class="small" style="color:var(--blue)">⏱ ${esc(msg.extra)}</div>` : ''}</div></section>
      <section class="card"><h2>😊 How was your day?</h2><div class="moods">${['😄', '🙂', '😐', '😕', '😫'].map((e, i) => `<button class="${d.mood === i + 1 ? 'on' : ''}" data-a="mood" data-v="${i + 1}" aria-label="Mood ${i + 1}">${e}</button>`).join('')}</div><input id="note" maxlength="140" placeholder="Add a short note — e.g. walked in the park" value="${esc(d.note)}"></section>
      <section class="card"><h2>This Week</h2>${weekChart(wk, goal)}<div class="legend"><span style="--c:var(--accent)">Goal Reached</span><span style="--c:var(--blue)">Below Goal</span></div></section>
      <section class="card"><div class="row between"><h2>⚡ Activity Distribution</h2><b style="color:var(--accent)">${Math.round(active / 1440 * 100)}%</b></div><div class="bar"><i style="width:${Math.max(active / 1440 * 100, active ? 1 : 0).toFixed(1)}%;background:var(--blue)"></i></div><div class="legend"><span style="--c:var(--blue)">Active: ${active} min</span><span style="--c:var(--card2)">Rest: ${1440 - active} min</span></div></section>
      <section class="card"><div class="row between"><h2>💧 Water Intake</h2><span class="muted small">Daily Goal: ${P.waterGoal} cups</span></div>
        <div class="row between" style="margin-top:8px"><button class="round" data-a="water" data-v="-1" aria-label="Less water">−</button><div class="center"><div class="big" style="font-size:44px">${d.water}</div><div class="muted">cups</div></div><button class="round" data-a="water" data-v="1" aria-label="More water" style="color:var(--accent)">+</button></div>
        <div class="cups" style="grid-template-columns:repeat(${Math.min(P.waterGoal, 8)},1fr)">${Array.from({ length: Math.min(P.waterGoal, 16) }, (_, i) => `<i class="${i < d.water ? 'f' : ''}"></i>`).join('')}</div></section>`;
  }
  function weekChart(dates, goal) {
    const vals = dates.map((x) => peek(x).steps), max = Math.max(goal * 1.15, ...vals), T = todayISO(), W = 320, H = 150, bw = 26, gap = (W - 7 * bw) / 8;
    const bars = dates.map((x, i) => { const v = vals[i], h = Math.max(v ? 3 : 0, v / max * (H - 24)), xx = gap + i * (bw + gap); return `<rect x="${xx.toFixed(1)}" y="${(H - 22 - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="6" fill="${v >= goal ? 'var(--accent)' : 'var(--blue)'}" opacity="${x > T ? .25 : 1}"/><text x="${(xx + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" ${x === T ? 'style="fill:var(--accent);font-weight:700"' : ''}>${C.NAMES[i]}</text>`; }).join('');
    const gy = H - 22 - goal / max * (H - 24);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="var(--muted)" stroke-dasharray="4 4" opacity=".6"/>${bars}</svg>${vals.every((v) => !v) ? '<p class="muted small center">Your first day! Start walking and this chart will fill up.</p>' : ''}`;
  }
  function statsView() {
    const T = todayISO(), goal = S.settings.goal, dates = Array.from({ length: 30 }, (_, i) => C.addDays(T, i - 29)), vals = dates.map((x) => peek(x).steps);
    const all = Object.keys(S.days).filter((x) => S.days[x].steps > 0), total = all.reduce((a, x) => a + S.days[x].steps, 0), best = all.reduce((a, x) => (S.days[x].steps > (S.days[a] || { steps: 0 }).steps ? x : a), '');
    const st = C.streaks(S.days, goal, T), max = Math.max(goal * 1.1, ...vals), W = 330, H = 150, bw = 7, gap = (W - 30 * bw) / 31;
    const bars = vals.map((v, i) => { const h = Math.max(v ? 2 : 0, v / max * (H - 20)); return `<rect x="${(gap + i * (bw + gap)).toFixed(1)}" y="${(H - 16 - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="2" fill="${v >= goal ? 'var(--accent)' : 'var(--blue)'}"/>`; }).join('');
    const gy = H - 16 - goal / max * (H - 20), last7 = vals.slice(-7), last30 = vals.filter((v) => v > 0);
    return `<h1>Stats</h1><section class="card"><h2>Last 30 days</h2><svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="var(--muted)" stroke-dasharray="4 4" opacity=".6"/>${bars}<text x="0" y="${H - 2}">${dates[0].slice(5)}</text><text x="${W}" y="${H - 2}" text-anchor="end">${T.slice(5)}</text></svg></section>
      <div class="grid2">${[['🔥', 'Current streak', st.current + ' day' + (st.current === 1 ? '' : 's')], ['🏆', 'Best streak', st.best + ' day' + (st.best === 1 ? '' : 's')], ['👣', 'Total steps', fmt(total)], ['📅', 'Active days', all.length], ['📈', '7-day average', fmt(last7.reduce((a, b) => a + b, 0) / 7)], ['⭐', '30-day average', fmt(last30.length ? last30.reduce((a, b) => a + b, 0) / last30.length : 0)], ['🥇', 'Best day', best ? fmt(S.days[best].steps) + ' · ' + best.slice(5) : '—'], ['📍', 'Total distance', dist(C.distanceKm(total, S.settings))]].map((c) => `<section class="card stat"><div class="ic">${c[0]}</div><div class="muted small">${c[1]}</div><b style="font-size:20px">${c[2]}</b></section>`).join('')}</div>
      <section class="card"><h2>Recent moods</h2><div class="row" style="flex-wrap:wrap">${dates.slice(-14).map((x) => { const m = peek(x).mood; return `<div class="center small muted" style="width:44px">${m ? ['😄', '🙂', '😐', '😕', '😫'][m - 1] : '·'}<br>${x.slice(8)}</div>`; }).join('')}</div></section>`;
  }
  function goalsView() {
    const P = S.settings;
    return `<h1>Goals</h1><section class="card"><h2>Daily step goal</h2><div class="row" style="flex-wrap:wrap">${[3000, 5000, 8000, 10000, 12000].map((g) => `<button class="btn small ${P.goal === g ? '' : 'ghost'}" data-a="goal" data-v="${g}">${fmt(g)}</button>`).join('')}</div>
      <label style="margin-top:10px">Custom steps per day<input id="g-goal" type="number" inputmode="numeric" min="500" max="100000" value="${P.goal}"></label><div class="muted small" style="margin-top:6px">Weekly goal: ${fmt(P.goal * 7)} steps</div></section>
      <section class="card"><h2>Water goal</h2><label>Cups per day<input id="g-water" type="number" inputmode="numeric" min="1" max="16" value="${P.waterGoal}"></label></section>
      <section class="card"><h2>About you</h2><p class="muted small">Used only on this device, to turn steps into distance and calories.</p><div class="grid2">
        <label>Height (cm)<input id="p-height" type="number" inputmode="numeric" min="100" max="230" value="${P.height}"></label><label>Weight (kg)<input id="p-weight" type="number" inputmode="decimal" min="30" max="250" value="${P.weight}"></label>
        <label>Age<input id="p-age" type="number" inputmode="numeric" min="5" max="110" placeholder="optional" value="${P.age || ''}"></label>
        <label>Sex<select id="p-sex"><option value="m" ${P.sex === 'm' ? 'selected' : ''}>Male</option><option value="f" ${P.sex === 'f' ? 'selected' : ''}>Female</option><option value="o" ${P.sex === 'o' ? 'selected' : ''}>Prefer not to say</option></select></label></div>
        <label style="margin-top:10px">Distance units<select id="p-units"><option value="km" ${P.units === 'km' ? 'selected' : ''}>Kilometres</option><option value="mi" ${P.units === 'mi' ? 'selected' : ''}>Miles</option></select></label></section>
      <button class="btn wide" data-a="saveGoals">Save</button>`;
  }
  function reportRows() { const T = todayISO(); return Array.from({ length: 7 }, (_, i) => C.addDays(T, i - 6)).map((x) => { const d = peek(x); return { date: x, steps: d.steps, km: C.distanceKm(d.steps, S.settings), kcal: C.walkKcal(d.steps, S.settings), active: C.activeMinutes(d.mins) + (d.am || 0), water: d.water, mood: d.mood }; }); }
  function reportText() {
    const rows = reportRows(), goal = S.settings.goal, tot = rows.reduce((a, r) => a + r.steps, 0), met = rows.filter((r) => r.steps >= goal).length;
    return 'Jus Steps · last 7 days\n' + rows.map((r) => `${r.date.slice(5)}  ${fmt(r.steps)} steps  ${dist(r.km)}  ${fmt(r.kcal)} kcal`).join('\n') + `\n\nTotal ${fmt(tot)} steps · average ${fmt(tot / 7)}/day · goal met ${met}/7 days`;
  }
  function reportView() {
    const rows = reportRows(), goal = S.settings.goal, tot = rows.reduce((a, r) => a + r.steps, 0), met = rows.filter((r) => r.steps >= goal).length;
    return `<h1>Report</h1><section class="card"><h2>Last 7 days</h2><table><tr><th>Day</th><th>Steps</th><th>${S.settings.units}</th><th>kcal</th><th>Active</th></tr>${rows.map((r) => `<tr><td>${r.date.slice(5)}</td><td ${r.steps >= goal ? 'style="color:var(--accent);font-weight:700"' : ''}>${fmt(r.steps)}</td><td>${S.settings.units === 'mi' ? (r.km * 0.621371).toFixed(1) : r.km.toFixed(1)}</td><td>${fmt(r.kcal)}</td><td>${r.active}m</td></tr>`).join('')}</table></section>
      <div class="grid2"><section class="card stat"><div class="muted small">Total</div><b>${fmt(tot)}</b></section><section class="card stat"><div class="muted small">Goal met</div><b>${met} / 7 days</b></section></div>
      <div class="row"><button class="btn grow" data-a="share">Share</button><button class="btn ghost grow" data-a="csv">Download CSV</button></div>`;
  }
  function settingsView() {
    const P = S.settings, mode = (() => { try { return localStorage.getItem('jd-steps-mode') || 'auto'; } catch (e) { return 'auto'; } })();
    return `<h1>Settings</h1><section class="card"><h2>Step counter</h2><div class="row between"><div>${statusLine() || '<span class="muted">Not started</span>'}</div>${ui.status === 'counting' ? `<button class="btn small ghost" data-a="pause">${S.paused ? 'Resume' : 'Pause'}</button>` : '<button class="btn small" data-a="start">Start</button>'}</div>
      <label style="margin-top:12px">Sensitivity<select id="s-sens"><option value="low" ${P.sens === 'low' ? 'selected' : ''}>Low (fewer false steps)</option><option value="normal" ${P.sens === 'normal' ? 'selected' : ''}>Normal</option><option value="high" ${P.sens === 'high' ? 'selected' : ''}>High (gentle walkers)</option></select></label>
      <label class="row" style="margin-top:12px"><input id="s-awake" type="checkbox" style="width:auto" ${P.keepAwake ? 'checked' : ''}> Keep the screen on while counting</label>
      <label style="margin-top:12px">Appearance<select id="s-mode">${['auto', 'dark', 'light', 'amoled'].map((m) => `<option value="${m}" ${mode === m ? 'selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select></label></section>
      <section class="card"><h2>Add steps by hand</h2><p class="muted small">Walked without the phone? Copy today’s number from your phone’s Health / Fit app.</p><div class="row"><input id="add-n" type="number" inputmode="numeric" placeholder="Steps to add"><button class="btn" data-a="addManual">Add</button></div>
        <div class="row" style="margin-top:10px"><input id="set-n" type="number" inputmode="numeric" placeholder="Set today’s total"><button class="btn ghost" data-a="setTotal">Set</button></div></section>
      <section class="card"><h2>How counting works</h2><p class="muted small">This is a web app, so it can only read your phone’s motion sensor while this page is open and the screen is on. It cannot count in the background or read your phone’s built-in step counter. For all-day totals, add steps by hand from your Health app. Counts are estimates; carry the phone in a pocket or hand.</p></section>
      <section class="card"><h2>Your data</h2><p class="muted small">Stored on this device only.</p><div class="row"><button class="btn ghost grow" data-a="csv">Export CSV</button><button class="btn ghost grow" data-a="clearToday" style="color:var(--red)">Clear today</button></div><button class="btn ghost wide" data-a="clearAll" style="margin-top:10px;color:var(--red)">Delete all step data</button></section>
      <p class="center small"><a href="../index.html">← Back to Jus Daylog</a></p>`;
  }
  function draw() {
    if (drawTimer) { clearTimeout(drawTimer); drawTimer = null; }
    const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#app').contains(a)) return;   // never wipe what is being typed
    const y = window.scrollY, views = { today: todayView, stats: statsView, goals: goalsView, report: reportView, settings: settingsView };
    $('#app').innerHTML = views[ui.tab]();
    $('#nav').innerHTML = TABS.map((t) => `<button class="${ui.tab === t[0] ? 'on' : ''}" data-a="tab" data-v="${t[0]}"><span>${t[1]}</span>${t[2]}</button>`).join('');
    window.scrollTo(0, y);
  }

  /* ---------- actions ---------- */
  const val = (id) => { const e = $('#' + id); return e ? e.value : ''; };
  const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  function csv() {
    const lines = ['date,steps,distance_km,kcal_walking,active_min,water_cups,mood,note'];
    Object.keys(S.days).sort().forEach((x) => { const d = S.days[x]; lines.push([x, d.steps, C.distanceKm(d.steps, S.settings).toFixed(2), Math.round(C.walkKcal(d.steps, S.settings)), C.activeMinutes(d.mins) + (d.am || 0), d.water, d.mood || '', '"' + String(d.note || '').replace(/"/g, '""') + '"'].join(',')); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'jus-steps.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, v = b.dataset.v, T = todayISO();
    if (a === 'tab') { ui.tab = v; ui.sel = ui.tab === 'today' ? ui.sel : ui.sel; window.scrollTo(0, 0); }
    else if (a === 'start') { startCounting(); return; }
    else if (a === 'pause') { S.paused = !S.paused; save(true); toast(S.paused ? 'Paused' : 'Counting'); }
    else if (a === 'sel') ui.sel = b.dataset.d;
    else if (a === 'mood') { const d = day(ui.sel); d.mood = d.mood === Number(v) ? 0 : Number(v); save(true); }
    else if (a === 'water') { const d = day(ui.sel), was = d.water; d.water = Math.min(30, Math.max(0, d.water + Number(v))); if (was < S.settings.waterGoal && d.water >= S.settings.waterGoal) toast('Water goal reached 💧'); save(true); }
    else if (a === 'goal') { S.settings.goal = Number(v); save(true); }
    else if (a === 'saveGoals') {
      const P = S.settings; P.goal = clampInt(val('g-goal'), 500, 100000, P.goal); P.waterGoal = clampInt(val('g-water'), 1, 16, P.waterGoal);
      P.height = clampInt(val('p-height'), 100, 230, P.height); P.weight = Math.min(250, Math.max(30, Number(val('p-weight')) || P.weight)); P.age = val('p-age') ? clampInt(val('p-age'), 5, 110, 0) : 0;
      P.sex = val('p-sex') || 'm'; P.units = val('p-units') || 'km'; save(true); toast('Saved');
    }
    else if (a === 'addManual') { const n = clampInt(val('add-n'), 1, 100000, 0); if (!n) { toast('Enter a number of steps'); return; } day(T).steps += n; save(true); toast('Added ' + fmt(n) + ' steps'); }
    else if (a === 'setTotal') { const n = clampInt(val('set-n'), 0, 200000, -1); if (n < 0) { toast('Enter a number'); return; } day(T).steps = n; save(true); toast('Today set to ' + fmt(n)); }
    else if (a === 'clearToday') { if (confirm('Clear today’s steps, water and notes?')) { delete S.days[T]; save(true); } }
    else if (a === 'clearAll') { if (confirm('Delete ALL step data on this device?')) { S.days = {}; save(true); toast('Deleted'); } }
    else if (a === 'csv') { csv(); return; }
    else if (a === 'share') { const t = reportText(); if (navigator.share) navigator.share({ title: 'Jus Steps', text: t }).catch(() => {}); else if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Copied')); return; }
    draw();
  });
  document.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'note') { day(ui.sel).note = e.target.value.slice(0, 140); save(true); }
    else if (id === 's-sens') { S.settings.sens = e.target.value; det.setSens(S.settings.sens); save(true); }
    else if (id === 's-awake') { S.settings.keepAwake = e.target.checked; if (!e.target.checked && wake) { wake.release(); wake = null; } else keepAwake(); save(true); }
    else if (id === 's-mode') { try { if (e.target.value === 'auto') localStorage.removeItem('jd-steps-mode'); else localStorage.setItem('jd-steps-mode', e.target.value); } catch (x) { /* ignore */ } const m = e.target.value === 'auto' ? (({ amoled: 'amoled' })[localStorage.getItem('jd-theme')] || 'dark') : e.target.value; document.documentElement.setAttribute('data-mode', m); }
  });

  /* ---------- start ---------- */
  load(); det.setSens(S.settings.sens);
  try { if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {}); } catch (e) { /* ignore */ }
  draw();
  try { if (localStorage.getItem('jd-steps-on') === '1' && !(typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function')) startCounting(); } catch (e) { /* ignore */ }   // Android resumes by itself; iPhone needs a tap
  setInterval(() => { if (document.visibilityState === 'visible') { const t = todayISO(); if (ui.sel !== t && ui.lastToday && ui.lastToday !== t && ui.sel === ui.lastToday) ui.sel = t; ui.lastToday = t; draw(); } }, 60000);
  window.StepsApp = { feed, addSteps, draw, state: () => S, ui };
})();
