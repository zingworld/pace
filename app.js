/* PACE — Your goal. Your pace.
 * Hierarchy: Cycle → Goal / Plan → Session → Progress.
 * All data lives in this device's localStorage (key below). */
'use strict';

const STORE_KEY = 'pace.v1';
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const GOAL_PRESETS = [
  { type: 'body_fat', label: 'Body Fat', unit: '%', step: 0.1 },
  { type: 'run_30min', label: '30 Min Run', unit: 'km', step: 0.01 },
  { type: 'weight', label: 'Weight', unit: 'kg', step: 0.1 },
  { type: 'custom', label: '', unit: '', step: 0.1 },
];
const DEFAULT_PLAN = [
  { dow: 2, label: 'Strength + Walk' },
  { dow: 3, label: 'Run + Core' },
  { dow: 4, label: 'Strength + Walk' },
];

/* ——— dates (local, yyyy-mm-dd) ——— */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const today = () => iso(new Date());
const mondayOf = s => { const d = parse(s); return addDays(s, -((d.getDay() + 6) % 7)); };
const short = s => { const d = parse(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const addMonths = (s, n) => { const d = parse(s); d.setMonth(d.getMonth() + n); d.setDate(d.getDate() - 1); return iso(d); };

/* ——— store ——— */
const uid = () => Math.random().toString(36).slice(2, 10);
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* storage unavailable */ }
  return { version: 1, cycles: [], sessions: [], measurements: [], lastBackup: null };
}
let db = load();
db.logs = db.logs || [];
db.body = db.body || [];
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('저장하지 못했어요. 저장 공간을 확인해 주세요.'); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const activeCycle = () => db.cycles.find(c => c.status === 'active') || null;
const cycleById = id => db.cycles.find(c => c.id === id);

/* ——— domain ——— */
function plannedSessions(c) {
  const out = [];
  const n = diffDays(c.start, c.end);
  for (let i = 0; i <= n; i++) {
    const date = addDays(c.start, i);
    const dow = parse(date).getDay();
    c.plan.forEach((p, slot) => { if (p.dow === dow) out.push({ date, slot, label: p.label }); });
  }
  return out;
}
const sessionKey = (cycleId, date, slot) => `${cycleId}|${date}|${slot}`;
function isDone(c, date, slot) {
  return db.sessions.some(s => s.key === sessionKey(c.id, date, slot) && s.done);
}
function measurementsFor(goalId) {
  return db.measurements.filter(m => m.goalId === goalId).sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
}
function currentValue(goal) {
  const ms = measurementsFor(goal.id);
  return ms.length ? ms[ms.length - 1].value : null;
}
function goalProgress(goal, value) {
  if (value == null || goal.target === goal.start) return 0;
  const p = (value - goal.start) / (goal.target - goal.start);
  return Math.max(0, Math.min(1, p));
}
function cycleStats(c) {
  const t = today();
  const total = diffDays(c.start, c.end) + 1;
  const elapsed = Math.max(0, Math.min(total, diffDays(c.start, t) + 1));
  const weeks = Math.ceil(total / 7);
  const week = t < c.start ? 0 : Math.min(weeks, Math.floor(diffDays(c.start, t) / 7) + 1);
  return { total, elapsed, weeks, week, frac: t < c.start ? 0 : elapsed / total, before: t < c.start, after: t > c.end };
}
const fmtVal = (v, g) => v == null ? '—' : (g && g.unit === 'km' ? v.toFixed(2).replace(/0$/, '') : v.toFixed(1));
function fmtDelta(d, g) {
  if (d == null) return '';
  const s = Math.abs(d) < 1e-9 ? '±0' : (d > 0 ? '+' : '−') + fmtVal(Math.abs(d), g);
  return `${s}${g.unit === '%' ? '%p' : ' ' + g.unit}`;
}

/* ——— helpers ——— */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
const CHECK = '<svg viewBox="0 0 16 16"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>';
const MARK = '<svg viewBox="0 0 26 16" aria-hidden="true"><rect x="1.2" y="1.2" width="23.6" height="13.6" rx="6.8"/><circle cx="19" cy="4.2" r="2.6"/></svg>';

