/* ===== Amethyst Web UI — Application Logic ===== */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── State ──────────────────────────────────────────────────────────
const state = {
  settings: null,
  accounts: [],
  versions: [],
  currentPage: 'home',
  currentPercent: 0,
  downloadActive: false,
  selectedVersionId: null,
  selectedVersionType: 'release',
  filterType: 'all',
  filterText: '',
}

// ── Utilities ──────────────────────────────────────────────────────
function log(message, level = 'info') {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  const el = $('#log');
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
  if (level === 'error') console.error(message);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function setProgress(percent, text) {
  state.currentPercent = Math.max(0, Math.min(100, Number(percent) || 0));

  // Mini progress in top bar
  const bar = $('#progress-mini-fill');
  const wrap = $('#topbar-progress');
  const txt = $('#progress-mini-text');
  if (bar) {
    bar.style.width = state.currentPercent + '%';
  }
  if (text && txt) txt.textContent = text;
  if (wrap && state.downloadActive) wrap.classList.add('visible');
  if (wrap && !state.downloadActive) wrap.classList.remove('visible');

  // Modal progress
  const mbar = $('#modal-progress-bar');
  const mperc = $('#modal-percent');
  if (mbar) mbar.style.width = state.currentPercent + '%';
  if (mperc) mperc.textContent = state.currentPercent + '%';
}

function setBusy(isBusy, label = 'Idle') {
  state.downloadActive = isBusy;
  if (!isBusy) {
    $('#topbar-progress')?.classList.remove('visible');
  }
  $('#topbar-status').textContent = label;
}

// ── Navigation ────────────────────────────────────────────────────
function navigateTo(page) {
  state.currentPage = page;

  // Sidebar nav
  $$('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Pages
  $$('.page').forEach((p) => {
    p.classList.toggle('active', p.id === 'page-' + page);
  });
}

// ── Settings ───────────────────────────────────────────────────────
async function loadSettings() {
  const { settings } = await api('/api/settings');
  state.settings = settings;

  // Sync all memory sliders
  $$('input[type="range"][id$="memory"], input[type="range"][id^="detail-memory"], #ql-memory, #settings-memory').forEach((slider) => {
    slider.value = settings.memoryMb;
  });
  updateMemoryLabels(settings.memoryMb);

  $('#settings-java-path').value = settings.javaPath || '';
  $('#ql-version').value = settings.lastVersion || '';
}

function updateMemoryLabels(mb) {
  const val = Number(mb);
  $$('#ql-memory-value').forEach((el) => {
    el.textContent = val;
  });
  const gb = (val / 1024).toFixed(1).replace(/\.0$/, '');
  $('#detail-ram-label').textContent = gb + ' GB';
  $('#settings-memory-display').textContent = gb + ' GB (' + val + ' MB)';
}

async function saveSettings(extra = {}) {
  const memoryMb = Number($('#settings-memory').value || $('#ql-memory').value || state.settings?.memoryMb || 2048);
  const javaPath = $('#settings-java-path').value.trim();
  const selectedVersion = $('#ql-version').value || state.settings?.lastVersion || '';
  const selectedAccount = $('[data-page="accounts"]') ? '' : ''; // handled elsewhere

  const { settings } = await api('/api/settings', {
    method: 'POST',
    body: {
      ...state.settings,
      memoryMb,
      javaPath,
      lastVersion: selectedVersion || state.settings?.lastVersion || '',
      lastAccountId: state.settings?.lastAccountId || '',
      ...extra,
    },
  });
  state.settings = settings;
  log('Settings saved.');
  return settings;
}

// ── Accounts ───────────────────────────────────────────────────────
async function loadAccounts() {
  const { accounts } = await api('/api/accounts');
  state.accounts = accounts;
  renderAccounts();
  renderAccountSelect();
}

function renderAccounts() {
  const container = $('#account-list');
  if (!container) return;

  if (!state.accounts.length) {
    container.innerHTML = `
      <div class="account-empty">
        <span class="detail-empty-icon">👻</span>
        <p>No accounts yet</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  for (const acc of state.accounts) {
    const isSelected = acc.id === state.settings?.lastAccountId;
    const firstLetter = (acc.username || '?').charAt(0).toUpperCase();
    const shortUuid = acc.uuid ? acc.uuid.substring(0, 8) + '...' : 'No UUID';

    const item = document.createElement('div');
    item.className = 'account-item' + (isSelected ? ' selected' : '');
    item.innerHTML = `
      <div class="account-avatar">${firstLetter}</div>
      <div class="account-info">
        <span class="account-name">${escHtml(acc.username)}</span>
        <span class="account-uuid">${escHtml(shortUuid)}</span>
        <div class="account-status">
          <span class="account-status-dot"></span>
          <span class="account-status-label">Offline</span>
        </div>
      </div>
      <div class="account-actions">
        <button class="select-btn ${isSelected ? 'primary' : 'ghost'}">${isSelected ? '✓ Selected' : 'Select'}</button>
        <button class="delete-btn ghost" title="Delete account">🗑️</button>
      </div>`;

    item.querySelector('.select-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      state.settings.lastAccountId = acc.id;
      await saveSettings({ lastAccountId: acc.id });
      renderAccounts();
      updateSelectedAccount();
    });

    item.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api(`/api/accounts/${encodeURIComponent(acc.id)}`, { method: 'DELETE' });
        if (state.settings?.lastAccountId === acc.id) {
          state.settings.lastAccountId = '';
          await saveSettings({ lastAccountId: '' });
        }
        await loadAccounts();
        updateSelectedAccount();
        log(`Deleted account ${acc.username}.`);
      } catch (err) {
        log(err.message, 'error');
      }
    });

    item.addEventListener('click', async () => {
      state.settings.lastAccountId = acc.id;
      await saveSettings({ lastAccountId: acc.id });
      renderAccounts();
      updateSelectedAccount();
    });

    container.append(item);
  }
}

function renderAccountSelect() {
  // Quick launch version select is updated elsewhere
  updateSelectedAccount();
}

function updateSelectedAccount() {
  const sel = $('#selected-account');
  const name = $('#selected-name');
  if (!sel || !name) return;

  const acc = state.accounts.find((a) => a.id === state.settings?.lastAccountId);
  if (acc) {
    sel.style.display = 'flex';
    name.textContent = acc.username;
  } else {
    sel.style.display = 'none';
  }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Versions ───────────────────────────────────────────────────────
async function loadVersions() {
  const data = await api('/api/versions');
  state.versions = data.versions;
  renderVersionSelect();
  renderVersionList();
  log(`Loaded ${data.versions.length} official versions from Mojang.`);
}

function renderVersionSelect() {
  const select = $('#ql-version');
  if (!select) return;

  select.innerHTML = '<option value="">Select version...</option>';
  for (const v of state.versions) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.id} · ${v.type}`;
    if (v.id === state.settings?.lastVersion) opt.selected = true;
    select.append(opt);
  }
  $('#ql-launch').disabled = !select.value;
}

function renderVersionList() {
  const container = $('#version-list');
  if (!container) return;

  const filtered = state.versions.filter((v) => {
    if (state.filterType !== 'all' && v.type !== state.filterType) return false;
    if (state.filterText && !v.id.toLowerCase().includes(state.filterText.toLowerCase())) return false;
    return true;
  });

  container.innerHTML = '';
  for (const v of filtered) {
    const dotClass = v.type === 'release' ? 'release' : v.type === 'snapshot' ? 'snapshot' : 'old-beta';
    const isSelected = v.id === state.selectedVersionId;

    const item = document.createElement('div');
    item.className = 'version-item' + (isSelected ? ' selected' : '');
    item.innerHTML = `
      <span class="version-dot ${dotClass}"></span>
      <div>
        <div class="version-name">${escHtml(v.id)}</div>
        <div class="version-type">${v.type || 'unknown'}</div>
      </div>`;

    item.addEventListener('click', () => selectVersion(v.id, v.type));
    container.append(item);
  }
}

function selectVersion(id, type) {
  state.selectedVersionId = id;
  state.selectedVersionType = type || 'release';

  // Update list selection
  $$('.version-item').forEach((item) => {
    const name = item.querySelector('.version-name');
    item.classList.toggle('selected', name && name.textContent === id);
  });

  // Update detail panel
  const empty = $('#detail-empty');
  const content = $('#detail-content');
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'flex';

  $('#detail-id').textContent = id;
  const badge = $('#detail-badge');
  badge.textContent = type || 'release';
  badge.className = 'detail-badge ' + (type || 'release');

  const v = state.versions.find((x) => x.id === id);
  const date = v?.releaseTime ? v.releaseTime.split('T')[0] : '—';
  $('#detail-date').textContent = 'Released: ' + date;
  $('#detail-ver').textContent = id;
  $('#detail-type').textContent = type || '—';
  $('#detail-dir').textContent = state.settings?.gameDir || '—';
}

// ── Java ───────────────────────────────────────────────────────────
async function loadJava() {
  const container = $('#settings-java-list');
  if (!container) return;

  container.innerHTML = '<span class="muted">Scanning…</span>';
  try {
    const { installations } = await api('/api/java');
    if (!installations.length) {
      container.innerHTML = '<span class="muted">No Java executable found.</span>';
      return;
    }
    container.innerHTML = '';
    for (const java of installations) {
      const isOk = java.major >= 17;
      const item = document.createElement('div');
      item.className = 'java-item';
      item.innerHTML = `
        <span class="java-dot ${isOk ? 'ok' : 'warn'}"></span>
        <span class="java-path">${escHtml(java.path)}</span>
        <span class="java-meta">Java ${java.major || '?'} (${java.arch || '?'})</span>`;
      item.addEventListener('click', () => {
        $('#settings-java-path').value = java.path;
        log(`Selected Java override: ${java.path}`);
      });
      container.append(item);
    }
  } catch (error) {
    container.innerHTML = `<span class="muted">${error.message}</span>`;
  }
}

// ── News ───────────────────────────────────────────────────────────
async function loadNews() {
  const container = $('#news');
  if (!container) return;

  container.innerHTML = '<p class="muted">Loading news…</p>';
  try {
    const { entries } = await api('/api/news');
    container.innerHTML = '';
    for (const entry of entries) {
      const item = document.createElement('article');
      item.className = 'news-item';
      item.innerHTML = `
        <span class="news-meta">${[entry.category, entry.date].filter(Boolean).join(' · ')}</span>
        <h3>${escHtml(entry.title)}</h3>
        <p>${escHtml(entry.excerpt || '')}</p>
        <a href="${escHtml(entry.url)}" target="_blank" rel="noreferrer">Read more</a>`;
      container.append(item);
    }
  } catch (error) {
    container.innerHTML = `<p class="muted">${error.message}</p>`;
  }
}

// ── Status / App Info ─────────────────────────────────────────────
async function loadStatus() {
  try {
    const data = await api('/api/status');
    $('#app-version').textContent = data.version || '0.1.0';
    $('#about-version').textContent = data.version || '0.1.0';
    $('#topbar-path').textContent = '💾 ' + (data.dataRoot || '—');
    setOnline(true);
  } catch {
    setOnline(false);
  }
}

function setOnline(online) {
  const dots = $$('.status-dot');
  dots.forEach((d) => {
    d.className = 'status-dot ' + (online ? 'online' : 'offline');
  });
  $('#status-text').textContent = online ? 'Connected' : 'Disconnected';
  $('#about-backend-status').textContent = online ? 'Running (Node.js)' : 'Disconnected';
}

// ── Download Modal ─────────────────────────────────────────────────
function showModal(title, versionId) {
  const modal = $('#download-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  $('#modal-title').textContent = title;
  $('#modal-version').textContent = versionId || '—';
  $('#modal-status-icon').textContent = '⏳';
  $('#modal-status-text').textContent = 'Preparing...';
  $('#modal-percent').textContent = '0%';
  $('#modal-progress-bar').style.width = '0%';
  $('#modal-progress-wrap').style.display = 'block';
  $('#modal-percent').style.display = 'block';
  $('#modal-primary').textContent = 'Cancel';
  $('#modal-primary').disabled = false;
}

function hideModal() {
  $('#download-modal').style.display = 'none';
}

function updateModal(status, text, isComplete, isError) {
  $('#modal-status-icon').textContent = status;
  $('#modal-status-text').textContent = text;
  if (isComplete) {
    $('#modal-primary').textContent = '🎮 Play Now';
    $('#modal-primary').disabled = false;
    $('#modal-progress-wrap').style.display = 'none';
    $('#modal-percent').style.display = 'none';
  } else if (isError) {
    $('#modal-primary').textContent = 'Close';
    $('#modal-primary').disabled = false;
  }
}

// ── SSE Events ────────────────────────────────────────────────────
function connectEvents() {
  const source = new EventSource('/api/events');

  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    switch (event.type) {
      case 'hello':
        log(`${event.app} event stream connected.`);
        break;

      case 'task-start':
        setBusy(true, event.name);
        setProgress(0, event.name);
        log(`Started: ${event.name}`);
        showModal(event.name, event.versionId || '');
        break;

      case 'task-complete':
        setBusy(false, 'Idle');
        setProgress(100, `${event.name} complete.`);
        log(`Complete: ${event.name}`);
        updateModal('✅', 'Ready to play!', true);
        break;

      case 'task-error':
        setBusy(false, 'Error');
        log(`Error in ${event.name}: ${event.message}`, 'error');
        updateModal('❌', event.message, false, true);
        break;

      case 'download-start':
        log(`Downloading ${event.label}`);
        break;

      case 'download-progress':
        if (event.total) {
          setProgress(event.percent, `${event.label}: ${event.percent}%`);
          $('#modal-status-text').textContent = `${event.label}: ${event.percent}%`;
        }
        break;

      case 'download-complete':
        log(`Downloaded ${event.label}`);
        break;

      case 'download-skip':
        log(`Already current: ${event.label}`);
        break;

      case 'assets-progress':
        setProgress(event.percent, `Assets: ${event.completed}/${event.total}`);
        $('#modal-status-text').textContent = `Assets: ${event.completed}/${event.total}`;
        break;

      case 'status':
        log(event.message);
        $('#modal-status-text').textContent = event.message;
        break;

      case 'launch-start':
        log(`Launching ${event.versionId} with ${event.java}`);
        hideModal();
        break;

      case 'game-log':
        log(event.message.trim());
        break;

      case 'launch-exit':
        log(`Minecraft exited with code ${event.code ?? 'n/a'}${event.signal ? ` (${event.signal})` : ''}.`);
        break;

      default:
        break;
    }
  };

  source.onerror = () => log('Event stream disconnected; retrying…');
}

// ── Action helpers ────────────────────────────────────────────────
function selectedPayload() {
  const versionId = $('#ql-version')?.value || state.selectedVersionId || state.settings?.lastVersion || '';
  const accountId = state.settings?.lastAccountId || '';
  const memoryMb = Number($('#settings-memory')?.value || $('#ql-memory')?.value || state.settings?.memoryMb || 2048);
  const javaPath = $('#settings-java-path')?.value.trim() || '';
  return { versionId, accountId, memoryMb, javaPath };
}

async function doInstall(versionId) {
  const payload = selectedPayload();
  payload.versionId = versionId || payload.versionId;
  if (!payload.versionId) throw new Error('No version selected.');
  await saveSettings({ lastVersion: payload.versionId });
  await api('/api/install', { method: 'POST', body: payload });
}

async function doLaunch(versionId) {
  const payload = selectedPayload();
  payload.versionId = versionId || payload.versionId;
  if (!payload.versionId) throw new Error('No version selected.');
  const acc = state.accounts.find((a) => a.id === state.settings?.lastAccountId);
  if (!acc && state.accounts.length) {
    payload.accountId = state.accounts[0].id;
  } else if (!acc) {
    throw new Error('Create an offline account before launching.');
  }
  await saveSettings({ lastVersion: payload.versionId, lastAccountId: payload.accountId });
  await api('/api/launch', { method: 'POST', body: payload });
}

// ── Bind UI Events ────────────────────────────────────────────────
function bindUi() {
  // Navigation
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  // Home page buttons
  $('#home-browse')?.addEventListener('click', () => navigateTo('versions'));
  $('#home-accounts')?.addEventListener('click', () => navigateTo('accounts'));

  // Quick launch
  $('#ql-version')?.addEventListener('change', (e) => {
    $('#ql-launch').disabled = !e.target.value;
  });

  $('#ql-launch')?.addEventListener('click', async () => {
    try {
      await doLaunch();
    } catch (err) {
      setBusy(false, 'Error');
      log(err.message, 'error');
    }
  });

  $('#ql-memory')?.addEventListener('input', (e) => {
    updateMemoryLabels(e.target.value);
  });

  // Versions page
  $('#versions-refresh')?.addEventListener('click', () => loadVersions());

  $('#versions-search')?.addEventListener('input', (e) => {
    state.filterText = e.target.value;
    renderVersionList();
  });

  $$('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.filterType = tab.dataset.filter;
      renderVersionList();
    });
  });

  $('#detail-install')?.addEventListener('click', async () => {
    try {
      await saveSettings({ lastVersion: state.selectedVersionId });
      await doInstall(state.selectedVersionId);
    } catch (err) {
      setBusy(false, 'Error');
      log(err.message, 'error');
      updateModal('❌', err.message, false, true);
    }
  });

  $('#detail-memory')?.addEventListener('input', (e) => {
    updateMemoryLabels(e.target.value);
    // Sync other sliders
    $$('input[type="range"][id$="memory"]').forEach((s) => { s.value = e.target.value; });
  });

  // Accounts page
  $('#accounts-refresh')?.addEventListener('click', () => loadAccounts());

  $('#account-add')?.addEventListener('click', async () => {
    const username = $('#account-username').value.trim();
    if (!username) return;
    try {
      const { account } = await api('/api/accounts', { method: 'POST', body: { username } });
      $('#account-username').value = '';
      state.settings.lastAccountId = account.id;
      await saveSettings({ lastAccountId: account.id });
      await loadAccounts();
      log(`Saved offline account ${account.username}.`);
    } catch (err) {
      log(err.message, 'error');
    }
  });

  $('#account-username')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#account-add').click();
  });

  // Settings page
  $('#settings-save')?.addEventListener('click', async () => {
    try {
      await saveSettings();
      log('Settings saved.');
    } catch (err) {
      log(err.message, 'error');
    }
  });

  $('#settings-memory')?.addEventListener('input', (e) => {
    updateMemoryLabels(e.target.value);
    $$('input[type="range"][id$="memory"]').forEach((s) => { s.value = e.target.value; });
  });

  $('#settings-java-path')?.addEventListener('change', () => {
    // Will be saved on "Save" click
  });

  // News refresh
  $('#refresh-news')?.addEventListener('click', () => loadNews());

  // Modal
  $('#modal-primary')?.addEventListener('click', async () => {
    const btn = $('#modal-primary');
    if (btn.textContent === '🎮 Play Now') {
      try {
        await doLaunch(state.selectedVersionId || state.settings?.lastVersion);
      } catch (err) {
        log(err.message, 'error');
      }
    }
    hideModal();
  });

  $('#modal-close')?.addEventListener('click', hideModal);

  // Close modal on overlay click
  $('#download-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal();
  });

  // Responsive: close sidebar on nav click for mobile
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      // no-op for desktop, but future mobile toggle can hook here
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  bindUi();
  connectEvents();
  await loadStatus();
  await loadSettings();
  await Promise.all([
    loadAccounts(),
    loadVersions(),
    loadJava(),
    loadNews(),
  ]);
  updateSelectedAccount();

  // Set initial version detail if last version is set
  if (state.settings?.lastVersion) {
    const v = state.versions.find((x) => x.id === state.settings.lastVersion);
    if (v) selectVersion(v.id, v.type);
  }

  log('Amethyst launcher ready.');
}

boot().catch((err) => log(err.message, 'error'));
