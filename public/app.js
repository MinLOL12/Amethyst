/* ===== Amethyst Web UI — Application Logic ===== */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const state = {
  settings: null,
  accounts: [],
  versions: [],
  instances: [],
  recent: [],
  java: [],
  downloads: null,
  currentPage: 'home',
  currentPercent: 0,
  downloadActive: false,
  selectedVersionId: null,
  selectedVersionType: 'release',
  selectedInstanceId: null,
  filterType: 'all',
  filterText: '',
  msLoginId: null,
  editingInstanceId: null,
  logSearch: '',
  autoscroll: true
};

function log(message, level = 'info') {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  const el = $('#log-console');
  if (el) {
    el.textContent += `${line}\n`;
    if (state.autoscroll) el.scrollTop = el.scrollHeight;
  }
  if (level === 'error') console.error(message);
}

function appendConsoleLine(entry) {
  const el = $('#log-console');
  if (!el) return;
  if (state.logSearch && !String(entry.message || '').toLowerCase().includes(state.logSearch.toLowerCase())) {
    return;
  }
  const ts = entry.at ? new Date(entry.at).toLocaleTimeString() : new Date().toLocaleTimeString();
  el.textContent += `[${ts}] [${entry.stream || 'info'}] ${entry.message}\n`;
  if (state.autoscroll) el.scrollTop = el.scrollHeight;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps) {
  if (!bps || bps < 1) return '—';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds}s left`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

function setProgress(percent, text) {
  state.currentPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const bar = $('#progress-mini-fill');
  const wrap = $('#topbar-progress');
  const txt = $('#progress-mini-text');
  if (bar) bar.style.width = state.currentPercent + '%';
  if (text && txt) txt.textContent = text;
  if (wrap) wrap.classList.toggle('visible', state.downloadActive);

  const mbar = $('#modal-progress-bar');
  const mperc = $('#modal-percent');
  if (mbar) mbar.style.width = state.currentPercent + '%';
  if (mperc) mperc.textContent = state.currentPercent + '%';
}

function setBusy(isBusy, label = 'Idle') {
  state.downloadActive = isBusy;
  if (!isBusy) $('#topbar-progress')?.classList.remove('visible');
  if ($('#topbar-status')) $('#topbar-status').textContent = label;
}

function navigateTo(page) {
  state.currentPage = page;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  if (page === 'downloads') loadDownloads();
  if (page === 'java') loadJavaPage();
  if (page === 'logs') loadLogs();
  if (page === 'instances') loadInstances();
}

// ── Settings ───────────────────────────────────────────────────────
async function loadSettings() {
  const { settings } = await api('/api/settings');
  state.settings = settings;

  $$('#ql-memory, #settings-memory, #detail-memory').forEach((slider) => {
    if (slider) slider.value = settings.memoryMb;
  });
  updateMemoryLabels(settings.memoryMb);

  if ($('#settings-java-path')) $('#settings-java-path').value = settings.javaPath || '';
  if ($('#settings-jvm-args')) $('#settings-jvm-args').value = settings.jvmArgs || '';
  if ($('#settings-launch-args')) $('#settings-launch-args').value = settings.launchArgs || '';
  if ($('#settings-res-w')) $('#settings-res-w').value = settings.resolutionWidth || 854;
  if ($('#settings-res-h')) $('#settings-res-h').value = settings.resolutionHeight || 480;
  if ($('#settings-fullscreen')) $('#settings-fullscreen').checked = Boolean(settings.fullscreen);
  if ($('#settings-remember-ms')) $('#settings-remember-ms').checked = settings.rememberMicrosoftLogin !== false;
  if ($('#ms-remember')) $('#ms-remember').checked = settings.rememberMicrosoftLogin !== false;
  if ($('#settings-data-dir')) $('#settings-data-dir').textContent = settings.gameDir || '—';
  if ($('#modal-inst-memory')) $('#modal-inst-memory').value = settings.memoryMb || 2048;
}

function updateMemoryLabels(mb) {
  const val = Number(mb);
  if ($('#ql-memory-value')) $('#ql-memory-value').textContent = val;
  const gb = (val / 1024).toFixed(1).replace(/\.0$/, '');
  if ($('#settings-memory-display')) $('#settings-memory-display').textContent = `${gb} GB (${val} MB)`;
  if ($('#detail-ram-label')) $('#detail-ram-label').textContent = gb + ' GB';
}

async function saveSettings(extra = {}) {
  const body = {
    ...state.settings,
    memoryMb: Number($('#settings-memory')?.value || $('#ql-memory')?.value || state.settings?.memoryMb || 2048),
    javaPath: $('#settings-java-path')?.value.trim() || '',
    jvmArgs: $('#settings-jvm-args')?.value || '',
    launchArgs: $('#settings-launch-args')?.value || '',
    resolutionWidth: Number($('#settings-res-w')?.value) || 854,
    resolutionHeight: Number($('#settings-res-h')?.value) || 480,
    fullscreen: Boolean($('#settings-fullscreen')?.checked),
    rememberMicrosoftLogin: Boolean($('#settings-remember-ms')?.checked ?? true),
    lastAccountId: state.settings?.lastAccountId || '',
    lastInstanceId: state.settings?.lastInstanceId || '',
    lastVersion: state.settings?.lastVersion || '',
    ...extra
  };
  const { settings } = await api('/api/settings', { method: 'POST', body });
  state.settings = settings;
  log('Settings saved.');
  return settings;
}

// ── Accounts ───────────────────────────────────────────────────────
async function loadAccounts() {
  const { accounts } = await api('/api/accounts');
  state.accounts = accounts;
  renderAccounts();
  updateSelectedAccount();
  updateTopbarAccount();
}

function accountTypeLabel(acc) {
  if (acc.type === 'microsoft') return acc.tokenExpired ? 'Microsoft (expired)' : 'Microsoft';
  return 'Offline';
}

function renderAccounts() {
  const container = $('#account-list');
  if (!container) return;

  if (!state.accounts.length) {
    container.innerHTML = `<div class="account-empty"><span class="detail-empty-icon">👻</span><p>No accounts yet</p></div>`;
    return;
  }

  container.innerHTML = '';
  for (const acc of state.accounts) {
    const isSelected = acc.id === state.settings?.lastAccountId;
    const firstLetter = (acc.username || '?').charAt(0).toUpperCase();
    const shortUuid = acc.uuid ? acc.uuid.substring(0, 8) + '…' : 'No UUID';
    const typeLabel = accountTypeLabel(acc);
    const dotClass = acc.type === 'microsoft' ? (acc.tokenExpired ? 'warn' : 'ok') : 'offline-dot';

    const item = document.createElement('div');
    item.className = 'account-item' + (isSelected ? ' selected' : '');
    item.innerHTML = `
      <div class="account-avatar ${acc.type === 'microsoft' ? 'ms' : ''}">${firstLetter}</div>
      <div class="account-info">
        <span class="account-name">${escHtml(acc.username)}</span>
        <span class="account-uuid">${escHtml(shortUuid)}</span>
        <div class="account-status">
          <span class="account-status-dot ${dotClass}"></span>
          <span class="account-status-label">${escHtml(typeLabel)}</span>
        </div>
      </div>
      <div class="account-actions">
        <button class="select-btn ${isSelected ? 'primary' : 'ghost'}">${isSelected ? '✓ Active' : 'Switch'}</button>
        ${acc.type === 'microsoft' ? '<button class="refresh-btn ghost" title="Refresh token">↻</button>' : ''}
        <button class="delete-btn ghost" title="Remove">🗑️</button>
      </div>`;

    item.querySelector('.select-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api(`/api/accounts/${encodeURIComponent(acc.id)}/switch`, { method: 'POST', body: {} });
        state.settings.lastAccountId = acc.id;
        await loadAccounts();
        log(`Switched to ${acc.username} (no re-authentication needed).`);
      } catch (err) {
        log(err.message, 'error');
      }
    });

    const refreshBtn = item.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api(`/api/accounts/${encodeURIComponent(acc.id)}/refresh`, { method: 'POST', body: {} });
          await loadAccounts();
          log(`Refreshed Microsoft session for ${acc.username}.`);
        } catch (err) {
          log(err.message, 'error');
        }
      });
    }

    item.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api(`/api/accounts/${encodeURIComponent(acc.id)}`, { method: 'DELETE' });
        await loadAccounts();
        log(`Removed account ${acc.username}.`);
      } catch (err) {
        log(err.message, 'error');
      }
    });

    container.append(item);
  }
}

function updateSelectedAccount() {
  const sel = $('#selected-account');
  const name = $('#selected-name');
  if (!sel || !name) return;
  const acc = state.accounts.find((a) => a.id === state.settings?.lastAccountId);
  if (acc) {
    sel.style.display = 'flex';
    name.textContent = `${acc.username} (${acc.type})`;
  } else {
    sel.style.display = 'none';
  }
}

function updateTopbarAccount() {
  const el = $('#topbar-account');
  if (!el) return;
  const acc = state.accounts.find((a) => a.id === state.settings?.lastAccountId);
  el.textContent = acc ? `👤 ${acc.username}` : '👤 No account';
}

// Microsoft device login
async function startMicrosoftLogin() {
  try {
    const remember = $('#ms-remember')?.checked !== false;
    const data = await api('/api/accounts/microsoft/start', {
      method: 'POST',
      body: { remember }
    });
    state.msLoginId = data.loginId;
    $('#ms-login-panel').style.display = 'flex';
    $('#ms-message').textContent = data.message || 'Use the code below to sign in.';
    $('#ms-code').textContent = data.userCode;
    $('#ms-link').href = data.verificationUri;
    $('#ms-link').textContent = data.verificationUri;
    $('#ms-status').textContent = 'Waiting for authorization…';
    log(`Microsoft login started. Code: ${data.userCode}`);
    pollMicrosoftLogin();
  } catch (err) {
    log(err.message, 'error');
  }
}

async function pollMicrosoftLogin() {
  if (!state.msLoginId) return;
  try {
    const status = await api(`/api/accounts/microsoft/status/${encodeURIComponent(state.msLoginId)}`);
    if (status.status === 'complete') {
      $('#ms-status').textContent = `Signed in as ${status.account?.username || 'player'}`;
      state.msLoginId = null;
      await loadAccounts();
      setTimeout(() => {
        if ($('#ms-login-panel')) $('#ms-login-panel').style.display = 'none';
      }, 1500);
      log(`Microsoft account ${status.account?.username} saved.`);
      return;
    }
    if (status.status === 'error' || status.status === 'expired' || status.status === 'cancelled') {
      $('#ms-status').textContent = status.error || status.status;
      state.msLoginId = null;
      return;
    }
    if (status.status === 'authenticating') {
      $('#ms-status').textContent = 'Finishing Xbox / Minecraft authentication…';
    }
    setTimeout(pollMicrosoftLogin, 2500);
  } catch (err) {
    $('#ms-status').textContent = err.message;
    setTimeout(pollMicrosoftLogin, 4000);
  }
}

async function cancelMicrosoftLogin() {
  if (state.msLoginId) {
    try {
      await api(`/api/accounts/microsoft/cancel/${encodeURIComponent(state.msLoginId)}`, { method: 'POST', body: {} });
    } catch (_) { /* ignore */ }
  }
  state.msLoginId = null;
  if ($('#ms-login-panel')) $('#ms-login-panel').style.display = 'none';
}

// ── Versions ───────────────────────────────────────────────────────
async function loadVersions() {
  const data = await api('/api/versions');
  state.versions = data.versions;
  renderVersionList();
  fillVersionSelects();
  log(`Loaded ${data.versions.length} official versions from Mojang.`);
}

function fillVersionSelects() {
  const selects = [$('#modal-inst-version')].filter(Boolean);
  for (const select of selects) {
    const current = select.value;
    select.innerHTML = '';
    for (const v of state.versions) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.id} · ${v.type}`;
      select.append(opt);
    }
    if (current) select.value = current;
    else if (state.settings?.lastVersion) select.value = state.settings.lastVersion;
  }
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
  $$('.version-item').forEach((item) => {
    const name = item.querySelector('.version-name');
    item.classList.toggle('selected', name && name.textContent === id);
  });

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
  if ($('#detail-instance-name')) $('#detail-instance-name').value = `Minecraft ${id}`;
  loadLoaderVersionsFor($('#detail-loader')?.value || 'vanilla', id, $('#detail-loader-version'), $('#detail-loader-version-wrap'));
}

