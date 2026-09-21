"use strict";
const lockInConfig = window.LOCKIN_CONFIG || {};
const configured = !!(lockInConfig.supabaseUrl && lockInConfig.supabaseAnonKey);
let db = null;
if (configured) db = supabase.createClient(lockInConfig.supabaseUrl, lockInConfig.supabaseAnonKey);
const gate = document.getElementById('gate'), onboard = document.getElementById('onboard'), app = document.getElementById('app');
const todayStr = () => new Date().toISOString().slice(0, 10);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function uid() { return Math.random().toString(36).slice(2, 9); }
let user = null, state = null;

function blankState() {
  return {
    name: '', level: 'High school', classes: [], prefs: {},
    plans_made: 0, reels_answered: 0, reels_correct: 0,
    streak: 0, last_active: null, daily: {}, onboarded: false
  };
}

function dbRowToClass(row) {
  return { id: row.id, name: row.name, difficulty: row.difficulty || 'medium', nextTest: row.next_test || '' };
}

function buildPills(container) {
  const single = container.dataset.single, multi = container.dataset.multi;
  const items = (single || multi).split('|');
  container.innerHTML = items.map(t => '<button type="button" class="pill" data-val="' + esc(t) + '">' + esc(t) + '</button>').join('');
  container.querySelectorAll('.pill').forEach(p => p.addEventListener('click', () => {
    if (single) { container.querySelectorAll('.pill').forEach(x => x.classList.remove('on')); p.classList.add('on'); }
    else { p.classList.toggle('on'); }
  }));
}
function pillValue(c) { const el = c.querySelector('.pill.on'); return el ? el.dataset.val : ''; }
function pillValues(c) { return [...c.querySelectorAll('.pill.on')].map(x => x.dataset.val); }
function setPill(c, v) { c.querySelectorAll('.pill').forEach(x => x.classList.toggle('on', x.dataset.val === v)); }
function setPills(c, vals) { const s = new Set(vals || []); c.querySelectorAll('.pill').forEach(x => x.classList.toggle('on', s.has(x.dataset.val))); }
['oLevel', 'qFocus', 'qAttention', 'qMethods', 'qDistraction', 'qMotivation', 'qSession'].forEach(id => buildPills(document.getElementById(id)));

let authMode = 'login';
if (!configured) {
  document.getElementById('configWarn').innerHTML = '<div class="err">Not connected - add your Supabase URL and anon key in config.js.</div>';
  document.getElementById('authBtn').disabled = true;
}
document.querySelectorAll('#authtabs button').forEach(b => b.addEventListener('click', () => {
  authMode = b.dataset.mode;
  document.querySelectorAll('#authtabs button').forEach(x => x.classList.toggle('active', x === b));
  document.getElementById('authBtn').textContent = authMode === 'login' ? 'Log in' : 'Create account';
  document.getElementById('authMsg').innerHTML = '';
}));
document.getElementById('authBtn').addEventListener('click', doAuth);
document.getElementById('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });

async function doAuth() {
  const email = document.getElementById('authEmail').value.trim(), pass = document.getElementById('authPass').value;
  const msg = document.getElementById('authMsg'), btn = document.getElementById('authBtn');
  msg.innerHTML = '';
  if (!email || !pass) { msg.innerHTML = '<div class="err">Enter your email and password.</div>'; return; }
  btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Working...';
  try {
    if (authMode === 'signup') {
      const { data, error } = await db.auth.signUp({ email, password: pass });
      if (error) throw error;
      if (!data.session) msg.innerHTML = '<div class="ok">Account created! Check your email to confirm, then log in.</div>';
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
  } catch (e) {
    msg.innerHTML = '<div class="err">' + esc(e.message || 'Something went wrong.') + '</div>';
  } finally {
    btn.disabled = false; btn.innerHTML = old;
  }
}
document.getElementById('logoutBtn').addEventListener('click', async () => { if (db) await db.auth.signOut(); });
if (db) {
  db.auth.getSession().then(({ data }) => handleSession(data.session));
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      if (session && session.user) user = session.user;
      return;
    }
    handleSession(session);
  });
}

async function handleSession(session) {
  if (session && session.user) {
    user = session.user;
    document.getElementById('userMail').textContent = user.email;
    await loadProfile();
  } else {
    user = null; state = null;
    gate.style.display = 'block'; onboard.style.display = 'none'; app.style.display = 'none';
  }
}

