const config = window.TICKET_CLUB_CONFIG || { mockMode: true };
const liveMode = config.mockMode === false;
const authStorageKey = 'ticket-club-auth';

const state = {
  page: 'board',
  students: [
    { id: 'ava', name: 'Ava Patel', grade: '8', balance: 86, active: true },
    { id: 'noah', name: 'Noah Williams', grade: '7', balance: 54, active: true },
    { id: 'mia', name: 'Mia Chen', grade: '6', balance: 32, active: true },
    { id: 'leo', name: 'Leo Martinez', grade: '7', balance: 118, active: true },
    { id: 'sophia', name: 'Sophia Brown', grade: '8', balance: 17, active: false }
  ],
  prizes: [
    { id: 'pencil', name: 'Fancy pencil', cost: 25, stock: 24, icon: '✏️', description: 'A colorful mechanical pencil.' },
    { id: 'stickers', name: 'Sticker sheet', cost: 40, stock: 18, icon: '⭐', description: 'A sheet of math and puzzle stickers.' },
    { id: 'pin', name: 'Math champion pin', cost: 100, stock: 6, icon: '🏆', description: 'A special enamel pin for big milestones.' }
  ],
  history: [
    { id: 1, date: '2026-09-29T17:42:00', studentId: 'ava', type: 'earn', amount: 10, reason: 'Solved team challenge', coach: 'Coach Morgan' },
    { id: 2, date: '2026-09-29T17:31:00', studentId: 'noah', type: 'redeem', amount: -25, reason: 'Redeemed: Fancy pencil', coach: 'Coach Morgan' },
    { id: 3, date: '2026-09-29T17:18:00', studentId: 'mia', type: 'earn', amount: 5, reason: 'Helpful teammate', coach: 'Coach Morgan' },
    { id: 4, date: '2026-09-22T16:55:00', studentId: 'leo', type: 'earn', amount: 20, reason: 'Completed logic puzzle', coach: 'Coach Morgan' }
  ],
  filters: { student: 'all', type: 'all', search: '' },
  modal: null,
  auth: JSON.parse(sessionStorage.getItem(authStorageKey) || 'null'),
  loading: false
};

const app = document.querySelector('#app');
const escapeHtml = (text) => String(text).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const studentById = (id) => state.students.find((student) => student.id === id);
const formatDate = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const totalAwarded = () => state.history.filter((event) => event.amount > 0).reduce((sum, event) => sum + event.amount, 0);

function isConfigured() {
  return Boolean(config.apiUrl && config.cognito?.region && config.cognito?.userPoolClientId);
}

function saveAuth(tokens) {
  state.auth = tokens;
  sessionStorage.setItem(authStorageKey, JSON.stringify(tokens));
}

function clearAuth() {
  state.auth = null;
  sessionStorage.removeItem(authStorageKey);
}

async function cognitoRequest(target, body) {
  const endpoint = `https://cognito-idp.${config.cognito.region}.amazonaws.com/`;
  const result = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body)
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.message || 'Unable to sign in.');
  return payload;
}

function storeAuthentication(result) {
  const tokens = result.AuthenticationResult;
  saveAuth({
    idToken: tokens.IdToken,
    accessToken: tokens.AccessToken,
    refreshToken: tokens.RefreshToken || state.auth?.refreshToken,
    expiresAt: Date.now() + (tokens.ExpiresIn * 1000)
  });
}

async function signIn(username, password) {
  const result = await cognitoRequest('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: config.cognito.userPoolClientId,
    AuthParameters: { USERNAME: username, PASSWORD: password }
  });
  if (result.ChallengeName === 'NEW_PASSWORD_REQUIRED') return { challenge: result, username };
  storeAuthentication(result);
  return { challenge: null };
}

async function setNewPassword(challenge, username, password) {
  const result = await cognitoRequest('RespondToAuthChallenge', {
    ClientId: config.cognito.userPoolClientId,
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    Session: challenge.Session,
    ChallengeResponses: { USERNAME: username, NEW_PASSWORD: password }
  });
  storeAuthentication(result);
}