async function loadLoaderVersionsFor(loader, gameVersion, selectEl, wrapEl) {
  if (!selectEl) return;
  if (!loader || loader === 'vanilla') {
    if (wrapEl) wrapEl.style.display = 'none';
    selectEl.innerHTML = '';
    return;
  }
  if (wrapEl) wrapEl.style.display = 'flex';
  selectEl.innerHTML = '<option>Loading…</option>';
  try {
    const data = await api(`/api/loaders/versions?loader=${encodeURIComponent(loader)}&gameVersion=${encodeURIComponent(gameVersion)}`);
    selectEl.innerHTML = '';
    if (!data.versions?.length) {
      selectEl.innerHTML = `<option value="">${data.error || 'No loader versions found'}</option>`;
      return;
    }
    for (const v of data.versions.slice(0, 40)) {
      const opt = document.createElement('option');
      opt.value = v.version;
      opt.textContent = v.stable ? `${v.version} (stable)` : v.version;
      selectEl.append(opt);
    }
  } catch (err) {
    selectEl.innerHTML = `<option value="">${err.message}</option>`;
  }
}

// ── Instances ──────────────────────────────────────────────────────
async function loadInstances() {
  const { instances } = await api('/api/instances');
  state.instances = instances;
  renderInstances();
  renderQuickLaunch();
  renderRecent();
}