async function loadProfile() {
  state = blankState();
  const { data, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) console.warn(error);
  if (data) {
    Object.assign(state, {
      name: data.name || '', level: data.level || 'High school', prefs: data.prefs || {},
      plans_made: data.plans_made || 0, reels_answered: data.reels_answered || 0, reels_correct: data.reels_correct || 0,
      streak: data.streak || 0, last_active: data.last_active || null, daily: data.daily || {}, onboarded: !!data.onboarded
    });
  } else {
    await db.from('profiles').insert({ id: user.id });
  }
  const { data: classRows, error: classError } = await db.from('classes').select('*').eq('user_id', user.id).order('created_at');
  if (classError) console.warn(classError);
  state.classes = (classRows || []).map(dbRowToClass);
  gate.style.display = 'none';
  if (state.onboarded) { showApp(); } else { startOnboarding(); }
}

let saveTimer = null;
function save() {
  if (!user || !db) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const row = {
      id: user.id, name: state.name, level: state.level, prefs: state.prefs,
      plans_made: state.plans_made, reels_answered: state.reels_answered, reels_correct: state.reels_correct,
      streak: state.streak, last_active: state.last_active, daily: state.daily, onboarded: state.onboarded,
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('profiles').upsert(row);
    if (error) console.warn('save error', error);
  }, 400);
}

function touchStreak() {
  const t = todayStr();
  if (state.last_active === t) return;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  state.streak = (state.last_active === y) ? (state.streak || 0) + 1 : 1;
  state.last_active = t;
}

async function replaceClasses(classList) {
  await db.from('classes').delete().eq('user_id', user.id);
  if (!classList.length) { state.classes = []; return; }
  const { data, error } = await db.from('classes').insert(
    classList.map(c => ({ user_id: user.id, name: c.name, difficulty: c.difficulty || 'medium', next_test: c.nextTest || null }))
  ).select();
  if (error) { console.warn('replaceClasses error', error); return; }
  state.classes = (data || []).map(dbRowToClass);
}

let obClasses = [];
function startOnboarding() {
  gate.style.display = 'none'; app.style.display = 'none'; onboard.style.display = 'block';
  document.getElementById('oName').value = state.name || '';
  setPill(document.getElementById('oLevel'), state.level || 'High school');
  obClasses = (state.classes || []).map(c => ({ ...c }));
  renderObClasses();
  const p = state.prefs || {};
  setPill(document.getElementById('qFocus'), p.focus || '');
  setPill(document.getElementById('qAttention'), p.attention || '');
  setPills(document.getElementById('qMethods'), p.methods || []);
  setPills(document.getElementById('qDistraction'), p.distraction || []);
  setPills(document.getElementById('qMotivation'), p.motivation || []);
  setPill(document.getElementById('qSession'), p.session || '');
  document.getElementById('qGoal').value = p.goal || '';
  gotoStep(1); window.scrollTo({ top: 0 });
}
function gotoStep(n) {
  document.querySelectorAll('.wstep').forEach(s => s.classList.toggle('active', +s.dataset.step === n));
  document.querySelectorAll('.progress .seg').forEach((s, i) => s.classList.toggle('on', i < n));
  const labels = { 1: 'Step 1 of 3 - About you', 2: 'Step 2 of 3 - Your classes', 3: 'Step 3 of 3 - How you study' };
  document.getElementById('stepLabel').textContent = labels[n];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderObClasses() {
  const box = document.getElementById('classList');
  box.innerHTML = obClasses.map(c => classRowHTML(c)).join('') || '<p class="hint">No classes added yet.</p>';
  box.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => { obClasses = obClasses.filter(x => x.id !== b.dataset.id); renderObClasses(); }));
}
function classRowHTML(c) {
  const bcls = c.difficulty === 'hard' ? 'b-hard' : c.difficulty === 'easy' ? 'b-easy' : 'b-med';
  const meta = c.nextTest ? ('Test: ' + c.nextTest) : '';
  return '<div class="classitem"><div class="grow"><span class="cname">' + esc(c.name) + '</span><span class="badge ' + bcls + '">' + esc(c.difficulty || 'medium') + '</span><div class="cmeta">' + esc(meta) + '</div></div><button class="rm" data-id="' + c.id + '" title="Remove">&times;</button></div>';
}
document.getElementById('addClass').addEventListener('click', () => {
  const name = document.getElementById('cName').value.trim();
  const err = document.getElementById('classErr'); err.innerHTML = '';
  if (!name) { err.innerHTML = '<div class="err">Type a class name first.</div>'; return; }
  obClasses.push({ id: uid(), name, difficulty: document.getElementById('cDiff').value, nextTest: document.getElementById('cDate').value || '' });
  document.getElementById('cName').value = ''; document.getElementById('cDate').value = '';
  renderObClasses();
});
document.getElementById('cName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addClass').click(); } });
document.getElementById('s1next').addEventListener('click', () => {
  const name = document.getElementById('oName').value.trim();
  if (!name) { alert('Please enter your name.'); return; }
  gotoStep(2);
});
document.getElementById('s2back').addEventListener('click', () => gotoStep(1));
document.getElementById('s2next').addEventListener('click', () => {
  const err = document.getElementById('classErr'); err.innerHTML = '';
  if (!obClasses.length) { err.innerHTML = '<div class="err">Add at least one class to continue.</div>'; return; }
  gotoStep(3);
});
document.getElementById('s3back').addEventListener('click', () => gotoStep(2));
document.getElementById('finishOb').addEventListener('click', async () => {
  const btn = document.getElementById('finishOb'); btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Saving...';
  state.name = document.getElementById('oName').value.trim();
  state.level = pillValue(document.getElementById('oLevel')) || 'High school';
  state.prefs = {
    focus: pillValue(document.getElementById('qFocus')), attention: pillValue(document.getElementById('qAttention')),
    methods: pillValues(document.getElementById('qMethods')), distraction: pillValues(document.getElementById('qDistraction')),
    motivation: pillValues(document.getElementById('qMotivation')), session: pillValue(document.getElementById('qSession')),
    goal: document.getElementById('qGoal').value.trim()
  };
  state.onboarded = true;
  await replaceClasses(obClasses);
  save();
  btn.disabled = false; btn.innerHTML = old;
  showApp();
});
function showApp() { gate.style.display = 'none'; onboard.style.display = 'none'; app.style.display = 'block'; renderHome(); goTab('home'); }
document.getElementById('editSetup').addEventListener('click', e => { e.preventDefault(); startOnboarding(); });

