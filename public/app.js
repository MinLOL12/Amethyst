/* Amethyst — zero-build web UI */

const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

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
  pendingVersionId: '',
  toastTimer: null,
};

const pageLabels = {
  home: 'Overview',
  versions: 'Versions',
  accounts: 'Accounts',
  settings: 'Settings',
};

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function log(message, level = 'info') {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  const target = $('#log');
  if (target) target.textContent += `${line}\n`;
  if (level === 'error') console.error(message);
}

function notify(message, level = 'success') {
  const region = $('#toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast ${level}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function setProgress(percent, text) {
  state.currentPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const miniBar = $('#progress-mini-fill');
  const miniText = $('#progress-mini-text');
  const modalBar = $('#modal-progress-bar');
  const modalPercent = $('#modal-percent');
  if (miniBar) miniBar.style.width = `${state.currentPercent}%`;
  if (miniText && text) miniText.textContent = text;
  if (modalBar) modalBar.style.width = `${state.currentPercent}%`;
  if (modalPercent) modalPercent.textContent = `${state.currentPercent}%`;
  $('#topbar-progress')?.classList.toggle('visible', state.downloadActive);
}

function setBusy(isBusy, label = 'Ready') {
  state.downloadActive = isBusy;
  $('#topbar-status').textContent = label;
  $('#topbar-progress')?.classList.toggle('visible', isBusy);
  $$('.launch-button, #detail-install').forEach((button) => { button.disabled = isBusy; });
  const quickLaunch = $('#ql-launch');
  if (quickLaunch) quickLaunch.disabled = isBusy || !$('#ql-version')?.value;
}

function navigateTo(page, updateHash = true) {
  if (!pageLabels[page]) page = 'home';
  state.currentPage = page;
  if (updateHash && window.location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  $$('.page').forEach((item) => item.classList.toggle('active', item.id === `page-${page}`));
  const path = $('#topbar-path');
  if (path) path.textContent = pageLabels[page];
}

function syncMemorySliders(value) {
  const numericValue = Number(value) || 2048;
  const minimum = 512;
  const maximum = 16384;
  const progress = `${Math.round(((numericValue - minimum) / (maximum - minimum)) * 100)}%`;
  $$('input[type="range"]').forEach((slider) => {
    slider.value = numericValue;
    slider.style.setProperty('--range-fill', progress);
  });
  updateMemoryLabels(numericValue);
}

function updateMemoryLabels(value) {
  const mb = Number(value) || 2048;
  const gb = (mb / 1024).toFixed(1).replace(/\.0$/, '');
  $$('#ql-memory-value').forEach((element) => { element.textContent = mb; });
  const detail = $('#detail-ram-label');
  const settings = $('#settings-memory-display');
  if (detail) detail.textContent = `${gb} GB`;
  if (settings) settings.textContent = `${gb} GB (${mb} MB)`;
}

function memoryValue() {
  return Number($('#settings-memory')?.value || $('#ql-memory')?.value || state.settings?.memoryMb || 2048);
}

// Settings
async function loadSettings() {
  const { settings } = await api('/api/settings');
  state.settings = settings;
  syncMemorySliders(settings.memoryMb);
  $('#settings-java-path').value = settings.javaPath || '';
  if (settings.lastVersion && $('#ql-version')) $('#ql-version').value = settings.lastVersion;
  const dataDirectory = $('#settings-data-dir');
  if (dataDirectory) dataDirectory.textContent = settings.gameDir || '—';
}

async function saveSettings(extra = {}) {
  const body = {
    ...state.settings,
    memoryMb: memoryValue(),
    javaPath: $('#settings-java-path')?.value.trim() || '',
    lastVersion: $('#ql-version')?.value || state.settings?.lastVersion || '',
    lastAccountId: state.settings?.lastAccountId || '',
    ...extra,
  };
  const { settings } = await api('/api/settings', { method: 'POST', body });
  state.settings = settings;
  syncMemorySliders(settings.memoryMb);
  log('Settings saved.');
  return settings;
}

// Accounts
async function loadAccounts() {
  const { accounts } = await api('/api/accounts');
  state.accounts = accounts;
  renderAccounts();
  updateSelectedAccount();
  const count = $('#accounts-count');
  const panelCount = $('#account-panel-count');
  if (count) count.textContent = accounts.length;
  if (panelCount) panelCount.textContent = accounts.length;
}

function renderAccounts() {
  const container = $('#account-list');
  if (!container) return;
  if (!state.accounts.length) {
    container.innerHTML = '<div class="account-empty"><div class="empty-glyph">◇</div><strong>No accounts yet</strong><p>Add a profile to launch Minecraft.</p></div>';
    return;
  }

  container.innerHTML = '';
  for (const account of state.accounts) {
    const selected = account.id === state.settings?.lastAccountId;
    const item = document.createElement('div');
    item.className = `account-item${selected ? ' selected' : ''}`;
    const initial = escapeHtml((account.username || '?').charAt(0).toUpperCase());
    const uuid = escapeHtml(account.uuid ? `${account.uuid.slice(0, 8)}…` : 'No UUID');
    item.innerHTML = `
      <div class="account-avatar">${initial}</div>
      <div class="account-info">
        <span class="account-name">${escapeHtml(account.username)}</span>
        <span class="account-uuid">${uuid}</span>
        <span class="account-status"><i class="account-status-dot"></i><span class="account-status-label">Offline profile</span></span>
      </div>
      <div class="account-actions">
        <button class="button button-subtle select-btn" type="button">${selected ? 'Selected' : 'Select'}</button>
        <button class="button button-quiet delete-btn" type="button" aria-label="Delete ${escapeHtml(account.username)}">×</button>
      </div>`;

    item.querySelector('.select-btn').addEventListener('click', (event) => {
      event.stopPropagation();
      selectAccount(account);
    });
    item.querySelector('.delete-btn').addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await api(`/api/accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
        if (state.settings?.lastAccountId === account.id) await saveSettings({ lastAccountId: '' });
        await loadAccounts();
        notify(`${account.username} was removed.`);
      } catch (error) {
        reportError(error);
      }
    });
    item.addEventListener('click', () => selectAccount(account));
    container.append(item);
  }
}

async function selectAccount(account) {
  try {
    await saveSettings({ lastAccountId: account.id });
    renderAccounts();
    updateSelectedAccount();
    notify(`${account.username} is ready to launch.`);
  } catch (error) {
    reportError(error);
  }
}

function updateSelectedAccount() {
  const account = state.accounts.find((item) => item.id === state.settings?.lastAccountId);
  const panel = $('#selected-account');
  const name = $('#selected-name');
  if (panel) panel.style.display = account ? 'block' : 'none';
  if (name && account) name.textContent = account.username;
}

// Versions
async function loadVersions() {
  const data = await api('/api/versions');
  state.versions = data.versions || [];
  renderVersionSelect();
  renderVersionList();
  const count = $('#versions-count');
  if (count) count.textContent = state.versions.length;
  log(`Loaded ${state.versions.length} official versions from Mojang.`);
}

function renderVersionSelect() {
  const select = $('#ql-version');
  if (!select) return;
  select.innerHTML = '<option value="">Select a version…</option>';
  for (const version of state.versions) {
    const option = document.createElement('option');
    option.value = version.id;
    option.textContent = `${version.id} · ${version.type}`;
    option.selected = version.id === state.settings?.lastVersion;
    select.append(option);
  }
  $('#ql-launch').disabled = !select.value || state.downloadActive;
}

function renderVersionList() {
  const container = $('#version-list');
  if (!container) return;
  const search = state.filterText.toLowerCase();
  const filtered = state.versions.filter((version) => (
    (state.filterType === 'all' || version.type === state.filterType) &&
    (!search || version.id.toLowerCase().includes(search))
  ));
  if (!filtered.length) {
    container.innerHTML = '<div class="account-empty"><div class="empty-glyph">⌕</div><strong>No versions found</strong><p>Try another search or filter.</p></div>';
    return;
  }
  container.innerHTML = '';
  for (const version of filtered) {
    const typeClass = version.type === 'release' ? 'release' : version.type === 'snapshot' ? 'snapshot' : 'old-beta';
    const item = document.createElement('div');
    item.className = `version-item${version.id === state.selectedVersionId ? ' selected' : ''}`;
    item.innerHTML = `<span class="version-dot ${typeClass}"></span><div><div class="version-name">${escapeHtml(version.id)}</div><div class="version-type">${escapeHtml(version.type || 'unknown')}</div></div>`;
    item.addEventListener('click', () => selectVersion(version.id, version.type));
    container.append(item);
  }
}

function selectVersion(id, type = 'release') {
  state.selectedVersionId = id;
  state.selectedVersionType = type;
  renderVersionList();
  if ($('#ql-version')) $('#ql-version').value = id;
  const empty = $('#detail-empty');
  const content = $('#detail-content');
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'flex';
  $('#detail-id').textContent = id;
  const badge = $('#detail-badge');
  badge.textContent = type;
  badge.className = `detail-badge ${type}`;
  const version = state.versions.find((item) => item.id === id);
  $('#detail-date').textContent = version?.releaseTime ? `Released ${new Date(version.releaseTime).toLocaleDateString()}` : 'Official Minecraft version';
  $('#detail-ver').textContent = id;
  $('#detail-type').textContent = type;
  $('#detail-dir').textContent = state.settings?.gameDir || '—';
}

// Java and news
async function loadJava() {
  const container = $('#settings-java-list');
  if (!container) return;
  container.innerHTML = '<span class="muted">Scanning…</span>';
  try {
    const { installations } = await api('/api/java');
    const first = installations?.[0];
    const status = $('#java-status');
    if (status) status.textContent = first ? `Java ${first.major || ''}`.trim() : 'Not found';
    if (!installations?.length) {
      container.innerHTML = '<span class="muted">No Java executable found. Install Java 17 or newer to play.</span>';
      return;
    }
    container.innerHTML = '';
    for (const java of installations) {
      const item = document.createElement('div');
      item.className = 'java-item';
      item.innerHTML = `<span class="java-dot ${java.major >= 17 ? 'ok' : 'warn'}"></span><span class="java-path">${escapeHtml(java.path)}</span><span class="java-meta">Java ${escapeHtml(java.major || '?')} · ${escapeHtml(java.arch || '?')}</span>`;
      item.addEventListener('click', () => {
        $('#settings-java-path').value = java.path;
        notify('Java path selected. Save settings to keep it.');
      });
      container.append(item);
    }
  } catch (error) {
    const status = $('#java-status');
    if (status) status.textContent = 'Unavailable';
    container.innerHTML = `<span class="muted">${escapeHtml(error.message)}</span>`;
  }
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}

async function loadNews() {
  const container = $('#news');
  if (!container) return;
  container.innerHTML = '<p class="muted">Loading news…</p>';
  try {
    const { entries } = await api('/api/news');
    if (!entries?.length) {
      container.innerHTML = '<p class="muted">No news available right now.</p>';
      return;
    }
    container.innerHTML = '';
    for (const entry of entries) {
      const item = document.createElement('article');
      item.className = 'news-item';
      item.innerHTML = `<span class="news-meta">${escapeHtml([entry.category, entry.date].filter(Boolean).join(' · '))}</span><h3>${escapeHtml(entry.title)}</h3><p>${escapeHtml(entry.excerpt || '')}</p><a href="${escapeHtml(safeExternalUrl(entry.url))}" target="_blank" rel="noreferrer">Read story</a>`;
      container.append(item);
    }
  } catch (error) {
    container.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

// Status and modal
async function loadStatus() {
  try {
    const data = await api('/api/status');
    $('#app-version').textContent = data.version || '0.1.0';
    $('#about-version').textContent = data.version || '0.1.0';
    $('#settings-data-dir').textContent = data.dataRoot || '—';
    setOnline(true);
  } catch {
    setOnline(false);
  }
}

function setOnline(online) {
  $$('.status-dot').forEach((dot) => { dot.className = `status-dot ${online ? 'online' : 'offline'}`; });
  $('#status-text').textContent = online ? 'Connected' : 'Disconnected';
  $('#about-backend-status').textContent = online ? 'Running locally' : 'Disconnected';
  $('#topbar-status').textContent = online ? 'Ready' : 'Backend unavailable';
}

function showModal(title, versionId) {
  const modal = $('#download-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  $('#modal-title').textContent = title;
  $('#modal-version').textContent = versionId || 'Preparing';
  $('#modal-status-icon').textContent = '◌';
  $('#modal-status-text').textContent = 'Preparing your game files…';
  $('#modal-progress-bar').style.width = '0%';
  $('#modal-percent').textContent = '0%';
  $('#modal-progress-wrap').style.display = 'block';
  $('#modal-percent').style.display = 'block';
  $('#modal-primary').textContent = 'Hide';
  $('#modal-primary').dataset.state = 'active';
  $('#modal-primary').disabled = false;
}

function hideModal() { $('#download-modal').style.display = 'none'; }

function updateModal(status, text, complete = false, error = false) {
  $('#modal-status-icon').textContent = status;
  $('#modal-status-text').textContent = text;
  const primary = $('#modal-primary');
  if (complete) {
    primary.textContent = 'Play now';
    primary.dataset.state = 'complete';
    $('#modal-progress-wrap').style.display = 'none';
    $('#modal-percent').style.display = 'none';
  } else if (error) {
    primary.textContent = 'Close';
    primary.dataset.state = 'error';
  }
}

function reportError(error) {
  const message = error?.message || String(error);
  setBusy(false, 'Error');
  log(message, 'error');
  notify(message, 'error');
}

// Live backend events
function connectEvents() {
  const source = new EventSource('/api/events');
  source.onmessage = (message) => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    switch (event.type) {
      case 'hello':
        log(`${event.app} event stream connected.`);
        setOnline(true);
        break;
      case 'task-start':
        setBusy(true, event.name);
        setProgress(0, event.name);
        showModal(event.name, state.pendingVersionId);
        log(`Started: ${event.name}`);
        break;
      case 'task-complete':
        setBusy(false, 'Ready');
        setProgress(100, 'Complete');
        updateModal('✓', 'Everything is ready.', true);
        notify(`${event.name} completed.`, 'success');
        log(`Complete: ${event.name}`);
        break;
      case 'task-error':
        setBusy(false, 'Error');
        updateModal('!', event.message, false, true);
        notify(event.message, 'error');
        log(`Error in ${event.name}: ${event.message}`, 'error');
        break;
      case 'download-progress':
        if (event.total) {
          setProgress(event.percent, `${event.percent}%`);
          $('#modal-status-text').textContent = `${event.label}: ${event.percent}%`;
        }
        break;
      case 'download-start': log(`Downloading ${event.label}`); break;
      case 'download-complete': log(`Downloaded ${event.label}`); break;
      case 'download-skip': log(`Already current: ${event.label}`); break;
      case 'assets-progress':
        setProgress(event.percent, `${event.completed}/${event.total}`);
        $('#modal-status-text').textContent = `Assets: ${event.completed}/${event.total}`;
        break;
      case 'status':
        log(event.message);
        $('#modal-status-text').textContent = event.message;
        break;
      case 'launch-start':
        log(`Launching ${event.versionId} with ${event.java}`);
        hideModal();
        notify(`Minecraft ${event.versionId} is launching.`);
        break;
      case 'game-log': log((event.message || '').trim()); break;
      case 'launch-exit': log(`Minecraft exited with code ${event.code ?? 'n/a'}${event.signal ? ` (${event.signal})` : ''}.`); break;
      default: break;
    }
  };
  source.onerror = () => setOnline(false);
}

function selectedPayload() {
  return {
    versionId: $('#ql-version')?.value || state.selectedVersionId || state.settings?.lastVersion || '',
    accountId: state.settings?.lastAccountId || '',
    memoryMb: memoryValue(),
    javaPath: $('#settings-java-path')?.value.trim() || '',
  };
}

async function doInstall(versionId) {
  const payload = selectedPayload();
  payload.versionId = versionId || payload.versionId;
  if (!payload.versionId) throw new Error('Choose a version first.');
  state.pendingVersionId = payload.versionId;
  await saveSettings({ lastVersion: payload.versionId });
  await api('/api/install', { method: 'POST', body: payload });
}

async function doLaunch(versionId) {
  const payload = selectedPayload();
  payload.versionId = versionId || payload.versionId;
  if (!payload.versionId) throw new Error('Choose a version first.');
  const account = state.accounts.find((item) => item.id === state.settings?.lastAccountId) || state.accounts[0];
  if (!account) throw new Error('Create an offline account before launching.');
  payload.accountId = account.id;
  state.pendingVersionId = payload.versionId;
  await saveSettings({ lastVersion: payload.versionId, lastAccountId: payload.accountId });
  await api('/api/launch', { method: 'POST', body: payload });
}

function bindUi() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', (event) => {
    event.preventDefault();
    navigateTo(item.dataset.page);
  }));
  window.addEventListener('hashchange', () => navigateTo(window.location.hash.slice(1), false));

  $('#home-browse')?.addEventListener('click', () => navigateTo('versions'));
  $('#home-accounts')?.addEventListener('click', () => navigateTo('accounts'));
  $('#ql-version')?.addEventListener('change', (event) => {
    $('#ql-launch').disabled = !event.target.value || state.downloadActive;
    state.selectedVersionId = event.target.value || state.selectedVersionId;
  });
  $('#ql-launch')?.addEventListener('click', () => doLaunch().catch(reportError));
  $('#ql-memory')?.addEventListener('input', (event) => syncMemorySliders(event.target.value));

  $('#versions-refresh')?.addEventListener('click', () => loadVersions().catch(reportError));
  $('#versions-search')?.addEventListener('input', (event) => { state.filterText = event.target.value; renderVersionList(); });
  $$('.filter-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.filter-tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    state.filterType = tab.dataset.filter;
    renderVersionList();
  }));
  $('#detail-install')?.addEventListener('click', () => doInstall(state.selectedVersionId).catch(reportError));
  $('#detail-memory')?.addEventListener('input', (event) => syncMemorySliders(event.target.value));

  $('#accounts-refresh')?.addEventListener('click', () => loadAccounts().catch(reportError));
  $('#account-add')?.addEventListener('click', addAccount);
  $('#account-username')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') addAccount(); });
  $('#settings-save')?.addEventListener('click', () => saveSettings().then(() => notify('Settings saved.')).catch(reportError));
  $('#settings-memory')?.addEventListener('input', (event) => syncMemorySliders(event.target.value));
  $('#refresh-news')?.addEventListener('click', () => loadNews().catch(reportError));

  $('#modal-primary')?.addEventListener('click', () => {
    if ($('#modal-primary').dataset.state === 'complete') doLaunch(state.pendingVersionId).catch(reportError);
    else hideModal();
  });
  $('#modal-close')?.addEventListener('click', hideModal);
  $('#download-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) hideModal(); });
  document.addEventListener('keydown', (event) => {
    if (event.key >= '1' && event.key <= '4' && !/input|select|textarea/i.test(document.activeElement?.tagName || '')) navigateTo(['home', 'versions', 'accounts', 'settings'][Number(event.key) - 1]);
    if (event.key === 'Escape') hideModal();
  });
}

async function addAccount() {
  const input = $('#account-username');
  const username = input?.value.trim();
  if (!username) { input?.focus(); return; }
  const button = $('#account-add');
  button.disabled = true;
  try {
    const { account } = await api('/api/accounts', { method: 'POST', body: { username } });
    input.value = '';
    await saveSettings({ lastAccountId: account.id });
    await loadAccounts();
    notify(`${account.username} is ready to play.`);
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
  }
}

async function boot() {
  bindUi();
  navigateTo(window.location.hash.slice(1) || 'home', false);
  connectEvents();
  await loadStatus();
  await loadSettings();
  const results = await Promise.allSettled([loadAccounts(), loadVersions(), loadJava(), loadNews()]);
  results.filter((result) => result.status === 'rejected').forEach((result) => reportError(result.reason));
  if (state.settings?.lastVersion) {
    const version = state.versions.find((item) => item.id === state.settings.lastVersion);
    if (version) selectVersion(version.id, version.type);
  }
  log('Amethyst launcher ready.');
}

boot().catch(reportError);