async function loadRecent() {
  try {
    const { instances } = await api('/api/instances/recent?limit=6');
    state.recent = instances;
    renderRecent();
  } catch (_) {
    state.recent = state.instances.filter((i) => i.lastPlayed).slice(0, 6);
    renderRecent();
  }
}

function renderQuickLaunch() {
  const select = $('#ql-instance');
  if (!select) return;
  const current = select.value || state.settings?.lastInstanceId || '';
  select.innerHTML = '<option value="">Select instance…</option>';
  for (const inst of state.instances) {
    const opt = document.createElement('option');
    opt.value = inst.id;
    opt.textContent = `${inst.name} · ${inst.versionId}${inst.loader && inst.loader !== 'vanilla' ? ' · ' + inst.loader : ''}`;
    select.append(opt);
  }
  if (current) select.value = current;
  $('#ql-launch').disabled = !select.value;
}

function renderRecent() {
  const container = $('#recent-instances');
  if (!container) return;
  const list = state.recent?.length ? state.recent : state.instances.filter((i) => i.lastPlayed).slice(0, 6);
  if (!list.length) {
    container.innerHTML = '<p class="muted">No recently played instances. Create one from Versions.</p>';
    return;
  }
  container.innerHTML = '';
  for (const inst of list) {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `
      <div class="recent-info">
        <strong>${escHtml(inst.name)}</strong>
        <span class="muted">${escHtml(inst.versionId)} · ${escHtml(inst.loader || 'vanilla')}</span>
      </div>
      <button class="primary recent-play">Play</button>`;
    item.querySelector('.recent-play').addEventListener('click', () => doLaunch({ instanceId: inst.id }));
    item.addEventListener('dblclick', () => {
      state.selectedInstanceId = inst.id;
      navigateTo('instances');
      selectInstance(inst.id);
    });
    container.append(item);
  }
}