function classNames() { return state.classes.map(c => c.name); }
function classContext(list) { return (list || state.classes).map(c => c.name + ' (' + (c.difficulty || 'medium') + (c.nextTest ? ', next test ' + c.nextTest : '') + ')').join('; '); }
function prefsContext() {
  const p = state.prefs || {};
  return 'Focuses best: ' + (p.focus || 'n/a') + '. Attention span: ' + (p.attention || 'n/a') + '. Likes methods: ' + ((p.methods || []).join(', ') || 'n/a') + '. Biggest distractions: ' + ((p.distraction || []).join(', ') || 'n/a') + '. Motivated by: ' + ((p.motivation || []).join(', ') || 'n/a') + '. Preferred session length: ' + (p.session || 'n/a') + '. Goal: ' + (p.goal || 'n/a') + '.';
}
function renderHome() {
  document.getElementById('greeting').textContent = state.name ? ('Ready to lock in, ' + esc(state.name) + '?') : 'Ready to lock in?';
  const n = state.classes.length;
  document.getElementById('heroStatus').textContent = 'Tracking ' + n + ' class' + (n === 1 ? '' : 'es') + '. Streak: ' + (state.streak || 0) + ' day' + ((state.streak || 0) === 1 ? '' : 's') + '.';
  document.getElementById('streakNum').textContent = state.streak || 0;
  renderHomeClasses(); renderSummary();
}
function renderHomeClasses() {
  const box = document.getElementById('homeClassList');
  box.innerHTML = state.classes.map(c => classRowHTML(c)).join('') || '<p class="hint">No classes yet - add one below.</p>';
  box.querySelectorAll('.rm').forEach(b => b.addEventListener('click', async () => {
    const { error } = await db.from('classes').delete().eq('id', b.dataset.id);
    if (error) { console.warn(error); return; }
    state.classes = state.classes.filter(x => x.id !== b.dataset.id);
    renderHome();
  }));
}
document.getElementById('hAddClass').addEventListener('click', async () => {
  const name = document.getElementById('hcName').value.trim();
  if (!name) return;
  const { data, error } = await db.from('classes').insert({ user_id: user.id, name, difficulty: document.getElementById('hcDiff').value, next_test: null }).select();
  if (error) { console.warn(error); return; }
  state.classes.push(dbRowToClass(data[0]));
  document.getElementById('hcName').value = '';
  renderHome();
});
document.getElementById('hcName').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('hAddClass').click(); });
function renderSummary() {
  const p = state.prefs || {};
  const items = [['Grade level', state.level], ['Focuses best', p.focus], ['Attention span', p.attention], ['Study methods', (p.methods || []).join(', ')], ['Biggest distractions', (p.distraction || []).join(', ')], ['Motivated by', (p.motivation || []).join(', ')], ['Session length', p.session], ['Main goal', p.goal]];
  document.getElementById('profileSummary').innerHTML = items.filter(x => x[1]).map(x => '<div><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>').join('');
}

