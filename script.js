"use strict";
const lockInConfig = window.LOCKIN_CONFIG || {};
const configured = !!(lockInConfig.supabaseUrl && lockInConfig.supabaseAnonKey);
let db = null;
if (configured) db = supabase.createClient(lockInConfig.supabaseUrl, lockInConfig.supabaseAnonKey);
const gate = document.getElementById('gate'), onboard = document.getElementById('onboard'), app = document.getElementById('app');
const todayStr = () => new Date().toISOString().slice(0, 10);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function uid() { return Math.random().toString(36).slice(2, 9); }
function icon(name, size) { const s = size || 20; return '<svg width="' + s + '" height="' + s + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

const SUBJECT_COLORS = [
  { bg: '#6C4DF6', fg: '#fff', dark: '#4227C4' },
  { bg: '#FF7A45', fg: '#fff', dark: '#C9501E' },
  { bg: '#12BF9D', fg: '#06392E', dark: '#0A8A70' },
  { bg: '#FFC736', fg: '#4A3600', dark: '#C99200' },
  { bg: '#FF5C8A', fg: '#fff', dark: '#C92E5C' },
  { bg: '#3DA5FF', fg: '#fff', dark: '#1A72C4' }
];
function subjectColor(name) {
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SUBJECT_COLORS[h % SUBJECT_COLORS.length];
}
function subjectIcon(name) {
  const n = String(name || '').toLowerCase();
  if (/bio|chem|physic|science|anatomy|lab/.test(n)) return 'flask';
  if (/math|calc|algebra|geometr|stat|trig|precal/.test(n)) return 'atom';
  if (/history|geo|social|civic|gov|econ|world/.test(n)) return 'globe';
  return 'book';
}
function subjectBadge(name, small) {
  const c = subjectColor(name);
  return '<div class="subject-badge' + (small ? ' sm' : '') + '" style="background:' + c.bg + ';color:' + c.fg + ';box-shadow:0 4px 0 ' + c.dark + '">' + icon(subjectIcon(name), small ? 15 : 20) + '</div>';
}

let user = null, state = null;

function blankState() {
  return {
    name: '', level: 'High school', classes: [], prefs: {},
    plans_made: 0, reels_answered: 0, reels_correct: 0,
    streak: 0, last_active: null, daily: {}, topic_mastery: {}, onboarded: false
  };
}

function dbRowToClass(row) {
  return { id: row.id, name: row.name, difficulty: row.difficulty || 'medium', nextTest: row.next_test || '', context: row.context || '' };
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
      streak: data.streak || 0, last_active: data.last_active || null, daily: data.daily || {},
      topic_mastery: data.topic_mastery || {}, onboarded: !!data.onboarded
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
      streak: state.streak, last_active: state.last_active, daily: state.daily,
      topic_mastery: state.topic_mastery, onboarded: state.onboarded,
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
  const hasExtraPrefs = !!(p.attention || p.session || (p.distraction || []).length || (p.motivation || []).length);
  setMorePrefsOpen(hasExtraPrefs);
  gotoStep(1); window.scrollTo({ top: 0 });
}
function setMorePrefsOpen(open) {
  document.getElementById('morePrefs').classList.toggle('open', open);
  document.getElementById('toggleMorePrefs').textContent = open ? '− Hide extra questions' : '+ Add more about how you study (optional)';
}
document.getElementById('toggleMorePrefs').addEventListener('click', () => {
  setMorePrefsOpen(!document.getElementById('morePrefs').classList.contains('open'));
});
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
function classRowHTML(c, opts) {
  opts = opts || {};
  const bcls = c.difficulty === 'hard' ? 'b-hard' : c.difficulty === 'easy' ? 'b-easy' : 'b-med';
  const meta = c.nextTest ? ('Test: ' + c.nextTest) : '';
  let html = '<div class="classitem">' + subjectBadge(c.name)
    + '<div class="grow"><div class="cname">' + esc(c.name) + '</div>'
    + '<div class="cmeta"><span class="badge ' + bcls + '">' + esc(c.difficulty || 'medium') + '</span>'
    + (meta ? '<span style="white-space:nowrap">' + esc(meta) + '</span>' : '') + '</div></div>';
  if (opts.editable) {
    html += '<button class="path-btn" data-id="' + c.id + '" title="Open class path">' + icon('trail', 17) + '</button>';
    html += '<button class="notes-toggle" data-id="' + c.id + '" title="Add notes">' + icon('note', 17) + '</button>';
  }
  html += '<button class="rm" data-id="' + c.id + '" title="Remove">' + icon('x', 17) + '</button></div>';
  if (opts.editable) {
    html += '<div class="class-notes" id="classNotes-' + c.id + '" style="display:none">'
      + '<textarea id="classNotesInput-' + c.id + '" rows="3" placeholder="Paste your syllabus, notes, or anything Lock In should know about this class">' + esc(c.context || '') + '</textarea>'
      + '<button class="btn ghost sm save-notes" data-id="' + c.id + '">Save notes</button>'
      + '</div>';
  }
  return html;
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
document.getElementById('scanScheduleBtn').addEventListener('click', () => document.getElementById('scheduleFile').click());
document.getElementById('scheduleFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = document.getElementById('scanStatus');
  status.innerHTML = '<div class="loading"><span class="spinner"></span> Reading your schedule...</div>';
  try {
    const base64 = await readFileAsBase64(file);
    const prompt = 'You are extracting a list of class or course names from a photo of a student\'s class schedule, school portal screenshot, or printed timetable. Identify each distinct class or course (e.g. "AP Biology", "Algebra II", "World History"). Do not include room numbers, teacher names, periods, or times as separate entries. Respond ONLY with valid JSON, no markdown: {"classes":[{"name":"string"}]}. If you cannot confidently identify any classes, return {"classes":[]}.';
    const raw = await askAI(prompt, { data: base64, mediaType: file.type || 'image/jpeg' });
    const parsed = extractJSON(raw);
    const found = Array.isArray(parsed && parsed.classes) ? parsed.classes.filter(c => c && c.name) : [];
    if (!found.length) { status.innerHTML = '<div class="err">Couldn\'t find any classes in that image. Try a clearer photo, or add them manually below.</div>'; return; }
    const existingNames = new Set(obClasses.map(c => c.name.toLowerCase()));
    let added = 0;
    found.forEach(c => {
      const name = String(c.name).trim();
      if (!name || existingNames.has(name.toLowerCase())) return;
      obClasses.push({ id: uid(), name, difficulty: 'medium', nextTest: '' });
      existingNames.add(name.toLowerCase());
      added++;
    });
    renderObClasses();
    status.innerHTML = added
      ? '<div class="ok">Added ' + added + ' class' + (added === 1 ? '' : 'es') + ' from your schedule. Check the difficulty for each below.</div>'
      : '<div class="err">Those classes are already in your list.</div>';
  } catch (err) {
    status.innerHTML = '<div class="err">' + esc(err.message || 'Could not read that schedule. Try again or add classes manually.') + '</div>';
  }
});
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
function classContext(list) {
  return (list || state.classes).map(c => {
    let line = c.name + ' (' + (c.difficulty || 'medium') + (c.nextTest ? ', next test ' + c.nextTest : '') + ')';
    if (c.context) line += ' — notes: ' + c.context.slice(0, 800);
    return line;
  }).join('; ');
}
function weakTopicsSummary() {
  const mastery = state.topic_mastery || {};
  const weak = Object.keys(mastery)
    .map(topic => ({ topic, ...mastery[topic] }))
    .filter(t => (t.total || 0) >= 2 && (t.correct || 0) / t.total < 0.6)
    .sort((a, b) => (a.correct / a.total) - (b.correct / b.total))
    .slice(0, 5);
  if (!weak.length) return '';
  return weak.map(t => t.topic + ' (' + Math.round(100 * t.correct / t.total) + '% correct)').join(', ');
}
function prefsContext() {
  const p = state.prefs || {};
  const weak = weakTopicsSummary();
  return 'Focuses best: ' + (p.focus || 'n/a') + '. Attention span: ' + (p.attention || 'n/a') + '. Likes methods: ' + ((p.methods || []).join(', ') || 'n/a') + '. Biggest distractions: ' + ((p.distraction || []).join(', ') || 'n/a') + '. Motivated by: ' + ((p.motivation || []).join(', ') || 'n/a') + '. Preferred session length: ' + (p.session || 'n/a') + '. Goal: ' + (p.goal || 'n/a') + '.' + (weak ? ' Known weak topics from past reels (prioritize these): ' + weak + '.' : '');
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
  box.innerHTML = state.classes.map(c => classRowHTML(c, { editable: true })).join('') || '<p class="hint">No classes yet - add one below.</p>';
  box.querySelectorAll('.rm').forEach(b => b.addEventListener('click', async () => {
    const { error } = await db.from('classes').delete().eq('id', b.dataset.id);
    if (error) { console.warn(error); return; }
    state.classes = state.classes.filter(x => x.id !== b.dataset.id);
    renderHome();
  }));
  box.querySelectorAll('.notes-toggle').forEach(b => b.addEventListener('click', () => {
    const panel = document.getElementById('classNotes-' + b.dataset.id);
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }));
  box.querySelectorAll('.path-btn').forEach(b => b.addEventListener('click', () => openClassPath(b.dataset.id)));
  box.querySelectorAll('.save-notes').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.id;
    const context = document.getElementById('classNotesInput-' + id).value.trim();
    const old = b.textContent; b.textContent = 'Saving...'; b.disabled = true;
    const { error } = await db.from('classes').update({ context: context || null }).eq('id', id);
    b.disabled = false;
    if (error) { console.warn(error); b.textContent = 'Error'; setTimeout(() => { b.textContent = old; }, 1500); return; }
    const cls = state.classes.find(x => x.id === id);
    if (cls) cls.context = context;
    b.textContent = 'Saved'; setTimeout(() => { b.textContent = old; }, 1200);
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

async function askAI(prompt, image) {
  if (!db) throw new Error('AI is not set up.');
  const body = image ? { prompt, image } : { prompt };
  const { data, error } = await db.functions.invoke('ai', { body });
  if (error) throw new Error(error.message || 'AI request failed.');
  if (!data || typeof data.text !== 'string') throw new Error((data && data.error) || 'AI response was missing text.');
  return data.text;
}
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
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
function showPanel(name) {
  panels.forEach(p => p.classList.toggle('active', p.id === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function goTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  showPanel(name);
  if (name === 'plan') renderPlanPicker();
  if (name === 'reels') renderReelPicker();
  if (name === 'progress') renderProgress();
}
tabs.forEach(t => t.addEventListener('click', () => goTab(t.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => goTab(el.dataset.go)));
document.getElementById('pathBack').addEventListener('click', () => goTab('home'));

/* ---------- class path: a winding trail through one class's topics ---------- */
const TRAIL_W = 350, NODE_GAP = 170, TRAIL_X = [175, 100, 175, 250];
let pathTopicLabel = '';

function classTopics(id) { return ((state.prefs && state.prefs.class_topics) || {})[id] || null; }
function setClassTopics(id, topics) {
  if (!state.prefs) state.prefs = {};
  if (!state.prefs.class_topics) state.prefs.class_topics = {};
  state.prefs.class_topics[id] = topics;
  save();
}
function masteryFor(topic) {
  const m = state.topic_mastery || {};
  if (m[topic]) return m[topic];
  const key = Object.keys(m).find(k => k.toLowerCase() === String(topic).toLowerCase());
  return key ? m[key] : null;
}
function topicState(topic) {
  const m = masteryFor(topic);
  if (!m || !m.total) return 'new';
  return (m.correct / m.total) >= 0.6 ? 'done' : 'weak';
}
async function generateClassTopics(cls) {
  const prompt = 'You are Lock In, a study app. List the core topics of the class "' + cls.name + '" for a ' + state.level + ' student, in the order they are normally taught.'
    + (cls.context ? ' Base it on these notes from the student: ' + cls.context.slice(0, 1200) : '')
    + ' Give between 5 and 8 topics. Each topic is 1-4 words and specific enough to quiz on. Respond ONLY with valid JSON, no markdown: {"topics":["string"]}';
  const parsed = extractJSON(await askAI(prompt));
  const topics = parsed && Array.isArray(parsed.topics)
    ? parsed.topics.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()).slice(0, 8) : [];
  if (!topics.length) throw new Error('The AI did not return any topics for this class. Try again.');
  return topics;
}
async function openClassPath(id) {
  const cls = state.classes.find(c => c.id === id);
  if (!cls) return;
  const col = subjectColor(cls.name), badge = document.getElementById('pathBadge');
  badge.style.background = col.bg; badge.style.color = col.fg; badge.style.boxShadow = '0 4px 0 ' + col.dark;
  badge.innerHTML = icon(subjectIcon(cls.name), 20);
  document.getElementById('pathTitle').textContent = cls.name;
  document.getElementById('pathMeta').textContent = (cls.difficulty || 'medium') + (cls.nextTest ? ' · test ' + cls.nextTest : '');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'home'));
  showPanel('classpath');
  const trail = document.getElementById('pathTrail'), side = document.getElementById('pathSide');
  let topics = classTopics(id);
  if (!topics || !topics.length) {
    trail.innerHTML = '<div class="loading"><span class="spinner"></span> Mapping out the topics in this class...</div>';
    side.innerHTML = '';
    try {
      topics = await generateClassTopics(cls);
      setClassTopics(id, topics);
    } catch (e) {
      trail.innerHTML = '<div class="err">' + esc(e.message || 'Could not build a path for this class yet.') + '</div>';
      side.innerHTML = '<button class="btn ghost block" id="pathRetry">Try again</button>';
      document.getElementById('pathRetry').addEventListener('click', () => openClassPath(id));
      return;
    }
  }
  renderClassPath(cls, topics);
}
function renderClassPath(cls, topics) {
  const n = topics.length, states = topics.map(topicState);
  const doneCount = states.filter(s => s === 'done').length;
  const allDone = doneCount === n;
  let currentIdx = states.findIndex(s => s !== 'done');
  if (currentIdx < 0) currentIdx = n - 1;

  const trophyY = 46, firstY = trophyY + 140, pos = [];
  for (let k = 0; k < n; k++) pos[n - 1 - k] = { x: TRAIL_X[k % TRAIL_X.length], y: firstY + k * NODE_GAP };
  const startY = firstY + (n - 1) * NODE_GAP + 128, height = startY + 50;

  const pts = [{ x: 175, y: startY }].concat(pos, [{ x: 175, y: trophyY }]);
  const seg = (a, b) => { const mid = (a.y + b.y) / 2; return 'C' + a.x + ',' + mid + ' ' + b.x + ',' + mid + ' ' + b.x + ',' + b.y; };
  const line = (from, to) => { let d = 'M' + pts[from].x + ',' + pts[from].y; for (let i = from + 1; i <= to; i++) d += seg(pts[i - 1], pts[i]); return d; };
  const cut = allDone ? pts.length - 1 : currentIdx + 1;
  const pct = x => (x / TRAIL_W * 100).toFixed(2) + '%';

  let html = '<div class="trail" style="height:' + height + 'px">';
  html += '<svg class="line" viewBox="0 0 ' + TRAIL_W + ' ' + height + '" preserveAspectRatio="none">';
  html += '<path d="' + line(0, cut) + '" fill="none" stroke="#12BF9D" stroke-width="13" stroke-linecap="round"/>';
  if (cut < pts.length - 1) html += '<path d="' + line(cut, pts.length - 1) + '" fill="none" stroke="#E0CFB6" stroke-width="13" stroke-linecap="round" stroke-dasharray="1 24"/>';
  html += '</svg>';

  html += '<div class="trophy" style="left:calc(50% - 44px);top:' + (trophyY - 44) + 'px' + (allDone ? ';background:#FFC736;color:#4A3600;box-shadow:0 6px 0 #C99200' : '') + '">'
    + icon('trophy', 30) + '<span' + (allDone ? ' style="color:#4A3600"' : '') + '>Mastered</span></div>';

  topics.forEach((t, i) => {
    const p = pos[i], st = states[i], isCur = !allDone && i === currentIdx;
    const cl = isCur ? 'node current' : st === 'done' ? 'node done' : st === 'weak' ? 'node weak' : 'node';
    const ic = isCur ? 'play' : st === 'done' ? 'check' : st === 'weak' ? 'redo' : 'lock';
    const half = isCur ? 42 : 36;
    const m = masteryFor(t);
    const sub = m && m.total
      ? Math.round(100 * m.correct / m.total) + '% mastery'
      : (isCur ? 'Start here' : 'Not practised yet');
    if (isCur) html += '<div class="node-ring" style="left:calc(' + pct(p.x) + ' - 52px);top:' + (p.y - 52) + 'px;width:104px;height:104px"></div>';
    html += '<button class="' + cl + '" data-topic="' + esc(t) + '" style="left:calc(' + pct(p.x) + ' - ' + half + 'px);top:' + (p.y - half) + 'px">' + icon(ic, 26) + '</button>';
    html += '<div class="node-label" style="left:calc(' + pct(p.x) + ' - 80px);top:' + (p.y + half + 10) + 'px"><b>' + esc(t) + '</b><br><small>' + esc(sub) + '</small></div>';
    if (isCur) {
      const tagX = p.x <= 175 ? 'calc(' + pct(p.x) + ' + 52px)' : 'calc(' + pct(p.x) + ' - 162px)';
      html += '<div class="here-tag" style="left:' + tagX + ';top:' + (p.y - 19) + 'px">You\'re here</div>';
    }
  });

  html += '<div class="path-start" style="left:calc(50% - 32px);top:' + (startY - 12) + 'px">' + icon('flag', 18) + 'Start</div>';
  html += '</div>';

  const trail = document.getElementById('pathTrail');
  trail.innerHTML = html;
  trail.querySelectorAll('.node').forEach(b => b.addEventListener('click', () => startTopicReels(b.dataset.topic)));

  let side = '<div class="card"><h2>' + doneCount + ' of ' + n + ' topics</h2>'
    + '<div class="progressbar"><i style="width:' + Math.round(100 * doneCount / n) + '%"></i></div>'
    + '<p class="sub" style="margin:10px 0 0">Each topic turns green once you answer its reels above 60%. Weak ones turn orange and get priority in your next plan.</p></div>';
  if (allDone) {
    side += '<div class="card" style="background:var(--teal-tint)"><h2>Path complete</h2><p class="sub" style="margin:6px 0 0">Every topic in ' + esc(cls.name) + ' is above 60%. Run a mixed set to keep it sharp.</p>'
      + '<button class="btn block" id="pathStart">Practice a mixed set</button></div>';
  } else {
    side += '<div class="card" style="background:var(--violet-tint)"><h2>Up next</h2>'
      + '<p style="margin:6px 0 0;font-family:var(--display);font-weight:800;font-size:18px">' + esc(topics[currentIdx]) + '</p>'
      + '<button class="btn block" id="pathStart">Practice this topic</button></div>';
  }
  document.getElementById('pathSide').innerHTML = side;
  document.getElementById('pathStart').addEventListener('click', () => startTopicReels(allDone ? cls.name : topics[currentIdx]));
}
function startTopicReels(topic) {
  pathTopicLabel = topic;
  goTab('reels');
  document.getElementById('reelTopic').value = topic;
  document.getElementById('genReels').click();
}
document.getElementById('reelTopic').addEventListener('input', e => {
  if (e.target.value.trim() !== pathTopicLabel) pathTopicLabel = '';
});

function renderPlanPicker() {
  const box = document.getElementById('planClassPick');
  if (!state.classes.length) { box.innerHTML = '<p class="hint">Add classes on the Home tab first.</p>'; return; }
  box.innerHTML = state.classes.map(c => '<label class="checkrow"><input type="checkbox" value="' + c.id + '" checked><span class="nm">' + esc(c.name) + '</span> <span class="badge ' + (c.difficulty === 'hard' ? 'b-hard' : c.difficulty === 'easy' ? 'b-easy' : 'b-med') + '">' + esc(c.difficulty || 'medium') + '</span>' + (c.nextTest ? '<span class="cmeta" style="margin-left:auto">test ' + esc(c.nextTest) + '</span>' : '') + '</label>').join('');
}
function buildFallbackPlan(chosen, extra, daysCount, hoursPerDay) {
  const classes = chosen.length ? chosen : [{ name: 'your classes', difficulty: 'medium', nextTest: '' }];
  const rank = { hard: 0, medium: 1, easy: 2 };
  const sorted = [...classes].sort((a, b) => {
    const diff = (rank[a.difficulty] ?? 1) - (rank[b.difficulty] ?? 1);
    if (diff !== 0) return diff;
    if (a.nextTest && b.nextTest) return a.nextTest < b.nextTest ? -1 : 1;
    if (a.nextTest) return -1;
    if (b.nextTest) return 1;
    return 0;
  });
  const sessionsPerDay = hoursPerDay >= 3 ? 3 : hoursPerDay === 2 ? 2 : 1;
  const minutesPerBlock = hoursPerDay ? Math.max(25, Math.round((hoursPerDay * 60) / sessionsPerDay / 5) * 5) : 45;
  const phases = ['Foundation', 'Practice', 'Review'];
  const days = [];
  for (let i = 0; i < daysCount; i++) {
    const date = new Date(); date.setDate(date.getDate() + i);
    const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const progress = daysCount === 1 ? 1 : i / (daysCount - 1);
    const phase = progress > 0.66 ? phases[2] : progress > 0.33 ? phases[1] : phases[0];
    const blocks = [];
    for (let b = 0; b < sessionsPerDay; b++) {
      const cls = sorted[(i * sessionsPerDay + b) % sorted.length];
      blocks.push({
        time: minutesPerBlock + ' min',
        subject: cls.name,
        task: phase === 'Review'
          ? 'Timed practice on ' + cls.name + ', mark every mistake.'
          : phase === 'Practice'
            ? 'Active practice problems on ' + cls.name + ' instead of rereading notes.'
            : 'Build summary notes or flashcards for ' + cls.name + '.',
        technique: phase === 'Review' ? 'Practice test' : phase === 'Practice' ? 'Active recall' : 'Note-building'
      });
    }
    days.push({ day: label, focus: phase + ' phase', blocks });
  }
  return {
    summary: 'A steady ' + daysCount + '-day plan across ' + sorted.length + ' class' + (sorted.length === 1 ? '' : 'es') + (extra ? '. Also keeping in mind: ' + extra + '.' : '.'),
    days,
    tips: [
      'Start with the easiest step in each block so the session has a quick win.',
      'Protect the first five minutes of a block before motivation catches up.',
      'Finish each block with a 2-minute self-check: what still feels shaky?'
    ]
  };
}
async function saveStudyPlan(input, plan, source) {
  if (!user || !db) return;
  const { error } = await db.from('study_plans').insert({ user_id: user.id, input, plan, source });
  if (error) console.warn('saveStudyPlan error', error);
}
document.getElementById('genPlan').addEventListener('click', async () => {
  const btn = document.getElementById('genPlan'), out = document.getElementById('planOut'), err = document.getElementById('planErr');
  err.innerHTML = '';
  const picked = [...document.querySelectorAll('#planClassPick input:checked')].map(i => i.value);
  const chosen = state.classes.filter(c => picked.includes(c.id));
  const extra = document.getElementById('planDeadlines').value.trim();
  const stuck = document.getElementById('planStuck').value.trim();
  if (!chosen.length && !extra) { err.innerHTML = '<div class="err">Select at least one class (or add extra deadlines).</div>'; return; }
  const daysStr = document.getElementById('planDays').value, hoursStr = document.getElementById('planHours').value;
  const daysCount = Number(daysStr);
  const hoursPerDay = parseInt(hoursStr, 10) || 2;
  const input = { class_ids: picked, days: daysCount, hours_per_day: hoursPerDay, extra_notes: extra, stuck_on: stuck };
  btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Building...';
  out.innerHTML = '<div class="card"><div class="loading"><span class="spinner"></span> Designing a plan around your classes and study style...</div></div>';
  const prompt = 'You are Lock In, an AI study coach that helps students beat procrastination with plans tailored to how they actually study. Build a personalized ' + daysStr + '-day study plan.\nSTUDENT: ' + (state.name || 'a student') + ' (' + state.level + ').\nCLASSES TO COVER (including any notes/syllabus content they provided): ' + (classContext(chosen) || 'general study') + '.\nOTHER DEADLINES: ' + (extra || 'none') + '.\nWHAT THEY SAY THEY ARE STUCK ON RIGHT NOW: ' + (stuck || 'nothing specified') + '.\nSTUDY TIME PER DAY: ' + hoursStr + '.\nSTUDY PROFILE: ' + prefsContext() + '\nUse their profile: schedule harder/nearer-deadline classes during their best focus time, size each work block near their attention span and preferred session length, and prefer the study methods they like. Directly counter their biggest distraction and lean on what motivates them. If they told you what they are stuck on or gave class notes, target that specifically instead of generic review. Keep tasks small, specific and achievable.\nRespond ONLY with valid JSON, no markdown:\n{"summary":"one motivating sentence","days":[{"day":"Day 1 (label)","focus":"theme","blocks":[{"time":"25 min","subject":"Biology","task":"specific task","technique":"Active recall"}]}],"tips":["tip","tip","tip"]}';
  let plan = null, source = 'ai';
  try {
    const raw = await askAI(prompt);
    plan = extractJSON(raw);
    if (!plan || !Array.isArray(plan.days)) throw new Error('AI response was not a usable plan.');
  } catch (e) {
    plan = buildFallbackPlan(chosen, extra, daysCount, hoursPerDay);
    source = 'fallback';
  }
  try {
    renderPlan(plan, source);
    state.plans_made = (state.plans_made || 0) + 1;
    touchStreak(); save();
    document.getElementById('streakNum').textContent = state.streak || 0;
    saveStudyPlan(input, plan, source);
  } finally {
    btn.disabled = false; btn.innerHTML = old;
  }
});
function renderPlan(plan, source) {
  let html = '<div class="card"><h2>Your personalized plan</h2>';
  if (source === 'fallback') html += '<p class="hint">AI is temporarily unavailable — here\'s a plan built from your profile instead.</p>';
  if (plan.summary) html += '<div class="plan-summary">' + esc(plan.summary) + '</div>';
  plan.days.forEach((d, di) => {
    html += '<div class="day d' + (di % 3) + '"><div class="day-head"><span>' + esc(d.day || 'Day') + '</span><span class="focus">' + esc(d.focus || '') + '</span></div>';
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
  const weak = weakTopicsSummary();
  const forced = (pathTopicLabel && topic === pathTopicLabel) ? ' Use exactly this string as the "topic" field of every reel: "' + pathTopicLabel + '".' : '';
  const prompt = 'You are Lock In, generating a feed of bite-sized study reels for ' + (state.name || 'a student') + ' (' + state.level + '). Topic(s): ' + scope + '. They like these study methods: ' + ((state.prefs.methods || []).join(', ') || 'quizzing') + '.' + (weak ? ' They have historically struggled with: ' + weak + ' — weight questions toward these when relevant to the chosen topic(s).' : '') + forced + ' Create 6 engaging reels mixing multiple-choice (4 options) and a couple flashcards. Punchy, social-media friendly, varied difficulty, short memorable explanations. Respond ONLY with valid JSON array of 6 objects:\n[{"type":"mcq","topic":"label","question":"q","options":["A","B","C","D"],"answerIndex":0,"explanation":"why"},{"type":"flash","topic":"label","question":"term","answer":"ans","explanation":"context"}]';
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
      q.addEventListener('click', () => { if (ans.classList.contains('show')) return; ans.classList.add('show'); recordReel(true, c.topic); });
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
        recordReel(ok, c.topic);
      }));
    }
    track.appendChild(reel);
  });
}
function recordReel(correct, topic) {
  state.reels_answered = (state.reels_answered || 0) + 1;
  if (correct) state.reels_correct = (state.reels_correct || 0) + 1;
  const t = todayStr();
  state.daily[t] = (state.daily[t] || 0) + 1;
  if (topic) {
    if (!state.topic_mastery) state.topic_mastery = {};
    const prev = state.topic_mastery[topic] || { correct: 0, total: 0 };
    state.topic_mastery[topic] = { correct: prev.correct + (correct ? 1 : 0), total: prev.total + 1 };
  }
  save();
}