function renderInstances() {
  const container = $('#instance-list');
  if (!container) return;

  if (!state.instances.length) {
    container.innerHTML = `<div class="account-empty"><span class="detail-empty-icon">📦</span><p>No instances yet</p></div>`;
    return;
  }

  container.innerHTML = '';
  for (const inst of state.instances) {
    const isSelected = inst.id === state.selectedInstanceId;
    const item = document.createElement('div');
    item.className = 'instance-item' + (isSelected ? ' selected' : '');
    item.innerHTML = `
      <div class="instance-icon">${loaderIcon(inst.loader)}</div>
      <div class="instance-info">
        <div class="instance-name">${escHtml(inst.name)}</div>
        <div class="instance-meta">${escHtml(inst.versionId)} · ${escHtml(inst.loader || 'vanilla')}${inst.loaderVersion ? ' ' + escHtml(inst.loaderVersion) : ''}</div>
      </div>
      <button class="ghost play-mini" title="Play">▶</button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.play-mini')) return;
      selectInstance(inst.id);
    });
    item.querySelector('.play-mini').addEventListener('click', (e) => {
      e.stopPropagation();
      doLaunch({ instanceId: inst.id });
    });
    container.append(item);
  }
}

function loaderIcon(loader) {
  switch (loader) {
    case 'fabric': return '🧵';
    case 'forge': return '🔨';
    case 'neoforge': return '⚒️';
    case 'quilt': return '🧿';
    default: return '🧊';
  }
}

function selectInstance(id) {
  state.selectedInstanceId = id;
  const inst = state.instances.find((i) => i.id === id);
  renderInstances();

  const empty = $('#instance-detail-empty');
  const content = $('#instance-detail-content');
  if (!inst) {
    if (empty) empty.style.display = 'flex';
    if (content) content.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'flex';

  $('#inst-name').textContent = inst.name;
  $('#inst-loader').textContent = inst.loader || 'vanilla';
  $('#inst-loader').className = 'detail-badge ' + (inst.loader || 'vanilla');
  $('#inst-meta').textContent = inst.lastPlayed
    ? `Last played ${new Date(inst.lastPlayed).toLocaleString()}`
    : `Created ${inst.createdAt ? new Date(inst.createdAt).toLocaleDateString() : '—'}`;
  $('#inst-version').textContent = inst.versionId;
  $('#inst-loader-info').textContent = `${inst.loader || 'vanilla'}${inst.loaderVersion ? ' ' + inst.loaderVersion : ''}`;
  $('#inst-java').textContent = inst.javaPath || 'Auto-detect';
  $('#inst-dir').textContent = inst.gameDir;
  $('#inst-ram').textContent = `${inst.memoryMb || 2048} MB`;

  renderInstanceFolders(inst.id);
}

async function renderInstanceFolders(instanceId) {
  const container = $('#inst-folders');
  if (!container) return;
  try {
    const { folders } = await api(`/api/folders?instanceId=${encodeURIComponent(instanceId)}`);
    container.innerHTML = '';
    for (const f of folders.filter((x) => !['instances'].includes(x.id))) {
      const btn = document.createElement('button');
      btn.className = 'folder-btn';
      btn.innerHTML = `<span>${f.icon || '📁'}</span><span>${escHtml(f.label)}</span>`;
      btn.title = f.path || '';
      btn.addEventListener('click', () => openFolder(f.id, instanceId));
      container.append(btn);
    }
  } catch (err) {
    container.innerHTML = `<span class="muted">${err.message}</span>`;
  }
}

async function openFolder(kind, instanceId) {
  try {
    const result = await api('/api/folders/open', {
      method: 'POST',
      body: { kind, instanceId }
    });
    log(`Opened ${result.path}`);
  } catch (err) {
    log(err.message, 'error');
  }
}

async function renderHomeFolders() {
  const container = $('#home-folders');
  const settingsContainer = $('#settings-folders');
  try {
    const { folders } = await api('/api/folders');
    for (const target of [container, settingsContainer]) {
      if (!target) continue;
      target.innerHTML = '';
      for (const f of folders) {
        const btn = document.createElement('button');
        btn.className = 'folder-btn';
        btn.innerHTML = `<span>${f.icon || '📁'}</span><span>${escHtml(f.label)}</span>`;
        btn.title = f.path || '';
        btn.addEventListener('click', () => openFolder(f.id));
        target.append(btn);
      }
    }
  } catch (err) {
    if (container) container.innerHTML = `<span class="muted">${err.message}</span>`;
  }
}

function showInstanceModal(editId = null) {
  state.editingInstanceId = editId;
  fillVersionSelects();
  const modal = $('#instance-modal');
  modal.style.display = 'flex';
  if (editId) {
    const inst = state.instances.find((i) => i.id === editId);
    $('#instance-modal-title').textContent = 'Edit instance';
    $('#instance-modal-save').textContent = 'Save';
    $('#modal-inst-name').value = inst?.name || '';
    $('#modal-inst-version').value = inst?.versionId || '';
    $('#modal-inst-loader').value = inst?.loader || 'vanilla';
    $('#modal-inst-memory').value = inst?.memoryMb || 2048;
    $('#modal-inst-java').value = inst?.javaPath || '';
    $('#modal-inst-jvm').value = inst?.jvmArgs || '';
    $('#modal-inst-gamedir').value = inst?.gameDir || '';
    $('#modal-inst-gamedir').disabled = true;
    loadLoaderVersionsFor(
      $('#modal-inst-loader').value,
      $('#modal-inst-version').value,
      $('#modal-inst-loader-version')
    ).then(() => {
      if (inst?.loaderVersion) $('#modal-inst-loader-version').value = inst.loaderVersion;
    });
  } else {
    $('#instance-modal-title').textContent = 'Create instance';
    $('#instance-modal-save').textContent = 'Create';
    $('#modal-inst-name').value = '';
    $('#modal-inst-loader').value = 'vanilla';
    $('#modal-inst-memory').value = state.settings?.memoryMb || 2048;
    $('#modal-inst-java').value = '';
    $('#modal-inst-jvm').value = '';
    $('#modal-inst-gamedir').value = '';
    $('#modal-inst-gamedir').disabled = false;
    loadLoaderVersionsFor('vanilla', $('#modal-inst-version').value, $('#modal-inst-loader-version'));
  }
}

function hideInstanceModal() {
  $('#instance-modal').style.display = 'none';
  state.editingInstanceId = null;
}

async function saveInstanceModal() {
  const payload = {
    name: $('#modal-inst-name').value.trim() || 'New Instance',
    versionId: $('#modal-inst-version').value,
    loader: $('#modal-inst-loader').value || 'vanilla',
    loaderVersion: $('#modal-inst-loader-version').value || '',
    memoryMb: Number($('#modal-inst-memory').value) || 2048,
    javaPath: $('#modal-inst-java').value.trim(),
    jvmArgs: $('#modal-inst-jvm').value,
    gameDir: $('#modal-inst-gamedir').value.trim() || undefined
  };
  if (!payload.versionId) throw new Error('Pick a Minecraft version');

  if (state.editingInstanceId) {
    await api(`/api/instances/${encodeURIComponent(state.editingInstanceId)}`, {
      method: 'PATCH',
      body: payload
    });
    log(`Updated instance ${payload.name}`);
  } else {
    const { instance } = await api('/api/instances', { method: 'POST', body: payload });
    log(`Created instance ${instance.name}`);
    state.selectedInstanceId = instance.id;
    // Queue install
    await api('/api/install', {
      method: 'POST',
      body: { instanceId: instance.id, versionId: instance.versionId }
    });
    showModal('Installing', instance.name);
  }
  hideInstanceModal();
  await loadInstances();
  if (state.selectedInstanceId) selectInstance(state.selectedInstanceId);
}

// ── Java ───────────────────────────────────────────────────────────
async function loadJavaPage() {
  const list = $('#java-list');
  const dl = $('#java-downloadable');
  if (list) list.innerHTML = '<span class="muted">Scanning…</span>';
  try {
    const { installations } = await api('/api/java');
    state.java = installations;
    if (!installations.length) {
      list.innerHTML = '<span class="muted">No Java found. Download one below.</span>';
    } else {
      list.innerHTML = '';
      for (const java of installations) {
        const isOk = (java.major || 0) >= 17;
        const item = document.createElement('div');
        item.className = 'java-item';
        item.innerHTML = `
          <span class="java-dot ${isOk ? 'ok' : 'warn'}"></span>
          <div class="java-info">
            <span class="java-path">${escHtml(java.path)}</span>
            <span class="java-meta">Java ${java.major || '?'} · ${escHtml(java.version || '')} · ${escHtml(java.source || 'system')}${java.vendor ? ' · ' + escHtml(java.vendor) : ''}</span>
          </div>
          <button class="ghost use-java">Use</button>`;
        item.querySelector('.use-java').addEventListener('click', async () => {
          if ($('#settings-java-path')) $('#settings-java-path').value = java.path;
          await saveSettings({ javaPath: java.path });
          log(`Default Java set to ${java.path}`);
        });
        list.append(item);
      }
    }
  } catch (err) {
    if (list) list.innerHTML = `<span class="muted">${err.message}</span>`;
  }

  if (dl) {
    dl.innerHTML = '<span class="muted">Loading catalog…</span>';
    try {
      const { versions } = await api('/api/java/downloadable');
      dl.innerHTML = '';
      for (const v of versions) {
        const row = document.createElement('div');
        row.className = 'java-dl-row';
        if (v.error) {
          row.innerHTML = `<span>Java ${v.major}</span><span class="muted">${escHtml(v.error)}</span>`;
        } else {
          row.innerHTML = `
            <div>
              <strong>Java ${v.major}</strong>
              <div class="muted">${escHtml(v.version)} · ${formatBytes(v.size)}</div>
            </div>
            <button class="primary">Download</button>`;
          row.querySelector('button').addEventListener('click', async () => {
            try {
              await api('/api/java/download', { method: 'POST', body: { major: v.major } });
              showModal('Downloading Java', `Java ${v.major}`);
              log(`Queued Java ${v.major} download`);
              loadDownloads();
            } catch (err) {
              log(err.message, 'error');
            }
          });
        }
        dl.append(row);
      }
    } catch (err) {
      dl.innerHTML = `<span class="muted">${err.message}</span>`;
    }
  }
}

async function loadJavaSettingsList() {
  // Kept for settings page compatibility — full list lives on Java page.
  try {
    const { installations } = await api('/api/java');
    state.java = installations;
  } catch (_) { /* ignore */ }
}

// ── News ───────────────────────────────────────────────────────────
async function loadNews() {
  const container = $('#news');
  if (!container) return;
  container.innerHTML = '<p class="muted">Loading news…</p>';
  try {
    const { entries } = await api('/api/news');
    container.innerHTML = '';
    // Launcher updates pseudo-entry
    const update = document.createElement('article');
    update.className = 'news-item launcher-update';
    update.innerHTML = `
      <span class="news-meta">Launcher · Amethyst</span>
      <h3>Amethyst ${state.settings ? '' : ''}features</h3>
      <p>Microsoft multi-account login, instances, Fabric/Forge/NeoForge/Quilt, Java manager, download queue, live logs, and folder shortcuts.</p>`;
    container.append(update);

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

// ── Downloads ──────────────────────────────────────────────────────
async function loadDownloads() {
  try {
    const data = await api('/api/downloads');
    state.downloads = data;
    renderDownloads();
  } catch (err) {
    if ($('#download-list')) $('#download-list').innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

function renderDownloads() {
  const data = state.downloads;
  const list = $('#download-list');
  const summary = $('#download-summary');
  if (!list || !data) return;

  const active = data.active || [];
  const pending = data.pending || [];
  const history = data.history || [];
  const all = [...active, ...pending, ...history].slice(0, 40);

  if (summary) {
    if (active.length) {
      const job = active[0];
      summary.innerHTML = `
        <strong>${escHtml(job.name)}</strong>
        <span>${job.progress?.percent || 0}%</span>
        <span>${formatSpeed(job.progress?.speedBps)}</span>
        <span>${formatEta(job.progress?.etaSeconds)}</span>`;
    } else {
      summary.innerHTML = `<span class="muted">${data.paused ? 'Queue paused' : 'No active downloads'} · ${pending.length} queued</span>`;
    }
  }

  if (!all.length) {
    list.innerHTML = '<p class="muted">Queue is empty.</p>';
    return;
  }

  list.innerHTML = '';
  for (const job of all) {
    const row = document.createElement('div');
    row.className = 'download-row status-' + job.status;
    const pct = job.progress?.percent || 0;
    row.innerHTML = `
      <div class="download-row-head">
        <strong>${escHtml(job.name)}</strong>
        <span class="download-status">${escHtml(job.status)}</span>
      </div>
      <div class="download-bar"><div class="download-bar-fill" style="width:${pct}%"></div></div>
      <div class="download-row-meta">
        <span>${pct}%</span>
        <span>${formatBytes(job.progress?.received)} / ${formatBytes(job.progress?.total)}</span>
        <span>${formatSpeed(job.progress?.speedBps)}</span>
        <span>${formatEta(job.progress?.etaSeconds)}</span>
        ${job.error ? `<span class="danger-text">${escHtml(job.error)}</span>` : ''}
        ${job.status === 'queued' || job.status === 'running' ? `<button class="ghost cancel-job" data-id="${escHtml(job.id)}">Cancel</button>` : ''}
      </div>`;
    const cancel = row.querySelector('.cancel-job');
    if (cancel) {
      cancel.addEventListener('click', async () => {
        await api(`/api/downloads/${encodeURIComponent(job.id)}/cancel`, { method: 'POST', body: {} });
        loadDownloads();
      });
    }
    list.append(row);
  }
}

// ── Logs ───────────────────────────────────────────────────────────
async function loadLogs() {
  try {
    const { lines } = await api(`/api/logs?limit=500&search=${encodeURIComponent(state.logSearch || '')}`);
    const el = $('#log-console');
    if (!el) return;
    el.textContent = lines.map((l) => `[${new Date(l.at).toLocaleTimeString()}] [${l.stream}] ${l.message}`).join('\n') + (lines.length ? '\n' : '');
    if (state.autoscroll) el.scrollTop = el.scrollHeight;
  } catch (err) {
    log(err.message, 'error');
  }
}

async function copyLogs() {
  try {
    const text = await fetch('/api/logs/text').then((r) => r.text());
    await navigator.clipboard.writeText(text);
    log('Logs copied to clipboard.');
  } catch (err) {
    // Fallback
    const el = $('#log-console');
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      log('Logs copied.');
    } else {
      log(err.message, 'error');
    }
  }
}

async function loadCrashReports() {
  const panel = $('#crash-panel');
  const list = $('#crash-list');
  panel.style.display = 'block';
  list.innerHTML = '<span class="muted">Loading…</span>';
  try {
    const q = state.selectedInstanceId ? `?instanceId=${encodeURIComponent(state.selectedInstanceId)}` : '';
    const { reports } = await api('/api/crash-reports' + q);
    if (!reports.length) {
      list.innerHTML = '<p class="muted">No crash reports found.</p>';
      return;
    }
    list.innerHTML = '';
    for (const report of reports) {
      const row = document.createElement('div');
      row.className = 'crash-row';
      row.innerHTML = `
        <div>
          <strong>${escHtml(report.name)}</strong>
          <div class="muted">${escHtml(report.mtime)} · ${formatBytes(report.size)}</div>
        </div>
        <div class="row-actions">
          <button class="ghost view-crash">View</button>
          <button class="ghost save-crash">Save copy</button>
        </div>`;
      row.querySelector('.view-crash').addEventListener('click', async () => {
        const data = await api(`/api/crash-reports/read?path=${encodeURIComponent(report.path)}`);
        const pre = $('#crash-content');
        pre.style.display = 'block';
        pre.textContent = data.content;
      });
      row.querySelector('.save-crash').addEventListener('click', async () => {
        const result = await api('/api/crash-reports/save', { method: 'POST', body: { path: report.path } });
        log(`Saved crash report copy to ${result.destination}`);
      });
      list.append(row);
    }
  } catch (err) {
    list.innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

// ── Status ─────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const data = await api('/api/status');
    if ($('#app-version')) $('#app-version').textContent = data.version || '0.2.0';
    if ($('#about-version')) $('#about-version').textContent = data.version || '0.2.0';
    if ($('#topbar-path')) $('#topbar-path').textContent = '💾 ' + (data.dataRoot || '—');
    if ($('#settings-data-dir')) $('#settings-data-dir').textContent = data.dataRoot || '—';
    setOnline(true);
  } catch {
    setOnline(false);
  }
}

function setOnline(online) {
  $$('.status-dot').forEach((d) => {
    d.className = 'status-dot ' + (online ? 'online' : 'offline');
  });
  if ($('#status-text')) $('#status-text').textContent = online ? 'Connected' : 'Disconnected';
  if ($('#about-backend-status')) $('#about-backend-status').textContent = online ? 'Running (Node.js)' : 'Disconnected';
}

// ── Modals ─────────────────────────────────────────────────────────
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
  if ($('#modal-speed')) $('#modal-speed').textContent = '—';
  if ($('#modal-eta')) $('#modal-eta').textContent = '—';
}

function hideModal() {
  if ($('#download-modal')) $('#download-modal').style.display = 'none';
}

function updateModal(status, text, isComplete, isError) {
  if ($('#modal-status-icon')) $('#modal-status-icon').textContent = status;
  if ($('#modal-status-text')) $('#modal-status-text').textContent = text;
  if (isComplete) {
    $('#modal-progress-wrap').style.display = 'none';
    $('#modal-percent').style.display = 'none';
  }
}

function showPrompt({ title, subtitle, placeholder, value = '' }) {
  return new Promise((resolve) => {
    const modal = $('#prompt-modal');
    $('#prompt-title').textContent = title || 'Input';
    $('#prompt-subtitle').textContent = subtitle || '';
    $('#prompt-input').placeholder = placeholder || '';
    $('#prompt-input').value = value;
    modal.style.display = 'flex';
    const ok = () => {
      const v = $('#prompt-input').value;
      cleanup();
      resolve(v);
    };
    const cancel = () => {
      cleanup();
      resolve(null);
    };
    function cleanup() {
      modal.style.display = 'none';
      $('#prompt-ok').removeEventListener('click', ok);
      $('#prompt-cancel').removeEventListener('click', cancel);
    }
    $('#prompt-ok').addEventListener('click', ok);
    $('#prompt-cancel').addEventListener('click', cancel);
    $('#prompt-input').focus();
  });
}

// ── Launch / install ───────────────────────────────────────────────
async function doLaunch(opts = {}) {
  try {
    const instanceId = opts.instanceId || $('#ql-instance')?.value || state.selectedInstanceId || state.settings?.lastInstanceId;
    const accountId = state.settings?.lastAccountId || state.accounts[0]?.id;
    if (!accountId) throw new Error('Sign in or create an account first.');

    const body = {
      accountId,
      memoryMb: Number($('#ql-memory')?.value || state.settings?.memoryMb || 2048),
      javaPath: state.settings?.javaPath || '',
      ...opts
    };

    if (instanceId) body.instanceId = instanceId;
    else if (opts.versionId || state.selectedVersionId) body.versionId = opts.versionId || state.selectedVersionId;
    else throw new Error('Select an instance or version to launch.');

    setBusy(true, 'Launching…');
    showModal('Launching', body.instanceId || body.versionId);
    await api('/api/launch', { method: 'POST', body });
    navigateTo('logs');
  } catch (err) {
    setBusy(false, 'Error');
    updateModal('❌', err.message, false, true);
    log(err.message, 'error');
  }
}

async function createFromVersionDetail() {
  const versionId = state.selectedVersionId;
  if (!versionId) throw new Error('No version selected');
  const name = $('#detail-instance-name')?.value.trim() || `Minecraft ${versionId}`;
  const loader = $('#detail-loader')?.value || 'vanilla';
  const loaderVersion = $('#detail-loader-version')?.value || '';
  const { instance } = await api('/api/instances', {
    method: 'POST',
    body: { name, versionId, loader, loaderVersion, memoryMb: state.settings?.memoryMb }
  });
  await api('/api/install', {
    method: 'POST',
    body: { instanceId: instance.id, versionId }
  });
  showModal('Installing', instance.name);
  await loadInstances();
  state.selectedInstanceId = instance.id;
  navigateTo('instances');
  selectInstance(instance.id);
  log(`Created and installing ${instance.name}`);
}

// ── SSE ────────────────────────────────────────────────────────────
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
        showModal(event.name, event.versionId || '');
        log(`Started: ${event.name}`);
        break;
      case 'task-complete':
        setBusy(false, 'Idle');
        setProgress(100, `${event.name} complete.`);
        updateModal('✅', 'Ready to play!', true);
        log(`Complete: ${event.name}`);
        loadInstances();
        loadDownloads();
        break;
      case 'task-error':
        setBusy(false, 'Error');
        updateModal('❌', event.message, false, true);
        log(`Error in ${event.name}: ${event.message}`, 'error');
        break;
      case 'download-progress':
        if (event.total) {
          setProgress(event.percent, `${event.label}: ${event.percent}%`);
          if ($('#modal-status-text')) $('#modal-status-text').textContent = `${event.label}: ${event.percent}%`;
        }
        break;
      case 'assets-progress':
        setProgress(event.percent, `Assets: ${event.completed}/${event.total}`);
        if ($('#modal-status-text')) $('#modal-status-text').textContent = `Assets: ${event.completed}/${event.total}`;
        break;
      case 'status':
        log(event.message);
        if ($('#modal-status-text')) $('#modal-status-text').textContent = event.message;
        break;
      case 'queue-update':
        state.downloads = event;
        if (state.currentPage === 'downloads') renderDownloads();
        if (event.active?.length) {
          setBusy(true, event.active[0].name);
          const p = event.active[0].progress || {};
          setProgress(p.percent || 0, event.active[0].name);
        } else if (!event.pending?.length) {
          setBusy(false, 'Idle');
        }
        break;
      case 'queue-progress':
        setProgress(event.percent, event.label || event.name);
        if ($('#modal-speed')) $('#modal-speed').textContent = event.speedText || formatSpeed(event.speedBps);
        if ($('#modal-eta')) $('#modal-eta').textContent = event.etaText || formatEta(event.etaSeconds);
        if ($('#modal-status-text') && event.label) $('#modal-status-text').textContent = event.label;
        if (state.currentPage === 'downloads') loadDownloads();
        break;
      case 'queue-start':
        setBusy(true, event.name);
        showModal(event.name, event.type || '');
        loadDownloads();
        break;
      case 'queue-complete':
        setBusy(false, 'Idle');
        updateModal('✅', `${event.name} complete`, true);
        loadDownloads();
        loadInstances();
        loadJavaPage();
        break;
      case 'queue-error':
        setBusy(false, 'Error');
        updateModal('❌', event.message, false, true);
        log(event.message, 'error');
        loadDownloads();
        break;
      case 'console-log':
      case 'game-log':
        appendConsoleLine({
          at: event.at,
          stream: event.stream || 'stdout',
          message: event.message
        });
        break;
      case 'launch-start':
        log(`Launching ${event.versionId} with ${event.java}`);
        navigateTo('logs');
        break;
      case 'launch-exit':
        log(`Minecraft exited with code ${event.code ?? 'n/a'}${event.signal ? ` (${event.signal})` : ''}.`);
        setBusy(false, 'Idle');
        break;
      case 'ms-login-complete':
        loadAccounts();
        log(`Microsoft login complete: ${event.account?.username}`);
        break;
      case 'ms-login-error':
        if ($('#ms-status')) $('#ms-status').textContent = event.message;
        log(event.message, 'error');
        break;
      case 'java-downloaded':
        log(`Java downloaded: ${event.path}`);
        loadJavaPage();
        break;
      case 'instance-created':
      case 'instance-deleted':
      case 'instance-duplicated':
      case 'instance-imported':
      case 'instance-exported':
        loadInstances();
        break;
      default:
        break;
    }
  };

  source.onerror = () => log('Event stream disconnected; retrying…');
}

// ── Bind UI ────────────────────────────────────────────────────────
function bindUi() {
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  $('#home-browse')?.addEventListener('click', () => navigateTo('versions'));
  $('#home-new-instance')?.addEventListener('click', () => {
    navigateTo('instances');
    showInstanceModal();
  });
  $('#home-ms-login')?.addEventListener('click', () => {
    navigateTo('accounts');
    startMicrosoftLogin();
  });
  $('#refresh-recent')?.addEventListener('click', () => loadRecent());
  $('#refresh-news')?.addEventListener('click', () => loadNews());

  $('#ql-instance')?.addEventListener('change', (e) => {
    $('#ql-launch').disabled = !e.target.value;
  });
  $('#ql-launch')?.addEventListener('click', () => doLaunch());
  $('#ql-memory')?.addEventListener('input', (e) => updateMemoryLabels(e.target.value));

  // Versions
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
  $('#detail-loader')?.addEventListener('change', (e) => {
    loadLoaderVersionsFor(e.target.value, state.selectedVersionId, $('#detail-loader-version'), $('#detail-loader-version-wrap'));
  });
  $('#detail-create')?.addEventListener('click', async () => {
    try {
      await createFromVersionDetail();
    } catch (err) {
      log(err.message, 'error');
      updateModal('❌', err.message, false, true);
    }
  });

  // Instances
  $('#instances-refresh')?.addEventListener('click', () => loadInstances());
  $('#instances-create')?.addEventListener('click', () => showInstanceModal());
  $('#instances-import')?.addEventListener('click', async () => {
    const zipPath = await showPrompt({
      title: 'Import instance ZIP',
      subtitle: 'Absolute path to an Amethyst export',
      placeholder: '/path/to/instance.zip'
    });
    if (!zipPath) return;
    try {
      await api('/api/instances/import', { method: 'POST', body: { path: zipPath } });
      showModal('Importing', zipPath);
      loadDownloads();
    } catch (err) {
      log(err.message, 'error');
    }
  });

  $('#inst-play')?.addEventListener('click', () => {
    if (state.selectedInstanceId) doLaunch({ instanceId: state.selectedInstanceId });
  });
  $('#inst-install')?.addEventListener('click', async () => {
    if (!state.selectedInstanceId) return;
    try {
      await api('/api/install', { method: 'POST', body: { instanceId: state.selectedInstanceId } });
      showModal('Installing', state.selectedInstanceId);
      loadDownloads();
    } catch (err) {
      log(err.message, 'error');
    }
  });
  $('#inst-rename')?.addEventListener('click', async () => {
    if (!state.selectedInstanceId) return;
    const inst = state.instances.find((i) => i.id === state.selectedInstanceId);
    const name = await showPrompt({ title: 'Rename instance', value: inst?.name || '', placeholder: 'New name' });
    if (!name) return;
    await api(`/api/instances/${encodeURIComponent(state.selectedInstanceId)}/rename`, {
      method: 'POST',
      body: { name }
    });
    await loadInstances();
    selectInstance(state.selectedInstanceId);
  });
  $('#inst-duplicate')?.addEventListener('click', async () => {
    if (!state.selectedInstanceId) return;
    const { instance } = await api(`/api/instances/${encodeURIComponent(state.selectedInstanceId)}/duplicate`, {
      method: 'POST',
      body: {}
    });
    await loadInstances();
    selectInstance(instance.id);
    log(`Duplicated as ${instance.name}`);
  });
  $('#inst-export')?.addEventListener('click', async () => {
    if (!state.selectedInstanceId) return;
    await api(`/api/instances/${encodeURIComponent(state.selectedInstanceId)}/export`, {
      method: 'POST',
      body: {}
    });
    showModal('Exporting', 'ZIP');
    loadDownloads();
  });
  $('#inst-edit')?.addEventListener('click', () => {
    if (state.selectedInstanceId) showInstanceModal(state.selectedInstanceId);
  });
  $('#inst-delete')?.addEventListener('click', async () => {
    if (!state.selectedInstanceId) return;
    const inst = state.instances.find((i) => i.id === state.selectedInstanceId);
    if (!confirm(`Delete instance "${inst?.name}" and its files?`)) return;
    await api(`/api/instances/${encodeURIComponent(state.selectedInstanceId)}`, { method: 'DELETE' });
    state.selectedInstanceId = null;
    await loadInstances();
    selectInstance(null);
  });

  $('#instance-modal-close')?.addEventListener('click', hideInstanceModal);
  $('#instance-modal-save')?.addEventListener('click', async () => {
    try {
      await saveInstanceModal();
    } catch (err) {
      log(err.message, 'error');
    }
  });
  $('#modal-inst-loader')?.addEventListener('change', (e) => {
    loadLoaderVersionsFor(e.target.value, $('#modal-inst-version').value, $('#modal-inst-loader-version'));
  });
  $('#modal-inst-version')?.addEventListener('change', () => {
    loadLoaderVersionsFor($('#modal-inst-loader').value, $('#modal-inst-version').value, $('#modal-inst-loader-version'));
  });

  // Accounts
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
  $('#ms-login-start')?.addEventListener('click', () => startMicrosoftLogin());
  $('#ms-login-cancel')?.addEventListener('click', () => cancelMicrosoftLogin());

  // Downloads
  $('#downloads-refresh')?.addEventListener('click', () => loadDownloads());
  $('#downloads-pause')?.addEventListener('click', async () => {
    await api('/api/downloads/pause', { method: 'POST', body: {} });
    loadDownloads();
  });
  $('#downloads-resume')?.addEventListener('click', async () => {
    await api('/api/downloads/resume', { method: 'POST', body: {} });
    loadDownloads();
  });
  $('#downloads-clear')?.addEventListener('click', async () => {
    await api('/api/downloads/clear', { method: 'POST', body: {} });
    loadDownloads();
  });

  // Java
  $('#java-refresh')?.addEventListener('click', () => loadJavaPage());

  // Logs
  $('#logs-search')?.addEventListener('input', (e) => {
    state.logSearch = e.target.value;
    loadLogs();
  });
  $('#logs-copy')?.addEventListener('click', () => copyLogs());
  $('#logs-clear')?.addEventListener('click', async () => {
    await api('/api/logs', { method: 'DELETE' });
    if ($('#log-console')) $('#log-console').textContent = '';
  });
  $('#logs-crashes')?.addEventListener('click', () => loadCrashReports());
  $('#crash-close')?.addEventListener('click', () => {
    $('#crash-panel').style.display = 'none';
  });
  $('#logs-autoscroll')?.addEventListener('change', (e) => {
    state.autoscroll = e.target.checked;
  });

  // Settings
  $('#settings-save')?.addEventListener('click', async () => {
    try {
      await saveSettings();
    } catch (err) {
      log(err.message, 'error');
    }
  });
  $('#settings-memory')?.addEventListener('input', (e) => {
    updateMemoryLabels(e.target.value);
    if ($('#ql-memory')) $('#ql-memory').value = e.target.value;
  });

  // Modal
  $('#modal-primary')?.addEventListener('click', hideModal);
  $('#modal-close')?.addEventListener('click', hideModal);
  $('#download-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal();
  });
  $('#instance-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideInstanceModal();
  });
}

async function initElectronIntegration() {
  // Check if running inside Electron
  if (typeof window.AmethystAPI !== 'undefined' && window.AmethystAPI.isElectron) {
    const section = document.getElementById('desktop-shortcuts-section');
    if (section) section.style.display = 'grid';

    const createBtn = document.getElementById('create-desktop-btn');
    const pinBtn = document.getElementById('pin-taskbar-btn');
    const unpinBtn = document.getElementById('unpin-taskbar-btn');
    const status = document.getElementById('shortcut-status');

    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        try {
          const result = await window.AmethystAPI.createDesktopShortcut();
          if (result && status) status.textContent = 'Desktop shortcut created!';
          else if (status) status.textContent = 'Shortcut may already exist.';
        } catch (error) {
          if (status) status.textContent = `Error: ${error.message}`;
        }
      });
    }

    if (pinBtn) {
      pinBtn.addEventListener('click', async () => {
        try {
          const result = await window.AmethystAPI.pinToTaskbar();
          if (result && status) {
            status.textContent = 'Pinned to taskbar!';
            pinBtn.style.display = 'none';
            if (unpinBtn) unpinBtn.style.display = 'block';
          } else if (status) {
            status.textContent = 'Could not pin to taskbar. Try right-clicking the taskbar icon.';
          }
        } catch (error) {
          if (status) status.textContent = `Error: ${error.message}`;
        }
      });
    }

    if (unpinBtn) {
      unpinBtn.addEventListener('click', async () => {
        try {
          const result = await window.AmethystAPI.unpinFromTaskbar();
          if (result && status) {
            status.textContent = 'Unpinned from taskbar.';
            unpinBtn.style.display = 'none';
            if (pinBtn) pinBtn.style.display = 'block';
          } else if (status) {
            status.textContent = 'Could not unpin. Try manually unpinning.';
          }
        } catch (error) {
          if (status) status.textContent = `Error: ${error.message}`;
        }
      });
    }

    // Log that we're running in Electron
    try {
      const version = await window.AmethystAPI.getVersion();
      log(`Running in Electron (app version ${version})`);
    } catch (_) {
      log('Running in Electron');
    }
  }
}

async function boot() {
  bindUi();
  connectEvents();
  await loadStatus();
  await loadSettings();
  await Promise.all([
    loadAccounts(),
    loadVersions(),
    loadInstances(),
    loadRecent(),
    loadNews(),
    loadJavaSettingsList(),
    renderHomeFolders(),
    loadDownloads()
  ]);
  updateSelectedAccount();
  updateTopbarAccount();

  if (state.settings?.lastInstanceId) {
    state.selectedInstanceId = state.settings.lastInstanceId;
  }
  if (state.settings?.lastVersion) {
    const v = state.versions.find((x) => x.id === state.settings.lastVersion);
    if (v) selectVersion(v.id, v.type);
  }

  log('Amethyst launcher ready.');
}

boot().catch((err) => log(err.message, 'error'));