async function askAI(prompt) {
  if (!db) throw new Error('AI is not set up.');
  const { data, error } = await db.functions.invoke('ai', { body: { prompt } });
  if (error) throw new Error(error.message || 'AI request failed.');
  if (!data || typeof data.text !== 'string') throw new Error((data && data.error) || 'AI response was missing text.');
  return data.text;
}
function extractJSON(txt) {
  if (!txt) return null;
  let t = String(txt).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.search(/[\[{]/);
  if (s < 0) return null;
  const open = t[s], close = open === '{' ? '}' : ']';
  let depth = 0, end = -1, inStr = false, esc2 = false;
  for (let i = s; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc2) esc2 = false; else if (c === '\\') esc2 = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(t.slice(s, end + 1)); } catch (e) { return null; }
}

const tabs = document.querySelectorAll('.tab'), panels = document.querySelectorAll('.panel');
function goTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach(p => p.classList.toggle('active', p.id === name));
  if (name === 'plan') renderPlanPicker();
  if (name === 'reels') renderReelPicker();
  if (name === 'progress') renderProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
tabs.forEach(t => t.addEventListener('click', () => goTab(t.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => goTab(el.dataset.go)));

function renderPlanPicker() {
  const box = document.getElementById('planClassPick');
  if (!state.classes.length) { box.innerHTML = '<p class="hint">Add classes on the Home tab first.</p>'; return; }
  box.innerHTML = state.classes.map(c => '<label class="checkrow"><input type="checkbox" value="' + c.id + '" checked><span class="nm">' + esc(c.name) + '</span> <span class="badge ' + (c.difficulty === 'hard' ? 'b-hard' : c.difficulty === 'easy' ? 'b-easy' : 'b-med') + '">' + esc(c.difficulty || 'medium') + '</span>' + (c.nextTest ? '<span class="cmeta" style="margin-left:auto">test ' + esc(c.nextTest) + '</span>' : '') + '</label>').join('');
}
document.getElementById('genPlan').addEventListener('click', async () => {
  const btn = document.getElementById('genPlan'), out = document.getElementById('planOut'), err = document.getElementById('planErr');
  err.innerHTML = '';
  const picked = [...document.querySelectorAll('#planClassPick input:checked')].map(i => i.value);
  const chosen = state.classes.filter(c => picked.includes(c.id));
  const extra = document.getElementById('planDeadlines').value.trim();
  if (!chosen.length && !extra) { err.innerHTML = '<div class="err">Select at least one class (or add extra deadlines).</div>'; return; }
  const days = document.getElementById('planDays').value, hours = document.getElementById('planHours').value;
  btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Building...';
  out.innerHTML = '<div class="card"><div class="loading"><span class="spinner"></span> Designing a plan around your classes and study style...</div></div>';
  const prompt = 'You are Lock In, an AI study coach that helps students beat procrastination with plans tailored to how they actually study. Build a personalized ' + days + '-day study plan.\nSTUDENT: ' + (state.name || 'a student') + ' (' + state.level + ').\nCLASSES TO COVER: ' + (classContext(chosen) || 'general study') + '.\nOTHER DEADLINES: ' + (extra || 'none') + '.\nSTUDY TIME PER DAY: ' + hours + '.\nSTUDY PROFILE: ' + prefsContext() + '\nUse their profile: schedule harder/nearer-deadline classes during their best focus time, size each work block near their attention span and preferred session length, and prefer the study methods they like. Directly counter their biggest distraction and lean on what motivates them. Keep tasks small, specific and achievable.\nRespond ONLY with valid JSON, no markdown:\n{"summary":"one motivating sentence","days":[{"day":"Day 1 (label)","focus":"theme","blocks":[{"time":"25 min","subject":"Biology","task":"specific task","technique":"Active recall"}]}],"tips":["tip","tip","tip"]}';
  try {
    const raw = await askAI(prompt);
    const plan = extractJSON(raw);
    if (plan && Array.isArray(plan.days)) renderPlan(plan);
    else out.innerHTML = '<div class="card"><h2>Your plan</h2><div style="white-space:pre-wrap;font-size:14px">' + esc(raw) + '</div></div>';
    state.plans_made = (state.plans_made || 0) + 1;
    touchStreak(); save();
    document.getElementById('streakNum').textContent = state.streak || 0;
  } catch (e) {
    out.innerHTML = ''; err.innerHTML = '<div class="err">' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false; btn.innerHTML = old;
  }
});
function renderPlan(plan) {
  let html = '<div class="card"><h2>Your personalized plan</h2>';
  if (plan.summary) html += '<div class="plan-summary">' + esc(plan.summary) + '</div>';
  plan.days.forEach(d => {
    html += '<div class="day"><div class="day-head"><span>' + esc(d.day || 'Day') + '</span><span class="focus">' + esc(d.focus || '') + '</span></div>';
    (d.blocks || []).forEach(b => {
      html += '<div class="block"><div class="time">' + esc(b.time || '') + '</div><div class="body"><div class="subj">' + esc(b.subject || '') + '</div><div class="task">' + esc(b.task || '') + '</div>' + (b.technique ? '<span class="tech">' + esc(b.technique) + '</span>' : '') + '</div></div>';
    });
    html += '</div>';
  });
  if (Array.isArray(plan.tips) && plan.tips.length) html += '<div class="tips"><h3>Beat procrastination</h3><ul>' + plan.tips.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>';
  html += '</div>';
  document.getElementById('planOut').innerHTML = html;
}

let reelChoice = '__mix__';
function renderReelPicker() {
  const box = document.getElementById('reelClassPick');
  let html = '<button type="button" class="pill on" data-val="__mix__">Mix all classes</button>';
  html += state.classes.map(c => '<button type="button" class="pill" data-val="' + esc(c.name) + '">' + esc(c.name) + '</button>').join('');
  box.innerHTML = html; reelChoice = '__mix__';
  box.querySelectorAll('.pill').forEach(p => p.addEventListener('click', () => {
    box.querySelectorAll('.pill').forEach(x => x.classList.remove('on'));
    p.classList.add('on'); reelChoice = p.dataset.val;
    if (reelChoice !== '__mix__') document.getElementById('reelTopic').value = '';
  }));
}
document.getElementById('genReels').addEventListener('click', async () => {
  const btn = document.getElementById('genReels'), err = document.getElementById('reelErr'), vp = document.getElementById('reelViewport'), track = document.getElementById('reelTrack');
  err.innerHTML = '';
  let topic = document.getElementById('reelTopic').value.trim();
  let scope = topic;
  if (!scope) scope = reelChoice === '__mix__' ? classNames().join(', ') : reelChoice;
  if (!scope) { err.innerHTML = '<div class="err">Pick a class or type a topic.</div>'; return; }
  btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Loading...';
  const prompt = 'You are Lock In, generating a feed of bite-sized study reels for ' + (state.name || 'a student') + ' (' + state.level + '). Topic(s): ' + scope + '. They like these study methods: ' + ((state.prefs.methods || []).join(', ') || 'quizzing') + '. Create 6 engaging reels mixing multiple-choice (4 options) and a couple flashcards. Punchy, social-media friendly, varied difficulty, short memorable explanations. Respond ONLY with valid JSON array of 6 objects:\n[{"type":"mcq","topic":"label","question":"q","options":["A","B","C","D"],"answerIndex":0,"explanation":"why"},{"type":"flash","topic":"label","question":"term","answer":"ans","explanation":"context"}]';
  try {
    const raw = await askAI(prompt);
    let cards = extractJSON(raw);
    if (!Array.isArray(cards)) throw new Error("Couldn't generate reels - try again.");
    cards = cards.filter(c => c && c.question);
    if (!cards.length) throw new Error('No reels returned - try another topic.');
    buildReels(cards);
    vp.style.display = 'block'; track.scrollTop = 0;
    touchStreak(); save();
    document.getElementById('streakNum').textContent = state.streak || 0;
  } catch (e) {
    err.innerHTML = '<div class="err">' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false; btn.innerHTML = old;
  }
});
function buildReels(cards) {
  const track = document.getElementById('reelTrack'); track.innerHTML = '';
  cards.forEach(c => {
    const reel = document.createElement('div');
    reel.className = 'reel' + (c.type === 'flash' ? ' reel-flash' : '');
    if (c.type === 'flash') {
      reel.innerHTML = '<div class="tag">' + esc(c.topic || 'Flashcard') + ' - Flashcard</div><div class="q">' + esc(c.question) + '<div style="font-size:13px;font-weight:500;opacity:.7;margin-top:10px">Tap to reveal</div></div><div class="flash-answer"><b>' + esc(c.answer || '') + '</b>' + (c.explanation ? '<br><span style="opacity:.85;font-size:14px;font-weight:400">' + esc(c.explanation) + '</span>' : '') + '</div><div class="swipe">Swipe up for next</div>';
      const q = reel.querySelector('.q'), ans = reel.querySelector('.flash-answer');
      q.addEventListener('click', () => { if (ans.classList.contains('show')) return; ans.classList.add('show'); recordReel(true); });
    } else {
      const opts = (c.options || []).map((o, idx) => '<button class="opt" data-i="' + idx + '">' + esc(o) + '</button>').join('');
      reel.innerHTML = '<div class="tag">' + esc(c.topic || 'Question') + '</div><div class="q">' + esc(c.question) + '</div><div class="opts">' + opts + '</div><div class="explain"></div><div class="swipe">Swipe up for next</div>';
      const explain = reel.querySelector('.explain'), ai = typeof c.answerIndex === 'number' ? c.answerIndex : 0;
      reel.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => {
        const chosen = +b.dataset.i;
        reel.querySelectorAll('.opt').forEach(x => { x.disabled = true; if (+x.dataset.i === ai) x.classList.add('correct'); });
        const ok = chosen === ai;
        if (!ok) b.classList.add('wrong');
        explain.innerHTML = (ok ? 'Correct! ' : 'Not quite. ') + (c.explanation ? esc(c.explanation) : '');
        explain.classList.add('show');
        recordReel(ok);
      }));
    }
    track.appendChild(reel);
  });
}
function recordReel(correct) {
  state.reels_answered = (state.reels_answered || 0) + 1;
  if (correct) state.reels_correct = (state.reels_correct || 0) + 1;
  const t = todayStr();
  state.daily[t] = (state.daily[t] || 0) + 1;
  save();
}