async function idToken() {
  if (!state.auth?.idToken) throw new Error('Please sign in again.');
  if (Date.now() < state.auth.expiresAt - 60000) return state.auth.idToken;
  if (!state.auth.refreshToken) { clearAuth(); throw new Error('Your session has expired. Please sign in again.'); }
  const result = await cognitoRequest('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: config.cognito.userPoolClientId,
    AuthParameters: { REFRESH_TOKEN: state.auth.refreshToken }
  });
  storeAuthentication(result);
  return state.auth.idToken;
}

async function apiRequest(path, options = {}) {
  const token = await idToken();
  const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'The request could not be completed.');
  return payload;
}

async function refreshLiveData() {
  state.loading = true;
  render();
  try {
    const [students, prizes, history] = await Promise.all([apiRequest('/students'), apiRequest('/prizes'), apiRequest('/history')]);
    state.students = students.students;
    state.prizes = prizes.prizes.map((prize) => ({ ...prize, icon: '🎁', description: 'A reward students can redeem with tickets.' }));
    state.history = history.events.map((event) => ({ ...event, coach: event.actor }));
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
    render();
  }
}

function navigation() {
  const items = [['board', '▦', 'Ticket board'], ['students', '♟', 'Students'], ['prizes', '🎁', 'Prizes'], ['history', '◷', 'History']];
  const modeNote = liveMode
    ? '<strong>Live data mode</strong>Changes are saved to the protected Ticket Club ledger.'
    : '<strong>Mock-data mode</strong>Your changes stay in this browser session. AWS data storage comes next.';
  return `<aside class="sidebar"><div class="nav-label">Math club</div>${items.map(([id, icon, label]) => `<button class="nav-button ${state.page === id ? 'active' : ''}" data-page="${id}" type="button"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}<div class="sidebar-note">${modeNote}</div></aside>`;
}

function heading(title, subtitle, action = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function boardPage() {
  const active = state.students.filter((student) => student.active);
  return `${heading('Ticket board', 'Quickly award tickets during today’s math club.', '<button class="button primary" data-action="open-adjust" type="button">＋ Add custom tickets</button>')}
  <div class="metrics"><div class="metric"><div class="metric-label">Active students</div><div class="metric-value">${active.length}</div><div class="metric-detail">Ready for today’s club</div></div><div class="metric"><div class="metric-label">Tickets awarded</div><div class="metric-value">${totalAwarded()}</div><div class="metric-detail">In this demo ledger</div></div><div class="metric"><div class="metric-label">Available prizes</div><div class="metric-value">${state.prizes.length}</div><div class="metric-detail">${state.prizes.reduce((sum, prize) => sum + prize.stock, 0)} items in stock</div></div></div>
  <section class="panel"><div class="panel-header"><h2>Students</h2><button class="button secondary small" data-page="students" type="button">Manage students</button></div><div class="table-wrap"><table><thead><tr><th>Student</th><th>Ticket balance</th><th>Quick add</th></tr></thead><tbody>${active.map((student) => `<tr><td><span class="student-name">${escapeHtml(student.name)}</span><span class="student-meta">Grade ${student.grade}</span></td><td class="balance">${student.balance} tickets</td><td><div class="ticket-actions"><button class="quick-ticket" data-action="quick-add" data-student="${student.id}" data-amount="1" type="button">+1</button><button class="quick-ticket" data-action="quick-add" data-student="${student.id}" data-amount="5" type="button">+5</button><button class="quick-ticket" data-action="quick-add" data-student="${student.id}" data-amount="10" type="button">+10</button><button class="quick-ticket custom" data-action="open-adjust" data-student="${student.id}" type="button" aria-label="Custom ticket amount for ${escapeHtml(student.name)}">•••</button></div></td></tr>`).join('')}</tbody></table></div></section>`;
}
function studentsPage() {
  const term = state.filters.search.toLowerCase();
  const filtered = state.students.filter((student) => student.name.toLowerCase().includes(term));
  return `${heading('Students', 'Add, update, or deactivate students.', '<button class="button primary" data-action="open-student" type="button">＋ Add student</button>')}<section class="panel"><div class="filters"><label class="field">Search students<input data-filter="search" value="${escapeHtml(state.filters.search)}" placeholder="Search by name" /></label></div><div class="table-wrap"><table><thead><tr><th>Student</th><th>Grade</th><th>Status</th><th>Tickets</th><th></th></tr></thead><tbody>${filtered.map((student) => `<tr><td class="student-name">${escapeHtml(student.name)}</td><td>Grade ${student.grade}</td><td><span class="status ${student.active ? 'active' : 'inactive'}">${student.active ? 'Active' : 'Inactive'}</span></td><td class="balance">${student.balance}</td><td><button class="button secondary small" data-action="toggle-student" data-student="${student.id}" type="button">${student.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>`).join('') || '<tr><td class="empty" colspan="5">No students match your search.</td></tr>'}</tbody></table></div></section>`;
}
function prizesPage() {
  return `${heading('Prize catalog', 'Set ticket costs and redeem rewards for students.', '<button class="button primary" data-action="open-prize" type="button">＋ Add prize</button>')}<div class="prize-grid">${state.prizes.map((prize) => `<article class="prize-card"><div class="prize-icon">${prize.icon}</div><h2>${escapeHtml(prize.name)}</h2><p>${escapeHtml(prize.description)}</p><div class="prize-cost">${prize.cost} tickets</div><div class="prize-footer"><span class="stock">${prize.stock} remaining</span><button class="button secondary small" data-action="open-redeem" data-prize="${prize.id}" type="button" ${prize.stock === 0 ? 'disabled' : ''}>Redeem</button></div></article>`).join('')}</div>`;
}
function historyPage() {
  const events = state.history.filter((event) => (state.filters.student === 'all' || event.studentId === state.filters.student) && (state.filters.type === 'all' || event.type === state.filters.type));
  return `${heading('Ticket history', 'A permanent-style ledger of ticket additions and redemptions.', '<button class="button secondary" data-action="export-history" type="button">⇩ Export CSV</button>')}<section class="panel"><div class="filters"><label class="field">Student<select data-filter="student"><option value="all">All students</option>${state.students.map((student) => `<option value="${student.id}" ${state.filters.student === student.id ? 'selected' : ''}>${escapeHtml(student.name)}</option>`).join('')}</select></label><label class="field">Activity<select data-filter="type"><option value="all">All activity</option><option value="earn" ${state.filters.type === 'earn' ? 'selected' : ''}>Ticket awards</option><option value="redeem" ${state.filters.type === 'redeem' ? 'selected' : ''}>Redemptions</option></select></label><label class="field">Entries shown<input value="${events.length} events" disabled /></label></div><div class="table-wrap"><table><thead><tr><th>Date &amp; time</th><th>Student / activity</th><th>Coach</th><th>Change</th></tr></thead><tbody>${events.map((event) => { const student = studentById(event.studentId); return `<tr><td>${formatDate(event.date)}</td><td><span class="student-name">${escapeHtml(student.name)}</span><span class="activity-reason">${escapeHtml(event.reason)}</span></td><td>${escapeHtml(event.coach)}</td><td class="change ${event.amount > 0 ? 'positive' : 'negative'}">${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)}</td></tr>`; }).join('') || '<tr><td class="empty" colspan="4">No history matches these filters.</td></tr>'}</tbody></table></div></section>`;
}
function modal() {
  if (!state.modal) return '';
  if (state.modal.kind === 'adjust') { const options = state.students.filter((student) => student.active).map((student) => `<option value="${student.id}" ${state.modal.studentId === student.id ? 'selected' : ''}>${escapeHtml(student.name)} — ${student.balance} tickets</option>`).join(''); return `<div class="modal-backdrop" role="presentation"><form class="modal" data-form="adjust"><h2>Add tickets</h2><p>Record a ticket award with a reason for the history log.</p><div class="modal-form"><label class="field">Student<select name="studentId">${options}</select></label><label class="field">Tickets to add<input class="amount-input" name="amount" type="number" min="1" value="5" required /></label><label class="field">Reason<input name="reason" placeholder="e.g. Completed a challenge" required /></label><div class="form-error" aria-live="polite"></div></div><div class="modal-actions"><button class="button secondary" data-action="close-modal" type="button">Cancel</button><button class="button primary" type="submit">Add tickets</button></div></form></div>`; }
  if (state.modal.kind === 'student') return `<div class="modal-backdrop" role="presentation"><form class="modal" data-form="student"><h2>Add student</h2><p>Add a student to the ticket board.</p><div class="modal-form"><label class="field">Student name<input name="name" placeholder="Full name" required /></label><label class="field">Grade<select name="grade"><option>6</option><option>7</option><option>8</option></select></label><div class="form-error" aria-live="polite"></div></div><div class="modal-actions"><button class="button secondary" data-action="close-modal" type="button">Cancel</button><button class="button primary" type="submit">Add student</button></div></form></div>`;
  if (state.modal.kind === 'prize') return `<div class="modal-backdrop" role="presentation"><form class="modal" data-form="prize"><h2>Add prize</h2><p>Create a reward students can redeem with tickets.</p><div class="modal-form"><label class="field">Prize name<input name="name" placeholder="e.g. Puzzle cube" required /></label><label class="field">Ticket cost<input name="cost" type="number" min="1" value="25" required /></label><label class="field">Starting stock<input name="stock" type="number" min="0" value="10" required /></label><div class="form-error" aria-live="polite"></div></div><div class="modal-actions"><button class="button secondary" data-action="close-modal" type="button">Cancel</button><button class="button primary" type="submit">Add prize</button></div></form></div>`;
  const prize = state.prizes.find((item) => item.id === state.modal.prizeId); const options = state.students.filter((student) => student.active).map((student) => `<option value="${student.id}">${escapeHtml(student.name)} — ${student.balance} tickets</option>`).join(''); return `<div class="modal-backdrop" role="presentation"><form class="modal" data-form="redeem"><h2>Redeem ${escapeHtml(prize.name)}</h2><p>This reward costs <strong>${prize.cost} tickets</strong> and has ${prize.stock} remaining.</p><div class="modal-form"><label class="field">Student<select name="studentId">${options}</select></label><div class="form-error" aria-live="polite"></div></div><div class="modal-actions"><button class="button secondary" data-action="close-modal" type="button">Cancel</button><button class="button primary" type="submit">Redeem prize</button></div></form></div>`;
}
function authPage() {
  const configurationError = !isConfigured() ? '<div class="form-error">Add the deployed API URL, region, and Cognito client ID to config.js before signing in.</div>' : '';
  return `<div class="auth-shell"><form class="auth-card" data-form="login"><div class="brand"><span class="brand-mark">★</span>Ticket Club</div><h1>Coach sign in</h1><p>Use your coach account to securely manage student tickets and prize redemptions.</p><div class="modal-form"><label class="field">Email address<input name="username" type="email" autocomplete="username" required /></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required /></label>${configurationError}<div class="form-error" aria-live="polite"></div></div><button class="button primary" type="submit" ${isConfigured() ? '' : 'disabled'}>Sign in</button><p class="auth-help">Contact your math club administrator if you need an account or password reset.</p></form></div>`;
}

function newPasswordPage() {
  return `<div class="auth-shell"><form class="auth-card" data-form="new-password"><div class="brand"><span class="brand-mark">★</span>Ticket Club</div><h1>Set your password</h1><p>Cognito requires you to replace the temporary password before continuing.</p><div class="modal-form"><label class="field">New password<input name="password" type="password" autocomplete="new-password" minlength="12" required /></label><label class="field">Confirm new password<input name="confirmation" type="password" autocomplete="new-password" minlength="12" required /></label><div class="form-error" aria-live="polite"></div></div><button class="button primary" type="submit">Save password and sign in</button></form></div>`;
}

function render() {
  if (liveMode && state.auth?.challenge) { app.innerHTML = newPasswordPage(); return; }
  if (liveMode && !state.auth) { app.innerHTML = authPage(); return; }
  if (state.loading) { app.innerHTML = '<div class="loading">Loading Ticket Club…</div>'; return; }
  const pages = { board: boardPage, students: studentsPage, prizes: prizesPage, history: historyPage };
  const coach = liveMode ? 'Signed-in coach' : 'Coach Morgan';
  const logout = liveMode ? '<button class="button secondary small" data-action="logout" type="button">Sign out</button>' : '';
  app.innerHTML = `<div class="app-shell"><header class="app-header"><div class="brand"><span class="brand-mark">★</span>Ticket Club</div><div class="coach"><span class="coach-avatar">M</span><span>${coach}</span>${logout}</div></header><div class="layout">${navigation()}<main class="content">${pages[state.page]()}</main></div></div>${modal()}`;
}
function addEvent(studentId, amount, reason, type = 'earn') { const student = studentById(studentId); student.balance += amount; state.history.unshift({ id: Date.now(), date: new Date().toISOString(), studentId, type, amount, reason, coach: 'Coach Morgan' }); }
function toast(message) { const item = document.createElement('div'); item.className = 'toast'; item.textContent = message; document.body.append(item); setTimeout(() => item.remove(), 2600); }
function downloadCsv() { const rows = [['Date', 'Student', 'Type', 'Change', 'Reason', 'Coach'], ...state.history.map((event) => [new Date(event.date).toISOString(), studentById(event.studentId).name, event.type, event.amount, event.reason, event.coach])]; const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ticket-history.csv'; anchor.click(); URL.revokeObjectURL(url); }

app.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.page) { state.page = button.dataset.page; render(); return; }
  const action = button.dataset.action;
  try {
    if (action === 'logout') { clearAuth(); render(); return; }
    if (action === 'quick-add') {
      const student = studentById(button.dataset.student);
      const amount = Number(button.dataset.amount);
      if (liveMode) await apiRequest('/ticket-events', { method: 'POST', body: JSON.stringify({ studentId: student.id, amount, reason: 'Quick ticket award' }) });
      else addEvent(student.id, amount, 'Quick ticket award');
      if (liveMode) await refreshLiveData(); else render();
      toast(`${amount} ticket${amount === 1 ? '' : 's'} added to ${student.name}`);
    }
    if (action === 'open-adjust') { state.modal = { kind: 'adjust', studentId: button.dataset.student || state.students.find((student) => student.active).id }; render(); }
    if (action === 'open-student') { state.modal = { kind: 'student' }; render(); }
    if (action === 'open-prize') { state.modal = { kind: 'prize' }; render(); }
    if (action === 'open-redeem') { state.modal = { kind: 'redeem', prizeId: button.dataset.prize }; render(); }
    if (action === 'close-modal') { state.modal = null; render(); }
    if (action === 'toggle-student') {
      const student = studentById(button.dataset.student);
      const nextActiveState = !student.active;
      if (liveMode) await apiRequest(`/students/${student.id}`, { method: 'PATCH', body: JSON.stringify({ active: nextActiveState }) });
      else student.active = nextActiveState;
      if (liveMode) await refreshLiveData(); else render();
      toast(`${student.name} is now ${nextActiveState ? 'active' : 'inactive'}`);
    }
    if (action === 'export-history') downloadCsv();
  } catch (error) { toast(error.message); }
});
app.addEventListener('input', (event) => { if (event.target.dataset.filter === 'search') { state.filters.search = event.target.value; render(); } });
app.addEventListener('change', (event) => { if (event.target.dataset.filter) { state.filters[event.target.dataset.filter] = event.target.value; render(); } });
app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const error = form.querySelector('.form-error');
  try {
    if (form.dataset.form === 'login') {
      const result = await signIn(data.get('username'), data.get('password'));
      if (result.challenge) { state.auth = { challenge: result.challenge, username: result.username }; render(); return; }
      await refreshLiveData();
      return;
    }
    if (form.dataset.form === 'new-password') {
      if (data.get('password') !== data.get('confirmation')) { error.textContent = 'The passwords do not match.'; return; }
      await setNewPassword(state.auth.challenge, state.auth.username, data.get('password'));
      await refreshLiveData();
      return;
    }
    if (form.dataset.form === 'adjust') {
      const amount = Number(data.get('amount'));
      if (!Number.isInteger(amount) || amount < 1) { error.textContent = 'Enter a whole number of at least 1.'; return; }
      const student = studentById(data.get('studentId'));
      if (liveMode) await apiRequest('/ticket-events', { method: 'POST', body: JSON.stringify({ studentId: student.id, amount, reason: data.get('reason') }) });
      else addEvent(student.id, amount, data.get('reason'));
      state.modal = null;
      if (liveMode) await refreshLiveData(); else render();
      toast(`${amount} tickets added to ${student.name}`);
    }
    if (form.dataset.form === 'student') {
      const name = data.get('name').trim();
      if (!name) { error.textContent = 'Enter a student name.'; return; }
      if (liveMode) await apiRequest('/students', { method: 'POST', body: JSON.stringify({ name, grade: data.get('grade') }) });
      else state.students.push({ id: `student-${Date.now()}`, name, grade: data.get('grade'), balance: 0, active: true });
      state.modal = null; state.page = 'students';
      if (liveMode) await refreshLiveData(); else render();
      toast(`${name} added to Ticket Club`);
    }
    if (form.dataset.form === 'prize') {
      const name = data.get('name').trim(); const cost = Number(data.get('cost')); const stock = Number(data.get('stock'));
      if (!name || !Number.isInteger(cost) || cost < 1 || !Number.isInteger(stock) || stock < 0) { error.textContent = 'Enter a name, ticket cost, and stock quantity.'; return; }
      if (liveMode) await apiRequest('/prizes', { method: 'POST', body: JSON.stringify({ name, cost, stock }) });
      else state.prizes.push({ id: `prize-${Date.now()}`, name, cost, stock, icon: '🎲', description: 'A new prize for the ticket shop.' });
      state.modal = null; state.page = 'prizes';
      if (liveMode) await refreshLiveData(); else render();
      toast(`${name} added to the prize catalog`);
    }
    if (form.dataset.form === 'redeem') {
      const student = studentById(data.get('studentId')); const prize = state.prizes.find((item) => item.id === state.modal.prizeId);
      if (!liveMode && student.balance < prize.cost) { error.textContent = `${student.name} needs ${prize.cost - student.balance} more tickets.`; return; }
      if (liveMode) await apiRequest('/redemptions', { method: 'POST', body: JSON.stringify({ studentId: student.id, prizeId: prize.id }) });
      else { addEvent(student.id, -prize.cost, `Redeemed: ${prize.name}`, 'redeem'); prize.stock -= 1; }
      state.modal = null;
      if (liveMode) await refreshLiveData(); else render();
      toast(`${prize.name} redeemed for ${student.name}`);
    }
  } catch (exception) { error.textContent = exception.message; }
});
app.addEventListener('click', (event) => { if (event.target.classList.contains('modal-backdrop')) { state.modal = null; render(); } });
if (liveMode && state.auth) refreshLiveData();
else render();