/* ——— sheet ——— */
function openSheet(html, onMount) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  onMount && onMount($('#sheet-body'));
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}
$('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

/* ——— router ——— */
let route = 'home';
function go(r) { route = r; render(); window.scrollTo(0, 0); }
$$('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.route)));

function render() {
  const c = activeCycle();
  const view = $('#view');
  const showTabs = !!c && !['setup', 'complete'].includes(route);
  $('#tabbar').hidden = !showTabs;
  view.classList.toggle('no-tabs', !showTabs);
  $$('.tab').forEach(b => b.setAttribute('aria-current', b.dataset.route === route ? 'page' : 'false'));

  if (route === 'complete') return renderComplete(view);
  if (route === 'setup') return renderSetup(view);
  if (!c) return renderWelcome(view);
  if (route === 'progress') return renderProgress(view, c);
  if (route === 'cycle') return renderCycle(view, c);
  if (route === 'plan') return renderPlan(view, c);
  return renderHome(view, c);
}

/* ——— welcome ——— */
function renderWelcome(view) {
  const last = db.cycles[db.cycles.length - 1];
  view.innerHTML = `
    <section class="welcome">
      <svg class="mark" viewBox="0 0 120 70" aria-hidden="true">
        <rect x="4" y="4" width="112" height="62" rx="31" fill="none" stroke="var(--rail)" stroke-width="8"/>
        <path d="M35 4 H85 A31 31 0 0 1 85 66" fill="none" stroke="var(--lane)" stroke-width="8" stroke-linecap="round"/>
        <circle cx="85" cy="66" r="7" fill="var(--sun)"/>
      </svg>
      <h1>PACE</h1>
      <div class="tag">Your goal. Your pace.</div>
      <p>${last ? '다음 Cycle을 시작할 준비가 되면 기간과 목표를 정해 주세요.' : '기간을 정하고, 그 기간 동안 이루고 싶은 목표를 적는 것부터 시작해요.'}</p>
      <button class="btn block" id="start">${last ? `Create ${nextCycleName()}` : 'Create a Cycle'}</button>
      <button class="btn quiet block" id="restore" style="margin-top:8px">백업 파일에서 불러오기</button>
    </section>`;
  $('#start').onclick = () => { setupDraft = null; go('setup'); };
  $('#restore').onclick = importBackup;
}
const nextCycleName = () => `Cycle ${pad(db.cycles.length + 1)}`;

/* ——— home ——— */
function trackSVG(c, st) {
  // stadium-shaped track; progress runs clockwise from the start line
  const W = 340, H = 200, sw = 14, r = (H - sw) / 2, x0 = sw / 2 + r, x1 = W - sw / 2 - r, top = sw / 2, bot = H - sw / 2;
  const mid = (x0 + x1) / 2;
  const d = `M ${mid} ${top} H ${x1} A ${r} ${r} 0 0 1 ${x1} ${bot} H ${x0} A ${r} ${r} 0 0 1 ${x0} ${top} Z`;
  const inset = 9, ri = r - inset;
  const di = `M ${mid} ${top + inset} H ${x1} A ${ri} ${ri} 0 0 1 ${x1} ${bot - inset} H ${x0} A ${ri} ${ri} 0 0 1 ${x0} ${top + inset} Z`;
  const L = 1000, prog = Math.max(0, Math.min(1, st.frac)) * L;
  return `
    <svg viewBox="-8 -8 ${W + 16} ${H + 16}" role="img" aria-label="Cycle 진행 ${Math.round(st.frac * 100)}%">
      <path class="t-base" d="${d}"/>
      <path class="t-inner" d="${di}"/>
      <path class="t-prog" id="tprog" d="${d}" pathLength="${L}" stroke-dasharray="0 ${L}" data-to="${prog}"/>
      <g id="tticks"></g>
      <line class="t-start" x1="${mid}" y1="${top - 10}" x2="${mid}" y2="${top + 10}"/>
      <g id="tnow"></g>
    </svg>`;
}
function mountTrack(c, st) {
  const p = $('#tprog');
  if (!p) return;
  const L = 1000, real = p.getTotalLength(), to = +p.dataset.to;
  const pt = f => p.getPointAtLength(f * real);
  // one tick per week boundary
  let ticks = '';
  for (let w = 1; w < st.weeks; w++) {
    const f = (w * 7) / st.total;
    const q = pt(f);
    ticks += `<circle class="t-tick ${f <= st.frac ? 'passed' : ''}" cx="${q.x}" cy="${q.y}" r="2.2"/>`;
  }
  $('#tticks').innerHTML = ticks;
  const q = pt(Math.max(0, Math.min(1, st.frac)));
  $('#tnow').innerHTML = `<circle class="t-now-halo" cx="${q.x}" cy="${q.y}" r="13"/><circle class="t-now" cx="${q.x}" cy="${q.y}" r="8"/>`;
  requestAnimationFrame(() => requestAnimationFrame(() => p.setAttribute('stroke-dasharray', `${to} ${L}`)));
}

function heroCenter(c, st) {
  if (st.before) {
    const dd = diffDays(today(), c.start);
    return `<div class="big">D-${dd}</div><div class="sub">${DOW_KO[parse(c.start).getDay()]}요일 ${md(c.start)} 시작</div>`;
  }
  if (st.after) return `<div class="big">DONE</div><div class="sub">${st.total}일 완주</div>`;
  return `<div class="big">WEEK ${st.week}<small>/${st.weeks}</small></div><div class="sub">${Math.round(st.frac * 100)}% · ${st.total - st.elapsed}일 남음</div>`;
}

function goalCard(g) {
  const cur = currentValue(g);
  const shown = cur ?? g.start;
  const p = goalProgress(g, cur);
  const moved = cur == null ? null : cur - g.start;
  return `
    <article class="card goal">
      <div class="goal-top">
        <div>
          <div class="label">${esc(g.label)}</div>
          <div class="goal-range num">${fmtVal(g.start, g)} → <b>${fmtVal(g.target, g)}</b><span class="unit">${esc(g.unit)}</span></div>
        </div>
        <div class="goal-now">
          <div class="v num">${fmtVal(shown, g)}<span class="unit">${esc(g.unit)}</span></div>
          <div class="d">${cur == null ? '아직 기록 없음' : `시작 대비 ${fmtDelta(moved, g)}`}</div>
        </div>
      </div>
      <div class="lane" aria-hidden="true">
        <div class="rail"></div><div class="fill" style="width:${p * 100}%"></div>
        <div class="end"></div><div class="dot" style="left:${p * 100}%"></div>
      </div>
      <div class="lane-legend"><span>Start ${fmtVal(g.start, g)}${g.startEstimated ? ' (추정)' : ''}</span><span>${Math.round(p * 100)}%</span><span>Goal ${fmtVal(g.target, g)}</span></div>
      <button class="goal-add" data-goal="${g.id}" aria-label="${esc(g.label)} 기록하기"></button>
    </article>`;
}

function renderHome(view, c) {
  const st = cycleStats(c);
  const t = today();
  const anchor = st.before ? c.start : st.after ? c.end : t;
  let ws = mondayOf(anchor), we = addDays(ws, 6);
  let week = plannedSessions(c).filter(s => s.date >= ws && s.date <= we);
  // nothing left to show this week (e.g. Sunday) → look at next week
  let nextWeek = false;
  if (!st.after && !week.some(s => s.date >= t)) {
    const ws2 = addDays(ws, 7), we2 = addDays(ws2, 6);
    const w2 = plannedSessions(c).filter(s => s.date >= ws2 && s.date <= we2);
    if (w2.length && !week.length) { ws = ws2; we = we2; week = w2; nextWeek = true; }
  }
  const doneCount = week.filter(s => isDone(c, s.date, s.slot)).length;

  view.innerHTML = `
    <header class="topbar">
      <div class="wordmark">${MARK}PACE</div>
      <span class="pill">${short(t)}</span>
    </header>

    <section class="hero">
      <div class="hero-head">
        <h1>${esc(c.name)}</h1>
        <div class="dates">${short(c.start)} — ${short(c.end)}<br>${st.total}일 · ${st.weeks}주</div>
      </div>
      <div class="track">${trackSVG(c, st)}<div class="track-center">${heroCenter(c, st)}</div></div>
    </section>

    ${st.after ? `<button class="btn block" id="finish" style="margin-bottom:8px">Cycle 돌아보기</button>` : ''}

    ${weeklyCheckCard()}

    <section class="section">
      <div class="section-head"><h2 class="eyebrow">Goals</h2><span class="aside">카드를 눌러 기록</span></div>
      <div class="stack">${c.goals.map(goalCard).join('') || '<button class="card empty empty-btn" id="add-goal">아직 목표가 없어요<b>+ 목표 추가하기</b></button>'}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="eyebrow">${st.before ? 'First week' : nextWeek ? 'Next week' : 'This week'}</h2><span class="aside">${week.length ? `${doneCount} / ${week.length} sessions` : ''}</span></div>
      <div class="card sessions">
        ${week.map(s => {
          const done = isDone(c, s.date, s.slot);
          const d = parse(s.date);
          return `<button class="session ${done ? 'done' : ''} ${s.date === t ? 'today' : ''}" data-date="${s.date}" data-slot="${s.slot}" aria-pressed="${done}">
            <span class="day">${DOW[d.getDay()]}<em>${md(s.date)}</em></span>
            <span class="what">${esc(s.label)}${s.date === t || planSummary(s.date) ? `<small>${[s.date === t ? '오늘' : '', planSummary(s.date)].filter(Boolean).join(' · ')}</small>` : ''}</span>
            <span class="check">${CHECK}</span>
          </button>`;
        }).join('') || '<div class="empty">이번 주에는 계획된 Session이 없어요.</div>'}
      </div>
      <button class="btn quiet" id="to-plan" style="margin-top:6px">${week.some(s => PROGRAM.byDate[s.date]) ? '운동 내용 보기 ›' : 'Plan 보기 ›'}</button>
    </section>

    <div class="footer-tag">Your goal. Your pace.</div>`;

  mountTrack(c, st);
  $$('.session', view).forEach(b => b.onclick = () => toggleSession(c, b.dataset.date, +b.dataset.slot));
  $$('.goal-add', view).forEach(b => b.onclick = () => openRecord(c, b.dataset.goal));
  const f = $('#finish'); if (f) f.onclick = () => go('complete');
  const ag = $('#add-goal'); if (ag) ag.onclick = () => { setupDraft = draftFrom(c); go('setup'); };
  $('#to-plan').onclick = () => { planWeek = null; go('plan'); };
  const wc = $('#weekly'); if (wc) wc.onclick = () => openBody(c);
}

function toggleSession(c, date, slot) {
  const key = sessionKey(c.id, date, slot);
  let s = db.sessions.find(x => x.key === key);
  if (!s) { s = { key, cycleId: c.id, date, slot, label: c.plan[slot]?.label, done: false }; db.sessions.push(s); }
  s.done = !s.done;
  s.at = Date.now();
  save();
  render();
  if (s.done) toast(date > today() ? `${md(date)} Session 완료로 표시했어요` : 'Session 완료 ✓');
}

/* ——— record a measurement ——— */
function openRecord(c, goalId) {
  const goals = c.goals;
  let sel = goals.find(g => g.id === goalId) || goals[0];
  if (!sel) return;
  const html = () => `
    <h2 id="sheet-title">기록하기</h2>
    <div class="chips" style="margin-bottom:16px">${goals.map(g => `<button class="chip" data-g="${g.id}" aria-pressed="${g.id === sel.id}">${esc(g.label)}</button>`).join('')}</div>
    <label class="field"><span class="label">${esc(sel.label)} (${esc(sel.unit)})</span>
      <input class="input big" id="rv" type="number" inputmode="decimal" step="${sel.step || 0.1}" placeholder="${fmtVal(currentValue(sel) ?? sel.start, sel)}"></label>
    <label class="field"><span class="label">Date</span><input class="input" id="rd" type="date" value="${today()}"></label>
    <label class="field"><span class="label">Memo</span><input class="input" id="rn" type="text" placeholder="선택 — 측정 조건 등"></label>
    <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn" id="rsave">저장</button></div>`;
  const mount = root => {
    $$('.chip', root).forEach(b => b.onclick = () => { sel = goals.find(g => g.id === b.dataset.g); root.innerHTML = html(); mount(root); });
    $('#rsave', root).onclick = () => {
      const v = parseFloat($('#rv', root).value);
      const date = $('#rd', root).value || today();
      if (!Number.isFinite(v)) { toast('숫자를 입력해 주세요'); $('#rv', root).focus(); return; }
      db.measurements.push({ id: uid(), cycleId: c.id, goalId: sel.id, date, value: v, note: $('#rn', root).value.trim(), at: Date.now() });
      save(); closeSheet(); render();
      toast(`${sel.label} ${fmtVal(v, sel)}${sel.unit} 저장했어요`);
    };
    setTimeout(() => $('#rv', root)?.focus(), 250);
  };
  openSheet(html(), mount);
}

/* ——— plan ——— */
function planSummary(date) {
  const p = PROGRAM.byDate[date];
  if (!p) return '';
  if (p.kind === 'run') return `400m × ${p.speeds.length} · ${Math.min(...p.speeds)}–${Math.max(...p.speeds)} km/h`;
  return `${p.list[0][0]} 외 ${p.list.length - 1}`;
}
// which slot of the active cycle's weekly plan this date belongs to
function slotFor(c, date) {
  if (!c || date < c.start || date > c.end) return -1;
  const dow = parse(date).getDay();
  return c.plan.findIndex(p => p.dow === dow);
}

let planWeek = null;
function renderPlan(view, c) {
  const t = today();
  const W = PROGRAM.weeks;
  if (planWeek == null) {
    const hit = W.find(w => t <= w.days[w.days.length - 1].date);
    planWeek = hit ? hit.n : W.length;
  }
  const w = W.find(x => x.n === planWeek) || W[0];
  const row = ([name, dose, tip]) => `<div class="ex"><div><a class="ex-name" href="${ytLink(name)}" target="_blank" rel="noopener">${esc(name)}<span aria-hidden="true">↗</span></a>${tip ? `<div class="ex-tip">${esc(tip)}</div>` : ''}</div><div class="ex-dose num">${esc(dose)}</div></div>`;

  const dayCard = p => {
    const d = parse(p.date);
    const slot = slotFor(c, p.date);
    const done = slot >= 0 && isDone(c, p.date, slot);
    const label = slot >= 0 ? c.plan[slot].label : (p.kind === 'run' ? 'Run + Core' : 'Strength + Walk');
    const lo = 8, hi = 10.4;
    return `<article class="card day-card ${p.date === t ? 'is-today' : ''}">
      <div class="day-head">
        <div><div class="label">${DOW[d.getDay()]} ${md(p.date)}${p.date === t ? ' · 오늘' : ''}</div><h3>${esc(label)}</h3></div>
        ${slot >= 0 ? `<button class="session plan-check ${done ? 'done' : ''}" data-date="${p.date}" data-slot="${slot}" aria-pressed="${done}" aria-label="${md(p.date)} Session 완료"><span class="check">${CHECK}</span></button>` : ''}
      </div>
      <div class="timeline">${p.time.map(([a, b]) => `<div><span class="num">${a}</span>${esc(b)}</div>`).join('')}</div>
      ${p.kind === 'run' ? `
        <div class="sub-head"><span class="label">400m 달리기 속도</span><span class="small muted">사이 100m 걷기 6km/h</span></div>
        <div class="speeds" role="img" aria-label="속도 ${p.speeds.join(', ')} km/h">
          ${p.speeds.map(v => `<div class="sp"><i style="height:${Math.round(((v - lo) / (hi - lo)) * 100)}%"></i><span class="num">${v}</span></div>`).join('')}
        </div>
        <p class="plan-note">${esc(p.speedNote)}</p>
        <div class="sub-head"><span class="label">코어 · 2라운드</span><span class="small muted">동작 사이 20–30초</span></div>
        <div class="ex-list">${p.core.map(row).join('')}</div>
      ` : `
        <div class="sub-head"><span class="label">본 운동</span><span class="small muted">세트 × 횟수 · 준비 세트 제외</span></div>
        <div class="ex-list">${p.list.map(row).join('')}</div>
        <p class="plan-note"><b>무게</b> ${esc(p.load)}</p>
      `}
      ${p.note ? `<p class="plan-note">${esc(p.note)}</p>` : ''}
      ${logSummary(c, p.date)}
      <button class="btn ${logFor(c, p.date) ? 'ghost' : ''} block" data-log="${p.date}" style="margin-top:14px">${logFor(c, p.date) ? '기록 수정' : '운동 기록하기'}</button>
    </article>`;
  };

  view.innerHTML = `
    <header class="topbar"><div class="wordmark">${MARK}PACE</div><span class="pill">${esc(c.name)}</span></header>
    <h1 class="num" style="font-size:34px;letter-spacing:.02em">Plan</h1>
    <p class="small muted" style="margin:2px 0 16px">${PROGRAM.name} · ${short(PROGRAM.start)} — ${short(PROGRAM.end)} · 화·수·목 약 50분</p>

    <div class="week-tabs" role="tablist">
      ${W.map(x => `<button class="chip" role="tab" data-pw="${x.n}" aria-pressed="${x.n === w.n}">W${x.n} <span class="muted">${x.set}</span></button>`).join('')}
      <button class="chip" data-pw="later" aria-pressed="false">W5+</button>
    </div>
    <div class="week-title"><span class="label">Week ${w.n} · ${w.set} 구성</span><span>${esc(w.title)}</span></div>

    <div class="stack">${w.days.map(dayCard).join('')}</div>

    <section class="section">
      <div class="section-head"><h2 class="eyebrow">Guide</h2></div>
      <div class="card guides">
        ${PROGRAM.guides.map(([title, items]) => `<details><summary>${esc(title)}</summary><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></details>`).join('')}
      </div>
    </section>
    <div class="footer-tag">One cycle at a time.</div>`;

  $$('[data-pw]', view).forEach(b => b.onclick = () => {
    if (b.dataset.pw === 'later') return toast('5주차부터는 첫 4주 기록을 보고 함께 정해요');
    planWeek = +b.dataset.pw; render();
  });
  $$('.plan-check', view).forEach(b => b.onclick = () => toggleSession(c, b.dataset.date, +b.dataset.slot));
  $$('[data-log]', view).forEach(b => b.onclick = () => openLog(c, b.dataset.log));
}

/* ——— workout log ——— */
const ytLink = name => `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' 자세')}`;
function parseDose(dose) {
  const m = dose.match(/(\d+)\s*×\s*(좌우\s*)?(\d+)/);
  return { sets: m ? +m[1] : 2, reps: m ? +m[3] : '', side: /좌우/.test(dose), unit: /초/.test(dose) ? '초' : '회' };
}
const logFor = (c, date) => db.logs.find(l => l.cycleId === c.id && l.date === date);
function lastExercise(name, beforeDate) {
  const logs = db.logs.filter(l => l.date < beforeDate).sort((a, b) => b.date.localeCompare(a.date));
  for (const l of logs) {
    const e = l.exercises.find(x => x.name === name && x.sets.some(s => s.r !== '' || s.w !== ''));
    if (e) return { date: l.date, ...e };
  }
  return null;
}
const setsText = e => e.sets.filter(s => s.r !== '' || s.w !== '').map(s => `${s.w !== '' ? s.w + 'kg×' : ''}${s.r}${e.unit === '초' ? '초' : ''}`).join(' · ');
function paceOf(min, km) {
  if (!(min > 0 && km > 0)) return null;
  const sec = Math.round((min * 60) / km);
  return { pace: `${Math.floor(sec / 60)}:${pad(sec % 60)}`, kmh: (km / (min / 60)).toFixed(1) };
}
function logSummary(c, date) {
  const l = logFor(c, date);
  if (!l) return '';
  const lines = [];
  if (l.run) {
    const pc = paceOf(l.run.min, l.run.km);
    lines.push(`<div><b>러닝</b> ${l.run.min}분 · ${l.run.km}km${pc ? ` · ${pc.pace}/km · ${pc.kmh}km/h` : ''}</div>`);
  }
  l.exercises.forEach(e => { const t = setsText(e); if (t) lines.push(`<div><b>${esc(e.name)}</b> ${esc(t)}${e.pain ? ' · 통증' : ''}</div>`); });
  return `<div class="log-sum"><span class="label">기록</span>${lines.join('') || '<div>완료</div>'}</div>`;
}

function openLog(c, date) {
  const p = PROGRAM.byDate[date];
  if (!p) return;
  const prev = logFor(c, date);
  const items = (p.kind === 'run' ? p.core.map(x => ({ name: x[0], dose: x[1], core: true })) : p.list.map(x => ({ name: x[0], dose: x[1], core: false })));
  const state = {
    run: p.kind === 'run' ? { min: prev?.run?.min ?? 30, km: prev?.run?.km ?? '' } : null,
    exercises: items.map(it => {
      const saved = prev?.exercises.find(e => e.name === it.name);
      const d = parseDose(it.dose);
      const last = lastExercise(it.name, date);
      const lastW = last ? [...last.sets].reverse().find(s => s.w !== '')?.w ?? '' : '';
      return {
        name: it.name, dose: it.dose, core: it.core, unit: d.unit, side: d.side, last,
        sets: saved ? saved.sets.map(s => ({ ...s })) : Array.from({ length: d.sets }, () => ({ w: it.core ? '' : lastW, r: d.reps })),
        rir: saved?.rir ?? '', pain: saved?.pain ?? false,
      };
    }),
  };
  const dd = parse(date);
  const html = () => `
    <h2 id="sheet-title">${DOW[dd.getDay()]} ${md(date)} · 운동 기록</h2>
    ${state.run ? `
      <div class="log-block">
        <div class="label">걷기·달리기</div>
        <div class="two" style="margin-top:8px">
          <label><span class="small muted">시간 (분)</span><input class="input num log-big" id="run-min" type="number" inputmode="decimal" step="any" value="${state.run.min}"></label>
          <label><span class="small muted">거리 (km)</span><input class="input num log-big" id="run-km" type="number" inputmode="decimal" step="any" value="${state.run.km}" placeholder="4.00"></label>
        </div>
        <div class="pace-out" id="pace-out"></div>
        <p class="hint" style="margin:6px 0 0">걷기 포함 평균이에요. 30분 기록은 30 Min Run 목표에도 반영돼요.</p>
      </div>` : ''}
    ${state.exercises.map((e, i) => `
      <div class="log-block">
        <div class="log-ex-head"><span class="ex-name">${esc(e.name)}</span><span class="small muted num">계획 ${esc(e.dose)}</span></div>
        ${e.last ? `<div class="small muted">지난번 ${md(e.last.date)} · ${esc(setsText(e.last))}</div>` : ''}
        <div class="set-rows">
          ${e.sets.map((st, j) => `<div class="set-row ${e.core ? 'core' : ''}">
            <span class="set-n num">${j + 1}</span>
            ${e.core ? '' : `<label class="unit-in"><input class="input num" type="number" inputmode="decimal" step="any" data-e="${i}" data-s="${j}" data-f="w" value="${st.w}"><span>kg</span></label>`}
            <label class="unit-in"><input class="input num" type="number" inputmode="numeric" step="any" data-e="${i}" data-s="${j}" data-f="r" value="${st.r}"><span>${e.side ? '좌우 ' : ''}${e.unit}</span></label>
            <button class="icon-btn" data-srm="${i}:${j}" aria-label="${j + 1}세트 삭제">×</button>
          </div>`).join('')}
        </div>
        <div class="log-opts">
          <button class="btn quiet" data-sadd="${i}">+ 세트</button>
          ${e.core ? '' : `<label class="small muted">여유 <select class="input mini" data-e="${i}" data-f="rir">${['', 0, 1, 2, 3, 4, '5+'].map(v => `<option value="${v}" ${String(e.rir) === String(v) ? 'selected' : ''}>${v === '' ? '—' : v + '회'}</option>`).join('')}</select></label>`}
          <label class="small muted pain"><input type="checkbox" data-e="${i}" data-f="pain" ${e.pain ? 'checked' : ''}> 통증</label>
        </div>
      </div>`).join('')}
    <div class="row-btns" style="margin-top:16px"><button class="btn ghost" data-close>취소</button><button class="btn" id="log-save">저장</button></div>`;

  const sync = root => {
    $$('[data-f]', root).forEach(el => {
      const e = state.exercises[+el.dataset.e], f = el.dataset.f;
      if (f === 'w' || f === 'r') e.sets[+el.dataset.s][f] = el.value === '' ? '' : parseFloat(el.value);
      else if (f === 'rir') e.rir = el.value;
      else if (f === 'pain') e.pain = el.checked;
    });
    if (state.run) {
      state.run.min = parseFloat($('#run-min', root).value) || '';
      state.run.km = parseFloat($('#run-km', root).value) || '';
    }
  };
  const showPace = root => {
    const out = $('#pace-out', root);
    if (!out) return;
    const pc = paceOf(parseFloat($('#run-min', root).value), parseFloat($('#run-km', root).value));
    out.innerHTML = pc ? `<span><b class="num">${pc.pace}</b> /km</span><span><b class="num">${pc.kmh}</b> km/h</span>` : '<span class="muted small">시간과 거리를 넣으면 페이스가 계산돼요</span>';
  };
  const mount = root => {
    showPace(root);
    ['#run-min', '#run-km'].forEach(id => { const el = $(id, root); if (el) el.oninput = () => showPace(root); });
    $$('[data-sadd]', root).forEach(b => b.onclick = () => {
      sync(root); const e = state.exercises[+b.dataset.sadd]; const lastSet = e.sets[e.sets.length - 1] || { w: '', r: '' };
      e.sets.push({ ...lastSet }); root.innerHTML = html(); mount(root);
    });
    $$('[data-srm]', root).forEach(b => b.onclick = () => {
      sync(root); const [i, j] = b.dataset.srm.split(':').map(Number); state.exercises[i].sets.splice(j, 1); root.innerHTML = html(); mount(root);
    });
    $('#log-save', root).onclick = () => {
      sync(root);
      const log = {
        id: prev?.id || uid(), cycleId: c.id, date, kind: p.kind, at: Date.now(),
        run: state.run && (state.run.min || state.run.km) ? { min: state.run.min, km: state.run.km } : null,
        exercises: state.exercises.map(e => ({ name: e.name, core: e.core, unit: e.unit, sets: e.sets.filter(s => s.r !== '' || s.w !== ''), rir: e.rir, pain: e.pain })),
      };
      db.logs = db.logs.filter(l => !(l.cycleId === c.id && l.date === date));
      db.logs.push(log);
      // saving a log also completes the Session
      const slot = slotFor(c, date);
      if (slot >= 0) {
        const key = sessionKey(c.id, date, slot);
        let ss = db.sessions.find(x => x.key === key);
        if (!ss) { ss = { key, cycleId: c.id, date, slot, label: c.plan[slot].label }; db.sessions.push(ss); }
        ss.done = true; ss.at = Date.now();
      }
      // a 30-minute run feeds the running goal
      const runGoal = c.goals.find(g => g.type === 'run_30min') || c.goals.find(g => g.unit === 'km');
      db.measurements = db.measurements.filter(m => m.logId !== log.id);
      if (runGoal && log.run && Number(log.run.min) === 30 && log.run.km > 0) {
        db.measurements.push({ id: uid(), cycleId: c.id, goalId: runGoal.id, date, value: log.run.km, note: '운동 기록', logId: log.id, at: Date.now() });
      }
      save(); closeSheet(); render();
      toast('운동 기록을 저장했어요');
    };
  };
  openSheet(html(), mount);
}

/* ——— weekly body check (Thursday, home scale) ——— */
const CHECK_DOW = 4;
function bodyThisWeek() {
  const mon = mondayOf(today()), sun = addDays(mon, 6);
  return db.body.find(b => b.date >= mon && b.date <= sun);
}
function weeklyCheckCard() {
  const t = today();
  // from Thursday until the week ends (Mon-based index)
  if ((parse(t).getDay() + 6) % 7 < (CHECK_DOW + 6) % 7) return '';
  if (bodyThisWeek()) return '';
  return `<section class="section"><button class="card weekly" id="weekly">
    <span><span class="label">Weekly check · 목요일</span><span class="weekly-t">이번 주 몸무게·체지방률</span><span class="small muted">집 체중계 · 같은 조건으로</span></span>
    <span class="weekly-go">기록</span></button></section>`;
}
function openBody(c) {
  const last = db.body.slice().sort((a, b) => a.date.localeCompare(b.date)).pop();
  const html = `
    <h2 id="sheet-title">Weekly check</h2>
    <div class="two">
      <label class="field"><span class="label">Weight (kg)</span><input class="input big" id="bw" type="number" inputmode="decimal" step="any" placeholder="${last?.weight ?? ''}"></label>
      <label class="field"><span class="label">Body fat (%)</span><input class="input big" id="bf" type="number" inputmode="decimal" step="any" placeholder="${last?.bodyFat ?? ''}"></label>
    </div>
    <label class="field"><span class="label">Date</span><input class="input" id="bd" type="date" value="${today()}"></label>
    <p class="hint" style="margin-top:0">매주 같은 조건(예: 목요일 아침 기상 후, 화장실 다녀온 뒤)에서 재면 추이를 보기 좋아요. 체지방률은 Body Fat 목표에도 반영돼요.</p>
    <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn" id="b-save">저장</button></div>`;
  openSheet(html, root => {
    setTimeout(() => $('#bw', root).focus(), 250);
    $('#b-save', root).onclick = () => {
      const w = parseFloat($('#bw', root).value), f = parseFloat($('#bf', root).value), date = $('#bd', root).value || today();
      if (!Number.isFinite(w) && !Number.isFinite(f)) { toast('몸무게나 체지방률을 입력해 주세요'); return; }
      const e = { id: uid(), date, weight: Number.isFinite(w) ? w : null, bodyFat: Number.isFinite(f) ? f : null, at: Date.now() };
      db.body.push(e);
      const g = c.goals.find(x => x.type === 'body_fat') || c.goals.find(x => x.unit === '%');
      if (g && e.bodyFat != null) db.measurements.push({ id: uid(), cycleId: c.id, goalId: g.id, date, value: e.bodyFat, note: 'Weekly check', bodyId: e.id, at: Date.now() });
      save(); closeSheet(); render();
      toast('이번 주 체크를 저장했어요');
    };
  });
}
function miniChart(pts, unit) {
  if (pts.length < 2) return '';
  const W = 320, H = 110, px = 34, py = 12;
  const vs = pts.map(p => p.v); let lo = Math.min(...vs), hi = Math.max(...vs);
  const pd = (hi - lo) * 0.2 || 0.5; lo -= pd; hi += pd;
  const X = i => px + (i / (pts.length - 1)) * (W - px - 8);
  const Y = v => py + (1 - (v - lo) / (hi - lo)) * (H - py * 2);
  return `<svg viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="${unit} 추이">
    <line class="c-grid" x1="${px}" x2="${W - 8}" y1="${H - py}" y2="${H - py}"/>
    <text x="0" y="${Y(Math.max(...vs)) + 4}">${Math.max(...vs)}</text><text x="0" y="${Y(Math.min(...vs)) + 4}">${Math.min(...vs)}</text>
    <path class="c-line" d="${pts.map((p, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ')}"/>
    ${pts.map((p, i) => `<circle class="c-pt" cx="${X(i)}" cy="${Y(p.v)}" r="3"/>`).join('')}
    <text x="${px}" y="${H + 10}">${md(pts[0].d)}</text><text x="${W - 8}" y="${H + 10}" text-anchor="end">${md(pts[pts.length - 1].d)}</text>
  </svg>`;
}
function bodySection(c) {
  const list = db.body.slice().sort((a, b) => a.date.localeCompare(b.date));
  const wPts = list.filter(b => b.weight != null).map(b => ({ d: b.date, v: b.weight }));
  return `<section class="section">
    <div class="section-head"><h2 class="eyebrow">Weekly check</h2><button class="btn quiet" id="body-add">+ 기록</button></div>
    <div class="card chart">
      ${wPts.length > 1 ? `<div class="small muted" style="margin-bottom:4px">몸무게 (kg)</div>${miniChart(wPts, 'kg')}` : ''}
      <div class="entries" ${wPts.length > 1 ? '' : 'style="margin-top:0;border-top:0"'}>${list.length ? list.slice().reverse().map(b => `<div class="entry"><span>${md(b.date)}</span><span><span class="num">${b.weight ?? '—'}</span> <span class="muted small">kg</span> &nbsp;<span class="num">${b.bodyFat ?? '—'}</span> <span class="muted small">%</span><button class="icon-btn" data-bdel="${b.id}" aria-label="${md(b.date)} 체크 삭제">×</button></span></div>`).join('') : '<div class="empty">매주 목요일, 집 체중계로 몸무게와 체지방률을 남겨요.</div>'}</div>
    </div>
  </section>`;
}
function runsSection(c) {
  const runs = db.logs.filter(l => l.cycleId === c.id && l.run).sort((a, b) => b.date.localeCompare(a.date));
  if (!runs.length) return '';
  return `<section class="section">
    <div class="section-head"><h2 class="eyebrow">Runs</h2><span class="aside">평균 페이스 · 걷기 포함</span></div>
    <div class="card" style="padding:4px 18px">
      ${runs.map(l => { const pc = paceOf(l.run.min, l.run.km); return `<button class="entry run-entry" data-log="${l.date}"><span>${md(l.date)}</span><span class="num">${l.run.min}분 · ${l.run.km}km</span><span class="num"><b>${pc ? pc.pace : '—'}</b><span class="muted small"> /km</span></span></button>`; }).join('')}
    </div>
  </section>`;
}

/* ——— progress ——— */
function chartSVG(c, g) {
  const ms = measurementsFor(g.id);
  const W = 320, H = 150, px = 30, py = 16;
  const span = Math.max(1, diffDays(c.start, c.end));
  const vals = [g.start, g.target, ...ms.map(m => m.value)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad2 = (hi - lo) * 0.15 || 1; lo -= pad2; hi += pad2;
  const X = date => px + (Math.max(0, Math.min(span, diffDays(c.start, date))) / span) * (W - px - 6);
  const Y = v => py + (1 - (v - lo) / (hi - lo)) * (H - py * 2);
  const pts = [{ date: c.start, value: g.start, first: true }, ...ms];
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p.date).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(' ');
  const t = today();
  return `<svg viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="${esc(g.label)} 변화">
    <line class="c-grid" x1="${px}" x2="${W - 6}" y1="${H - py}" y2="${H - py}"/>
    <line class="c-target" x1="${px}" x2="${W - 6}" y1="${Y(g.target)}" y2="${Y(g.target)}"/>
    <text x="0" y="${Y(g.target) + 4}">${fmtVal(g.target, g)}</text>
    <text x="0" y="${Y(g.start) + 4}">${fmtVal(g.start, g)}</text>
    ${t >= c.start && t <= c.end ? `<line class="c-today" x1="${X(t)}" x2="${X(t)}" y1="${py - 6}" y2="${H - py}"/>` : ''}
    <path class="c-line" d="${line}"/>
    ${pts.map(p => `<circle class="c-pt ${p.first ? 'first' : ''}" cx="${X(p.date)}" cy="${Y(p.value)}" r="${p.first ? 3.5 : 3.2}"/>`).join('')}
    <text x="${px}" y="${H + 10}">${short(c.start).toUpperCase()}</text>
    <text x="${W - 6}" y="${H + 10}" text-anchor="end">${short(c.end).toUpperCase()}</text>
  </svg>`;
}

function renderProgress(view, c) {
  const planned = plannedSessions(c);
  const t = today();
  const due = planned.filter(s => s.date <= t);
  const done = planned.filter(s => isDone(c, s.date, s.slot));
  const st = cycleStats(c);
  // group into cycle weeks
  const weeks = [];
  planned.forEach(s => {
    const w = Math.floor(diffDays(c.start, s.date) / 7);
    (weeks[w] = weeks[w] || []).push(s);
  });

  view.innerHTML = `
    <header class="topbar"><div class="wordmark">${MARK}PACE</div><span class="pill">${esc(c.name)}</span></header>
    <h1 class="num" style="font-size:34px;letter-spacing:.02em">Progress</h1>

    <section class="section">
      <div class="stat-row">
        <div class="card"><div class="label">Sessions</div><div class="num">${done.length}<span class="muted" style="font-size:18px"> / ${planned.length}</span></div><div class="small muted">계획 전체 기준</div></div>
        <div class="card"><div class="label">Cycle</div><div class="num">${Math.round(st.frac * 100)}<span class="muted" style="font-size:18px">%</span></div><div class="small muted">${st.elapsed} / ${st.total}일</div></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="eyebrow">Weeks</h2><span class="aside">지난 Session ${due.length}회 중 ${done.filter(s => s.date <= t).length}회</span></div>
      <div class="card"><div class="weeks">
        ${weeks.map((ss, i) => `<div class="wk ${st.week === i + 1 ? 'now' : ''}"><div class="dots">${ss.map(s => `<i class="${isDone(c, s.date, s.slot) ? 'on' : s.date > t ? 'future' : ''}"></i>`).join('')}</div><span>W${i + 1}</span></div>`).join('')}
      </div></div>
    </section>

    ${c.goals.map(g => {
      const ms = measurementsFor(g.id).slice().reverse();
      return `<section class="section">
        <div class="section-head"><h2 class="eyebrow">${esc(g.label)}</h2><button class="btn quiet" data-rec="${g.id}">+ 기록</button></div>
        <div class="card chart">${chartSVG(c, g)}
          <div class="entries">${ms.length ? ms.map(m => `<div class="entry"><span>${md(m.date)} <span class="muted small">${esc(m.note)}</span></span><span><span class="num">${fmtVal(m.value, g)}</span> <span class="muted small">${esc(g.unit)}</span><button class="icon-btn" data-del="${m.id}" aria-label="${md(m.date)} 기록 삭제">×</button></span></div>`).join('') : '<div class="empty">첫 기록을 남기면 변화가 선으로 그려져요.</div>'}</div>
        </div>
      </section>`;
    }).join('')}
    ${bodySection(c)}
    ${runsSection(c)}
    <div class="footer-tag">Progress at your pace.</div>`;

  $$('[data-rec]', view).forEach(b => b.onclick = () => openRecord(c, b.dataset.rec));
  const bb = $('#body-add'); if (bb) bb.onclick = () => openBody(c);
  $$('[data-bdel]', view).forEach(b => b.onclick = () => {
    const e = db.body.find(x => x.id === b.dataset.bdel);
    if (!e || !confirm(`${md(e.date)} 체크를 삭제할까요?`)) return;
    db.body = db.body.filter(x => x.id !== e.id);
    db.measurements = db.measurements.filter(m => m.bodyId !== e.id);
    save(); render(); toast('체크를 삭제했어요');
  });
  $$('[data-log]', view).forEach(b => b.onclick = () => openLog(c, b.dataset.log));
  $$('[data-del]', view).forEach(b => b.onclick = () => {
    const m = db.measurements.find(x => x.id === b.dataset.del);
    if (!m || !confirm(`${md(m.date)} 기록(${m.value})을 삭제할까요?`)) return;
    db.measurements = db.measurements.filter(x => x.id !== m.id);
    save(); render(); toast('기록을 삭제했어요');
  });
}

/* ——— cycle page ——— */
function renderCycle(view, c) {
  const past = db.cycles.filter(x => x.status === 'complete').reverse();
  const backupAge = db.lastBackup ? diffDays(db.lastBackup.slice(0, 10), today()) : null;
  view.innerHTML = `
    <header class="topbar"><div class="wordmark">${MARK}PACE</div><span class="pill">${esc(c.name)}</span></header>
    <h1 class="num" style="font-size:34px;letter-spacing:.02em">Cycle</h1>

    <section class="section">
      <div class="section-head"><h2 class="eyebrow">Current</h2><button class="btn quiet" id="edit">수정</button></div>
      <div class="card list">
        <div class="list-row"><span>기간</span><span class="muted">${c.start.replaceAll('-', '.')} — ${c.end.replaceAll('-', '.')}</span></div>
        ${c.goals.map(g => `<div class="list-row"><span>${esc(g.label)}</span><span class="muted num" style="font-size:16px">${fmtVal(g.start, g)} → ${fmtVal(g.target, g)} ${esc(g.unit)}</span></div>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="eyebrow">Plan · 매주</h2></div>
      <div class="card list">
        ${c.plan.slice().sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7)).map(p => `<div class="list-row"><span>${DOW_KO[p.dow]}요일</span><span class="muted">${esc(p.label)}</span></div>`).join('') || '<div class="empty">요일별 Session이 없어요.</div>'}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="eyebrow">Backup</h2><span class="aside">${backupAge == null ? '아직 백업 안 함' : backupAge === 0 ? '오늘 백업함' : `${backupAge}일 전 백업`}</span></div>
      <div class="card" style="padding:14px">
        <p class="small muted" style="margin:0 0 12px">기록은 이 기기에만 저장돼요. 가끔 백업 파일을 파일 앱이나 iCloud Drive에 저장해 두세요.</p>
        <div class="row-btns"><button class="btn ghost" id="export">백업 저장</button><button class="btn ghost" id="import">불러오기</button></div>
      </div>
    </section>

    <section class="section">
      <button class="btn ghost block" id="complete">Cycle 마무리하기</button>
      <p class="hint" style="margin:10px 0 0;text-align:center">기간 중이어도 마무리하고 다음 Cycle을 시작할 수 있어요.</p>
    </section>

    ${past.length ? `<section class="section"><div class="section-head"><h2 class="eyebrow">Past cycles</h2></div><div class="card list">
      ${past.map(p => `<button class="list-row" data-past="${p.id}"><span>${esc(p.name)}</span><span class="muted">${short(p.start)} — ${short(p.end)} ›</span></button>`).join('')}
    </div></section>` : ''}
    <div class="footer-tag">One cycle at a time.</div>`;

  $('#edit').onclick = () => { setupDraft = draftFrom(c); go('setup'); };
  $('#export').onclick = exportBackup;
  $('#import').onclick = importBackup;
  $('#complete').onclick = () => go('complete');
  $$('[data-past]', view).forEach(b => b.onclick = () => { completeView = b.dataset.past; go('complete'); });
}

/* ——— setup (create / edit cycle) ——— */
let setupDraft = null;
function draftFrom(c) { return JSON.parse(JSON.stringify({ id: c.id, name: c.name, start: c.start, end: c.end, plan: c.plan, goals: c.goals })); }
function freshDraft() {
  const prev = db.cycles.filter(c => c.status === 'complete').pop();
  const start = today();
  return {
    id: null,
    name: nextCycleName(),
    start,
    end: addDays(start, 12 * 7 - 1),
    plan: prev ? prev.plan.map(p => ({ ...p })) : DEFAULT_PLAN.map(p => ({ ...p })),
    goals: prev ? prev.goals.map(g => {
      const cur = currentValue(g);
      return { ...g, id: uid(), start: cur ?? g.start, startEstimated: cur == null && g.startEstimated };
    }) : [],
  };
}
const DURATIONS = [['4주', s => addDays(s, 27)], ['6주', s => addDays(s, 41)], ['12주', s => addDays(s, 83)], ['3개월', s => addMonths(s, 3)], ['6개월', s => addMonths(s, 6)], ['1년', s => addMonths(s, 12)]];

function renderSetup(view) {
  const d = setupDraft = setupDraft || freshDraft();
  const editing = !!d.id;
  const len = d.start && d.end && d.end >= d.start ? diffDays(d.start, d.end) + 1 : 0;
  view.innerHTML = `
    <header class="topbar"><div class="wordmark">${MARK}PACE</div>${activeCycle() ? '<button class="btn quiet" id="cancel">취소</button>' : ''}</header>
    <div class="eyebrow">${editing ? 'Edit cycle' : 'Create a cycle'}</div>
    <h1 class="num" style="font-size:34px;letter-spacing:.02em;margin-bottom:20px">${esc(d.name)}</h1>

    <label class="field"><span class="label">Name</span><input class="input" id="s-name" value="${esc(d.name)}"></label>
    <div class="two">
      <label class="field"><span class="label">Start</span><input class="input" type="date" id="s-start" value="${d.start}"></label>
      <label class="field"><span class="label">End</span><input class="input" type="date" id="s-end" value="${d.end}"></label>
    </div>
    <div class="chips" style="margin:-4px 0 8px">${DURATIONS.map(([l], i) => `<button class="chip" data-dur="${i}">${l}</button>`).join('')}</div>
    <p class="hint" style="margin:4px 0 22px">${len ? `${len}일 · 약 ${Math.round(len / 7)}주` : '종료일을 시작일 이후로 정해 주세요'}</p>

    <div class="section-head"><h2 class="eyebrow">Goals</h2></div>
    <div id="s-goals">
      ${d.goals.map((g, i) => `<div class="goal-block">
        <div class="plan-row" style="grid-template-columns:1fr 64px 40px;margin:0">
          <input class="input" data-gf="label" data-i="${i}" value="${esc(g.label)}" placeholder="목표 이름">
          <input class="input" data-gf="unit" data-i="${i}" value="${esc(g.unit)}" placeholder="단위">
          <button class="icon-btn" data-grm="${i}" aria-label="목표 삭제">×</button>
        </div>
        <div class="goal-row" style="grid-template-columns:1fr 1fr">
          <label><span class="label">Start</span><input class="input num" data-gf="start" data-i="${i}" type="number" inputmode="decimal" step="any" value="${g.start ?? ''}"></label>
          <label><span class="label">Goal</span><input class="input num" data-gf="target" data-i="${i}" type="number" inputmode="decimal" step="any" value="${g.target ?? ''}"></label>
        </div>
        <label class="small muted" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" data-gf="startEstimated" data-i="${i}" ${g.startEstimated ? 'checked' : ''}> 시작값은 추정치</label>
      </div>`).join('')}
    </div>
    <div class="chips" style="margin-bottom:24px">${GOAL_PRESETS.map((p, i) => `<button class="chip" data-gadd="${i}">+ ${p.label || '직접 입력'}</button>`).join('')}</div>

    <div class="section-head"><h2 class="eyebrow">Plan · 매주 Session</h2></div>
    <div id="s-plan">
      ${d.plan.map((p, i) => `<div class="plan-row">
        <select class="input" data-pf="dow" data-i="${i}">${DOW_KO.map((k, j) => `<option value="${j}" ${p.dow === j ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <input class="input" data-pf="label" data-i="${i}" value="${esc(p.label)}" placeholder="예: Run">
        <button class="icon-btn" data-prm="${i}" aria-label="Session 삭제">×</button>
      </div>`).join('')}
    </div>
    <button class="btn quiet" id="p-add">+ Session 추가</button>

    <div style="margin-top:28px"><button class="btn block" id="s-save">${editing ? '변경 저장' : 'Cycle 시작하기'}</button></div>`;

  const sync = () => {
    d.name = $('#s-name').value.trim() || d.name;
    d.start = $('#s-start').value; d.end = $('#s-end').value;
    $$('[data-gf]').forEach(el => {
      const g = d.goals[+el.dataset.i], f = el.dataset.gf;
      g[f] = f === 'startEstimated' ? el.checked : (f === 'start' || f === 'target') ? (el.value === '' ? null : parseFloat(el.value)) : el.value;
    });
    $$('[data-pf]').forEach(el => {
      const p = d.plan[+el.dataset.i];
      p[el.dataset.pf] = el.dataset.pf === 'dow' ? +el.value : el.value;
    });
  };
  const rerender = () => { sync(); renderSetup(view); };
  const cancel = $('#cancel'); if (cancel) cancel.onclick = () => { setupDraft = null; go('cycle'); };
  $('#s-start').onchange = rerender; $('#s-end').onchange = rerender;
  $$('[data-dur]').forEach(b => b.onclick = () => { sync(); if (d.start) d.end = DURATIONS[+b.dataset.dur][1](d.start); renderSetup(view); });
  $$('[data-gadd]').forEach(b => b.onclick = () => { sync(); const p = GOAL_PRESETS[+b.dataset.gadd]; d.goals.push({ id: uid(), type: p.type, label: p.label, unit: p.unit, step: p.step, start: null, target: null, startEstimated: false }); renderSetup(view); });
  $$('[data-grm]').forEach(b => b.onclick = () => { sync(); d.goals.splice(+b.dataset.grm, 1); renderSetup(view); });
  $$('[data-prm]').forEach(b => b.onclick = () => { sync(); d.plan.splice(+b.dataset.prm, 1); renderSetup(view); });
  $('#p-add').onclick = () => { sync(); d.plan.push({ dow: 1, label: '' }); renderSetup(view); };
  $('#s-save').onclick = () => {
    sync();
    if (!d.start || !d.end || d.end < d.start) return toast('기간을 확인해 주세요');
    const bad = d.goals.find(g => !g.label.trim() || g.start == null || g.target == null || !Number.isFinite(g.start) || !Number.isFinite(g.target));
    if (bad) return toast('목표 이름·시작값·목표값을 모두 채워 주세요');
    d.plan = d.plan.filter(p => p.label.trim());
    if (editing) {
      Object.assign(cycleById(d.id), { name: d.name, start: d.start, end: d.end, plan: d.plan, goals: d.goals });
      toast('Cycle을 수정했어요');
    } else {
      db.cycles.push({ id: uid(), name: d.name, start: d.start, end: d.end, plan: d.plan, goals: d.goals, status: 'active', createdAt: Date.now() });
      toast(`${d.name} 시작 — Your goal. Your pace.`);
    }
    save(); setupDraft = null; go('home');
  };
}

/* ——— completion ——— */
let completeView = null; // id of a past cycle to view, else the active one
function renderComplete(view) {
  const c = completeView ? cycleById(completeView) : activeCycle();
  if (!c) { completeView = null; return go('home'); }
  const reviewing = c.status === 'complete';
  const planned = plannedSessions(c);
  const done = planned.filter(s => isDone(c, s.date, s.slot)).length;
  const st = cycleStats(c);
  const days = diffDays(c.start, c.end) + 1;
  view.innerHTML = `
    <header class="topbar"><div class="wordmark">${MARK}PACE</div><button class="btn quiet" id="back">${reviewing ? '닫기' : '돌아가기'}</button></header>
    <div class="complete-hero">
      <div class="eyebrow">${esc(c.name)}${reviewing ? ' · complete' : ''}</div>
      <h1>${reviewing ? 'CYCLE COMPLETE' : st.after ? 'CYCLE COMPLETE' : 'LOOK BACK'}</h1>
      <div class="muted small" style="margin-top:6px">${short(c.start)} — ${short(c.end)} · ${days}일</div>
    </div>
    <section class="card" style="margin-top:22px;padding:4px 18px">
      ${c.goals.map(g => {
        const cur = currentValue(g);
        return `<div class="change"><span class="label">${esc(g.label)}</span><span style="text-align:right"><span class="num">${fmtVal(g.start, g)} → <b>${fmtVal(cur, g)}</b> <span class="muted small">${esc(g.unit)}</span></span>
          <span class="small muted" style="display:block">${cur == null ? '기록 없음' : `${fmtDelta(cur - g.start, g)} · 목표 ${fmtVal(g.target, g)}`}</span></span></div>`;
      }).join('')}
      <div class="change"><span class="label">Sessions</span><span class="num"><b>${done}</b> / ${planned.length}</span></div>
    </section>
    ${reviewing ? '' : `
      <p class="next-q">Ready for your next pace?</p>
      <button class="btn block" id="next">Create ${nextCycleName()}</button>
      <p class="hint" style="margin-top:10px;text-align:center">지금 Cycle은 기록과 함께 보관되고, 마지막 기록값이 다음 Cycle의 시작값으로 이어져요.</p>`}`;
  $('#back').onclick = () => { completeView = null; go(reviewing ? 'cycle' : 'home'); };
  const next = $('#next');
  if (next) next.onclick = () => {
    c.status = 'complete'; c.completedAt = Date.now(); save();
    setupDraft = freshDraft(); go('setup');
  };
}

/* ——— backup ——— */
async function exportBackup() {
  db.lastBackup = new Date().toISOString();
  save();
  const name = `pace-backup-${today()}.json`;
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'PACE backup' });
      render(); return toast('백업 파일을 저장했어요');
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  render(); toast('백업 파일을 저장했어요');
}
function importBackup() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.cycles) || !Array.isArray(data.measurements)) throw new Error('format');
      if (db.cycles.length && !confirm('지금 기기의 기록을 백업 파일 내용으로 바꿀까요?')) return;
      db = { version: 1, sessions: [], logs: [], body: [], lastBackup: null, ...data };
      save(); go('home'); toast('백업을 불러왔어요');
    } catch (e) { toast('PACE 백업 파일이 아니에요'); }
  };
  input.click();
}

/* ——— boot ——— */
render();
document.addEventListener('visibilitychange', () => { if (!document.hidden && route !== 'setup') render(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