let chart = null;
function renderProgress() {
  document.getElementById('stStreak').textContent = state.streak || 0;
  document.getElementById('stPlans').textContent = state.plans_made || 0;
  document.getElementById('stReels').textContent = state.reels_answered || 0;
  const acc = state.reels_answered ? Math.round(100 * state.reels_correct / state.reels_answered) : null;
  document.getElementById('stAcc').textContent = acc == null ? '-' : acc + '%';
  const labels = [], data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5), key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }));
    data.push(state.daily[key] || 0);
  }
  const ctx = document.getElementById('actChart');
  if (chart) chart.destroy();
  chart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Reels', data, backgroundColor: '#3a7d4d', borderRadius: 8, maxBarThickness: 44 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0, color: '#5f7059' }, grid: { color: '#d3dac8' } }, x: { ticks: { color: '#5f7059' }, grid: { display: false } } } } });
}
document.getElementById('genFeedback').addEventListener('click', async () => {
  const btn = document.getElementById('genFeedback'), box = document.getElementById('feedbackText');
  const acc = state.reels_answered ? Math.round(100 * state.reels_correct / state.reels_answered) : 0;
  btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Thinking...';
  box.textContent = '';
  const prompt = 'You are Lock In encouraging but honest AI study coach. Give ' + (state.name || 'the student') + ' short personal feedback (3-4 sentences, warm, no bullet lists). Note one win and one concrete next step to reduce procrastination, tuned to their profile.\nCLASSES: ' + classContext() + '. PROFILE: ' + prefsContext() + '\nSTATS - streak: ' + (state.streak || 0) + ' days, plans made: ' + (state.plans_made || 0) + ', reels answered: ' + (state.reels_answered || 0) + ', accuracy: ' + acc + '%.';
  try {
    const txt = await askAI(prompt);
    box.textContent = (txt || '').trim() || 'Keep going - consistency beats intensity.';
  } catch (e) {
    box.textContent = e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = old;
  }
});