let chart = null;
function renderProgress() {
  const streak = state.streak || 0;
  document.getElementById('stStreak').textContent = streak;
  document.getElementById('stPlans').textContent = state.plans_made || 0;
  document.getElementById('stReels').textContent = state.reels_answered || 0;
  const acc = state.reels_answered ? Math.round(100 * state.reels_correct / state.reels_answered) : null;
  document.getElementById('stAcc').textContent = acc == null ? '-' : acc + '%';
  document.getElementById('streakDays').textContent = streak;
  document.getElementById('streakCap').textContent = state.last_active === todayStr()
    ? 'Locked in today. Keep it rolling.'
    : (streak ? 'Answer one reel today to keep it alive.' : 'Answer a reel or build a plan to start your streak.');

  const labels = [], data = [], dots = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5), key = d.toISOString().slice(0, 10);
    const short = d.toLocaleDateString(undefined, { weekday: 'short' });
    const count = state.daily[key] || 0;
    labels.push(short); data.push(count);
    dots.push('<span class="daydot' + (count ? ' on' : '') + '">' + esc(short.slice(0, 1)) + '</span>');
  }
  document.getElementById('weekRow').innerHTML = dots.join('');
  renderWeakList();
  const ctx = document.getElementById('actChart');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Reels', data, backgroundColor: '#FFC736', borderColor: '#241748', borderWidth: 3, borderRadius: 10, maxBarThickness: 46 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: '#7C6E99', font: { family: 'Nunito', weight: '800' } }, grid: { color: '#F0E2CC' } },
        x: { ticks: { color: '#7C6E99', font: { family: 'Nunito', weight: '800' } }, grid: { display: false } }
      }
    }
  });
}
function topicStats(limit) {
  const mastery = state.topic_mastery || {};
  return Object.keys(mastery)
    .map(topic => ({ topic, correct: mastery[topic].correct || 0, total: mastery[topic].total || 0 }))
    .filter(t => t.total >= 2)
    .sort((a, b) => (a.correct / a.total) - (b.correct / b.total))
    .slice(0, limit || 5);
}
function renderWeakList() {
  const box = document.getElementById('weakList');
  const rows = topicStats(5).filter(t => t.correct / t.total < 0.8);
  if (!rows.length) { box.innerHTML = '<p class="hint">Answer a few reels and the topics you keep missing will show up here.</p>'; return; }
  box.innerHTML = rows.map(t => {
    const pct = Math.round(100 * t.correct / t.total);
    return '<div class="weakrow">' + subjectBadge(t.topic, true)
      + '<div style="flex:1;min-width:0"><div class="wn">' + esc(t.topic) + '</div>'
      + '<div class="progressbar"><i style="width:' + pct + '%;background:' + (pct < 60 ? '#FF7A45' : '#FFC736') + '"></i></div></div>'
      + '<span class="badge ' + (pct < 60 ? 'b-hard' : 'b-med') + '" style="margin:0">' + pct + '%</span></div>';
  }).join('');
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
