/* Amethyst — polished UI + modpack creator */

const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

const state = {
  settings: null,
  accounts: [],
  versions: [],
  installedVersions: [],
  modpacks: [],
  currentPage: 'home',
  currentPercent: 0,
  downloadActive: false,
  selectedVersionId: null,
  selectedVersionType: 'release',
  selectedModpackId: null,
  filterType: 'all',
  filterText: '',
  pendingVersionId: '',
  toastTimer: null,
  microsoftLoginId: null,
  microsoftLoginTimer: null,
  skinAccountId: null,
  skinImageData: '',
  skinSourceUrl: '',
  loaderVersions: {},
  loaderRequestId: 0,
  gameRunning: false,
  gameLoading: false,
  startupLogCount: 0,
  runtimeMemoryLimit: 2048 * 1024 * 1024,
  themes: [],
  activeThemeId: 'amethyst',
  onlineWasOnline: false,
  pendingRefresh: false,
  lastFetchError: null,
  retryCount: 0,
  modSearchPage: 1,
  modSearchQuery: '',
  modSearchType: 'mod',
  modSearchTotalHits: 0
};

const pageLabels = {
  home: 'Overview',
  versions: 'Versions',
  modpacks: 'Modpacks',
  accounts: 'Accounts',
  settings: 'Settings',
};

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).split('T')[0] || 'Unknown date';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderMarkdownSafe(markdown = '') {
  let html = escapeHtml(markdown || 'No description provided.');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(?:^|\n)-\s+(.+)(?=\n|$)/g, '<br>• $1')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

function selectedModpack() {
  return state.modpacks.find(m => m.id === state.selectedModpackId) || null;
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
  try {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
    
    // Handle network errors and failed responses
    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const data = await response.json().catch(() => ({}));
        errorMsg = data.error || data.message || errorMsg;
        if (data.hint) errorMsg += ` - ${data.hint}`;
        if (data.type === 'NETWORK_ERROR') {
          errorMsg = 'Network error: ' + errorMsg;
        } else if (data.type === 'TIMEOUT_ERROR') {
          errorMsg = 'Request timed out: ' + errorMsg;
        } else if (data.type === 'PARSE_ERROR') {
          errorMsg = 'Data parse error: ' + errorMsg;
        }
      } catch (_) {
        // Couldn't parse error response, use status
      }
      
      const error = new Error(errorMsg);
      error.status = response.status;
      throw error;
    }
    
    const data = await response.json().catch(() => ({}));
    return data;
  } catch (error) {
    // Handle fetch errors (network issues, CORS, etc.)
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      const enhancedError = new Error('Network error: Failed to connect to the server. Check if the backend is running and your internet connection is active.');
      enhancedError.status = 0;
      enhancedError.type = 'NETWORK_ERROR';
      throw enhancedError;
    }
    
    // Handle timeout errors
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      const enhancedError = new Error('Request timed out. Please check your connection and try again.');
      enhancedError.status = error.status || 0;
      enhancedError.type = 'TIMEOUT_ERROR';
      throw enhancedError;
    }
    
    // Re-throw the original error
    throw error;
  }
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

const loaderTypeSelectors = ['#ql-loader-type', '#detail-loader-type', '#settings-loader-type'];
const loaderVersionSelectors = ['#ql-loader-version', '#detail-loader-version', '#settings-loader-version'];
const loaderVersionWraps = ['#ql-loader-version-wrap', '#detail-loader-version-wrap', '#settings-loader-version-wrap'];

function selectedLoaderType() {
  return $('#ql-loader-type')?.value || state.settings?.loaderType || 'vanilla';
}

function selectedLoaderVersion() {
  return $('#ql-loader-version')?.value || state.settings?.loaderVersion || '';
}

function updateLoaderLabel() {
  const label = $('#detail-loader-label');
  if (!label) return;
  const loader = selectedLoaderType();
  const version = selectedLoaderVersion();
  label.textContent = loader === 'vanilla'
    ? 'Vanilla'
    : `${loader[0].toUpperCase()}${loader.slice(1)}${version ? ` ${version}` : ' · latest compatible'}`;
}

function syncLoaderValues(loader, loaderVersion = '') {
  for (const selector of loaderTypeSelectors) {
    const select = $(selector);
    if (select) select.value = loader;
  }
  for (const selector of loaderVersionSelectors) {
    const select = $(selector);
    if (select && [...select.options].some((option) => option.value === loaderVersion)) {
      select.value = loaderVersion;
    }
  }
  updateLoaderLabel();
}

function setLoaderVersionVisibility(visible) {
  for (const selector of loaderVersionWraps) {
    const wrap = $(selector);
    if (wrap) wrap.hidden = !visible;
  }
}

function renderLoaderVersions(versions, preferredVersion = '') {
  const unique = [...new Map((versions || [])
    .filter((entry) => entry?.version)
    .map((entry) => [entry.version, entry])).values()];
  const preferred = unique.find((entry) => entry.version === preferredVersion)?.version;
  const stable = unique.find((entry) => entry.stable)?.version;
  const selected = preferred || stable || unique[0]?.version || '';

  for (const selector of loaderVersionSelectors) {
    const select = $(selector);
    if (!select) continue;
    select.innerHTML = unique.length ? '' : '<option value="">No compatible versions found</option>';
    for (const entry of unique) {
      const option = document.createElement('option');
      option.value = entry.version;
      option.textContent = `${entry.version}${entry.stable ? ' · recommended' : ''}`;
      select.append(option);
    }
    select.value = selected;
  }
  setLoaderVersionVisibility(true);
  updateLoaderLabel();
  return selected;
}

async function refreshLoaderVersions(preferredVersion = '') {
  const loader = selectedLoaderType();
  const requestId = ++state.loaderRequestId;
  syncLoaderValues(loader, preferredVersion);
  if (loader === 'vanilla') {
    for (const selector of loaderVersionSelectors) {
      const select = $(selector);
      if (select) select.innerHTML = '<option value="">Not required</option>';
    }
    setLoaderVersionVisibility(false);
    updateLoaderLabel();
    return '';
  }

  const gameVersion = $('#ql-version')?.value || state.selectedVersionId || state.settings?.lastVersion || '';
  if (!gameVersion) {
    setLoaderVersionVisibility(true);
    return '';
  }

  const cacheKey = `${loader}:${gameVersion}`;
  if (state.loaderVersions[cacheKey]) {
    return renderLoaderVersions(state.loaderVersions[cacheKey], preferredVersion || selectedLoaderVersion());
  }

  setLoaderVersionVisibility(true);
  for (const selector of loaderVersionSelectors) {
    const select = $(selector);
    if (select) select.innerHTML = '<option value="">Loading compatible versions…</option>';
  }
  try {
    const data = await api(`/api/loaders/versions?loader=${encodeURIComponent(loader)}&gameVersion=${encodeURIComponent(gameVersion)}`);
    if (requestId !== state.loaderRequestId || loader !== selectedLoaderType()) return '';
    state.loaderVersions[cacheKey] = data.versions || [];
    if (data.error && !data.versions?.length) log(`${loader} metadata: ${data.error}`, 'error');
    return renderLoaderVersions(data.versions || [], preferredVersion);
  } catch (error) {
    if (requestId === state.loaderRequestId) {
      renderLoaderVersions([], '');
      log(`Could not list ${loader} versions: ${error.message}`, 'error');
    }
    return '';
  }
}

async function selectLoader(loader, preferredVersion = '') {
  const normalized = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(loader)
    ? loader
    : 'vanilla';
  for (const selector of loaderTypeSelectors) {
    const select = $(selector);
    if (select) select.value = normalized;
  }
  return refreshLoaderVersions(preferredVersion);
}

function syncSelectedLoaderVersion(version) {
  for (const selector of loaderVersionSelectors) {
    const select = $(selector);
    if (select && [...select.options].some((option) => option.value === version)) select.value = version;
  }
  updateLoaderLabel();
}

// Settings
const defaultTheme = { id: 'amethyst', name: 'Amethyst', background: '#0b0912', panel: '#171223', accent: '#a879ff', accentBright: '#c6a8ff', text: '#f7f4ff' };

function makeThemeId(name = 'theme') {
  const slug = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 28) || 'theme';
  return `${slug}-${Date.now().toString(36)}`;
}

function normalizeTheme(theme = {}) {
  return { ...defaultTheme, ...theme, id: theme.id || defaultTheme.id };
}

function themeCollection(settings = state.settings || {}) {
  const themes = Array.isArray(settings.themes) && settings.themes.length
    ? settings.themes.map(normalizeTheme)
    : [normalizeTheme(settings.theme)];
  const ids = new Set();
  return themes.filter((theme) => {
    if (ids.has(theme.id)) return false;
    ids.add(theme.id);
    return true;
  });
}

function currentThemeId() {
  return $('#settings-theme-select')?.value || state.activeThemeId || defaultTheme.id;
}

function themeFromForm(id = currentThemeId()) {
  return {
    id,
    name: $('#settings-theme-name')?.value.trim() || 'Custom theme',
    background: $('#settings-theme-background')?.value || defaultTheme.background,
    panel: $('#settings-theme-panel')?.value || defaultTheme.panel,
    accent: $('#settings-theme-accent')?.value || defaultTheme.accent,
    accentBright: $('#settings-theme-bright')?.value || defaultTheme.accentBright,
    text: $('#settings-theme-text')?.value || defaultTheme.text
  };
}

function populateThemeForm(theme = defaultTheme) {
  const value = normalizeTheme(theme);
  $('#settings-theme-name').value = value.name;
  $('#settings-theme-background').value = value.background;
  $('#settings-theme-panel').value = value.panel;
  $('#settings-theme-accent').value = value.accent;
  $('#settings-theme-bright').value = value.accentBright;
  $('#settings-theme-text').value = value.text;
}

function renderThemeSelect() {
  const select = $('#settings-theme-select');
  if (!select) return;
  select.innerHTML = '';
  for (const theme of state.themes) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    select.append(option);
  }
  select.value = state.activeThemeId;
  if (select.value !== state.activeThemeId) {
    state.activeThemeId = state.themes[0]?.id || defaultTheme.id;
    select.value = state.activeThemeId;
  }
  const deleteButton = $('#settings-theme-delete');
  if (deleteButton) deleteButton.disabled = state.themes.length < 2;
}

function applyTheme(theme = defaultTheme) {
  const value = normalizeTheme(theme);
  const root = document.documentElement.style;
  root.setProperty('--bg', value.background);
  root.setProperty('--panel-solid', value.panel);
  root.setProperty('--panel-raised', value.panel);
  root.setProperty('--violet', value.accent);
  root.setProperty('--violet-deep', value.accent);
  root.setProperty('--violet-bright', value.accentBright);
  root.setProperty('--ink', value.text);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value.background);
}

function commitThemeForm(id = currentThemeId()) {
  const theme = themeFromForm(id);
  const index = state.themes.findIndex((entry) => entry.id === id);
  if (index >= 0) state.themes[index] = theme;
  else state.themes.push(theme);
  state.activeThemeId = theme.id;
  state.settings = {
    ...(state.settings || {}),
    theme,
    themes: state.themes,
    activeThemeId: state.activeThemeId
  };
  return theme;
}

function selectTheme(id) {
  // A native <select> has already changed its value by the time `change`
  // fires, so save the form under the previously active id explicitly.
  commitThemeForm(state.activeThemeId || currentThemeId());
  const theme = state.themes.find((entry) => entry.id === id) || state.themes[0] || defaultTheme;
  state.activeThemeId = theme.id;
  populateThemeForm(theme);
  renderThemeSelect();
  applyTheme(theme);
}

function createTheme() {
  commitThemeForm();
  const theme = { ...defaultTheme, id: makeThemeId('custom-theme'), name: 'Custom theme' };
  state.themes.push(theme);
  state.activeThemeId = theme.id;
  populateThemeForm(theme);
  renderThemeSelect();
  applyTheme(theme);
  $('#settings-theme-name')?.focus();
}

function interpolatePresence(template, context) {
  return String(template || '').replace(/\{(version|loader|player)\}/g, (_, key) => context[key] || '—');
}

function updateDiscordPreview(status = '') {
  const preview = $('#settings-discord-preview');
  if (!preview) return;
  const account = state.accounts.find((item) => item.id === state.settings?.lastAccountId) || state.accounts[0];
  const context = {
    version: $('#ql-version')?.value || state.settings?.lastVersion || 'Minecraft',
    loader: selectedLoaderType() === 'vanilla' ? 'Vanilla' : selectedLoaderType(),
    player: account?.username || 'Player'
  };
  const details = interpolatePresence($('#settings-discord-details')?.value || 'Playing Minecraft {version}', context);
  const presenceState = interpolatePresence($('#settings-discord-state')?.value || 'via {loader} · {player}', context);
  preview.textContent = status || `Preview: ${details} — ${presenceState}`;
}

function populateDiscordSettings(settings) {
  $('#settings-discord-enabled').checked = Boolean(settings.discordEnabled);
  $('#settings-discord-client-id').value = settings.discordClientId || '';
  $('#settings-discord-details').value = settings.discordDetails || 'Playing Minecraft {version}';
  $('#settings-discord-state').value = settings.discordState || 'via {loader} · {player}';
  $('#settings-discord-image-key').value = settings.discordLargeImageKey || '';
  $('#settings-discord-image-text').value = settings.discordLargeImageText || 'Amethyst Launcher';
  $('#settings-discord-elapsed').checked = settings.discordShowElapsed !== false;
  updateDiscordPreview(settings.discordEnabled ? 'Discord RPC will connect when Minecraft is running.' : 'Discord RPC is disabled.');
}

async function loadSettings() {
  const { settings } = await api('/api/settings');
  state.settings = settings;
  state.themes = themeCollection(settings);
  state.activeThemeId = state.themes.some((theme) => theme.id === settings.activeThemeId)
    ? settings.activeThemeId
    : state.themes[0].id;
  state.runtimeMemoryLimit = (Number(settings.memoryMb) || 2048) * 1024 * 1024;
  syncMemorySliders(settings.memoryMb);
  populateDiscordSettings(settings);
  populateThemeForm(state.themes.find((theme) => theme.id === state.activeThemeId));
  renderThemeSelect();
  applyTheme(state.themes.find((theme) => theme.id === state.activeThemeId));
  $('#settings-java-path').value = settings.javaPath || '';
  if (settings.lastVersion && $('#ql-version')) $('#ql-version').value = settings.lastVersion;
  await selectLoader(settings.loaderType || 'vanilla', settings.loaderVersion || '');
  const dataDirectory = $('#settings-data-dir');
  if (dataDirectory) dataDirectory.textContent = settings.gameDir || '—';
  const gameDirectory = $('#settings-game-dir');
  if (gameDirectory) gameDirectory.textContent = settings.gameDir || '—';
}

async function saveSettings(extra = {}) {
  const activeTheme = commitThemeForm();
  const body = {
    ...state.settings,
    memoryMb: memoryValue(),
    javaPath: $('#settings-java-path')?.value.trim() || '',
    lastVersion: $('#ql-version')?.value || state.settings?.lastVersion || '',
    lastAccountId: state.settings?.lastAccountId || '',
    loaderType: selectedLoaderType(),
    loaderVersion: selectedLoaderType() === 'vanilla' ? '' : selectedLoaderVersion(),
    discordEnabled: Boolean($('#settings-discord-enabled')?.checked),
    discordClientId: $('#settings-discord-client-id')?.value.trim() || '',
    discordDetails: $('#settings-discord-details')?.value.trim() || 'Playing Minecraft {version}',
    discordState: $('#settings-discord-state')?.value.trim() || 'via {loader} · {player}',
    discordLargeImageKey: $('#settings-discord-image-key')?.value.trim() || '',
    discordLargeImageText: $('#settings-discord-image-text')?.value.trim() || 'Amethyst Launcher',
    discordShowElapsed: $('#settings-discord-elapsed')?.checked !== false,
    theme: activeTheme,
    themes: state.themes,
    activeThemeId: state.activeThemeId,
    ...extra,
  };
  const response = await api('/api/settings', { method: 'POST', body });
  const { settings } = response;
  state.settings = settings;
  state.themes = themeCollection(settings);
  state.activeThemeId = settings.activeThemeId || state.themes[0].id;
  state.runtimeMemoryLimit = settings.memoryMb * 1024 * 1024;
  syncMemorySliders(settings.memoryMb);
  renderThemeSelect();
  applyTheme(settings.theme);
  const discordStatus = response.discord?.connected
    ? 'Discord RPC is connected for this Minecraft session.'
    : (settings.discordEnabled
      ? (response.discord?.reason === 'missing-client-id' ? 'Add a Discord Application ID to connect.' : 'Discord RPC will connect when Minecraft is running.')
      : 'Discord RPC is disabled.');
  updateDiscordPreview(discordStatus);
  log('Settings saved.');
  return settings;
}

// Accounts
async function loadAccounts() {
  const { accounts } = await api('/api/accounts');
  state.accounts = accounts;
  renderAccounts();
  updateSelectedAccount();
  updateDiscordPreview();
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
    const isMicrosoft = account.type === 'microsoft';
    const item = document.createElement('div');
    item.className = `account-item${selected ? ' selected' : ''}${isMicrosoft ? ' microsoft' : ''}`;
    const initial = escapeHtml((account.username || '?').charAt(0).toUpperCase());
    const uuid = escapeHtml(account.uuid ? `${account.uuid.slice(0, 8)}…` : 'No UUID');
    const status = isMicrosoft
      ? (account.tokenExpired ? 'Microsoft · session refresh needed' : 'Microsoft · online & skins')
      : 'Offline profile';
    item.innerHTML = `
      <div class="account-avatar">${initial}</div>
      <div class="account-info">
        <span class="account-name">${escapeHtml(account.username)}</span>
        <span class="account-uuid">${uuid}</span>
        <span class="account-status"><i class="account-status-dot"></i><span class="account-status-label">${status}</span></span>
      </div>
      <div class="account-actions">
        <button class="button button-quiet skin-btn" type="button" title="${isMicrosoft ? 'Import and apply a custom skin' : 'Sign in with Microsoft to publish a custom skin'}">Skin</button>
        <button class="button button-subtle select-btn" type="button">${selected ? 'Selected' : 'Select'}</button>
        <button class="button button-quiet delete-btn" type="button" aria-label="Delete ${escapeHtml(account.username)}">×</button>
      </div>`;
    item.querySelector('.select-btn').addEventListener('click', (event) => {
      event.stopPropagation();
      selectAccount(account);
    });
    item.querySelector('.skin-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      showSkinManager(account);
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

// Microsoft device-code login
function showMicrosoftModal() {
  $('#microsoft-modal').style.display = 'flex';
  $('#microsoft-login-message').textContent = 'Requesting a sign-in code…';
  $('#microsoft-user-code').textContent = 'Requesting…';
  $('#microsoft-user-code').disabled = true;
  $('#microsoft-login-status').textContent = 'Connecting securely to Microsoft…';
  $('#microsoft-login-status').className = 'skin-status';
}

async function closeMicrosoftModal(cancelPending = true) {
  if (state.microsoftLoginTimer) window.clearTimeout(state.microsoftLoginTimer);
  state.microsoftLoginTimer = null;
  const loginId = state.microsoftLoginId;
  state.microsoftLoginId = null;
  $('#microsoft-modal').style.display = 'none';
  if (cancelPending && loginId) {
    await api(`/api/accounts/microsoft/cancel/${encodeURIComponent(loginId)}`, { method: 'POST' }).catch(() => {});
  }
}

async function startMicrosoftLogin() {
  const button = $('#account-microsoft');
  button.disabled = true;
  showMicrosoftModal();
  try {
    const login = await api('/api/accounts/microsoft/start', { method: 'POST', body: { remember: true } });
    if (!login.userCode) throw new Error('Microsoft did not provide a sign-in code.');
    state.microsoftLoginId = login.loginId;
    $('#microsoft-user-code').textContent = login.userCode;
    $('#microsoft-user-code').disabled = false;
    $('#microsoft-login-link').href = login.verificationUri || 'https://www.microsoft.com/link';
    $('#microsoft-login-message').textContent = login.message || 'Open Microsoft sign-in and enter this one-time code.';
    $('#microsoft-login-status').textContent = 'Waiting for you to finish signing in…';
    pollMicrosoftLogin(Math.max(2, Number(login.interval) || 5));
  } catch (error) {
    $('#microsoft-login-status').textContent = error.message;
    $('#microsoft-login-status').className = 'skin-status error';
    reportError(error);
  } finally {
    button.disabled = false;
  }
}

async function pollMicrosoftLogin(intervalSeconds) {
  const loginId = state.microsoftLoginId;
  if (!loginId) return;
  try {
    const result = await api(`/api/accounts/microsoft/status/${encodeURIComponent(loginId)}`);
    if (result.status === 'complete') {
      await closeMicrosoftModal(false);
      await loadSettings();
      await loadAccounts();
      notify(`Signed in as ${result.account?.username || 'your Microsoft account'}.`);
      return;
    }
    if (['error', 'expired', 'cancelled', 'unknown'].includes(result.status)) {
      $('#microsoft-login-status').textContent = result.error || 'Microsoft sign-in was not completed.';
      $('#microsoft-login-status').className = 'skin-status error';
      state.microsoftLoginId = null;
      return;
    }
    $('#microsoft-login-status').textContent = result.status === 'authenticating'
      ? 'Microsoft approved the code. Connecting to Minecraft services…'
      : 'Waiting for you to finish signing in…';
  } catch (error) {
    $('#microsoft-login-status').textContent = `Still waiting… ${error.message}`;
  }
  state.microsoftLoginTimer = window.setTimeout(() => pollMicrosoftLogin(intervalSeconds), intervalSeconds * 1000);
}

// Skin manager and pixel-perfect 2D player preview
function setSkinStatus(message, level = '') {
  const target = $('#skin-status');
  target.textContent = message;
  target.className = `skin-status${level ? ` ${level}` : ''}`;
}

function resetSkinManager() {
  state.skinImageData = '';
  state.skinSourceUrl = '';
  $('#skin-file').value = '';
  $('#skin-url').value = '';
  $('#skin-apply').disabled = true;
  $('#skin-preview').style.display = 'none';
  $('#skin-preview-empty').style.display = 'block';
  $('#skin-preview-size').textContent = 'No skin selected';
  $('#skin-preview-source').textContent = '64×64 or legacy 64×32 PNG';
  setSkinStatus('Skin changes are sent only to the official Minecraft profile service.');
}

function showSkinManager(account) {
  if (account.type !== 'microsoft') {
    notify('Sign in with Microsoft to publish a skin.', 'error');
    return;
  }
  state.skinAccountId = account.id;
  resetSkinManager();
  $('#skin-account-name').textContent = account.username;
  $('#skin-variant').value = String(account.skinVariant || 'classic').toLowerCase() === 'slim' ? 'slim' : 'classic';
  $('#skin-modal').style.display = 'flex';
  if (account.skinUrl) {
    api('/api/skins/preview', { method: 'POST', body: { sourceUrl: account.skinUrl.replace(/^http:\/\/textures\.minecraft\.net/i, 'https://textures.minecraft.net') } })
      .then((preview) => renderSkinPreview(preview.dataUrl, 'Current Minecraft skin', preview.metadata, false))
      .catch(() => {});
  }
}

function hideSkinManager() {
  $('#skin-modal').style.display = 'none';
  state.skinAccountId = null;
  state.skinImageData = '';
  state.skinSourceUrl = '';
}

function skinPart(context, image, source, destination) {
  context.drawImage(image, source[0], source[1], source[2], source[3], destination[0], destination[1], destination[2], destination[3]);
}

function renderSkinPreview(dataUrl, sourceLabel, metadata = {}, canApply = true) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.width !== 64 || ![32, 64].includes(image.height)) {
        reject(new Error(`Minecraft Java skins must be 64×64 or legacy 64×32 PNG files (received ${image.width}×${image.height}).`));
        return;
      }
      const canvas = $('#skin-preview');
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      const scale = 8;
      const slim = $('#skin-variant').value === 'slim';
      const armWidth = slim ? 3 : 4;
      const leftArmX = slim ? 1 : 0;
      const rightArmX = 12;
      const modern = image.height === 64;
      const draw = (source, destination) => skinPart(
        context,
        image,
        source,
        destination.map((value) => value * scale)
      );

      // Base layer: head, body, arms and legs.
      draw([8, 8, 8, 8], [4, 0, 8, 8]);
      draw([20, 20, 8, 12], [4, 8, 8, 12]);
      draw([44, 20, armWidth, 12], [leftArmX, 8, armWidth, 12]);
      draw(modern ? [36, 52, armWidth, 12] : [44, 20, armWidth, 12], [rightArmX, 8, armWidth, 12]);
      draw([4, 20, 4, 12], [4, 20, 4, 12]);
      draw(modern ? [20, 52, 4, 12] : [4, 20, 4, 12], [8, 20, 4, 12]);

      // Outer layer (hat, jacket, sleeves and trousers).
      draw([40, 8, 8, 8], [4, 0, 8, 8]);
      if (modern) {
        draw([20, 36, 8, 12], [4, 8, 8, 12]);
        draw([44, 36, armWidth, 12], [leftArmX, 8, armWidth, 12]);
        draw([52, 52, armWidth, 12], [rightArmX, 8, armWidth, 12]);
        draw([4, 36, 4, 12], [4, 20, 4, 12]);
        draw([4, 52, 4, 12], [8, 20, 4, 12]);
      }

      canvas.style.display = 'block';
      $('#skin-preview-empty').style.display = 'none';
      $('#skin-preview-size').textContent = `${image.width}×${image.height} · ${slim ? 'Slim' : 'Classic'}`;
      $('#skin-preview-source').textContent = sourceLabel;
      $('#skin-apply').disabled = !canApply;
      if (canApply) state.skinImageData = dataUrl;
      resolve({ width: image.width, height: image.height, ...metadata });
    };
    image.onerror = () => reject(new Error('The selected file could not be decoded as a PNG skin.'));
    image.src = dataUrl;
  });
}

async function previewSkinFile(file) {
  if (!file) return;
  if (file.size > 512 * 1024) throw new Error('Skin PNG is larger than 512 KB.');
  let dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected skin file.'));
    reader.readAsDataURL(file);
  });
  dataUrl = String(dataUrl).replace(/^data:[^;]*;base64,/, 'data:image/png;base64,');
  state.skinSourceUrl = '';
  await renderSkinPreview(dataUrl, file.name, {}, true);
  setSkinStatus('Preview ready. Choose the correct arm model, then apply it.', 'success');
}

async function previewSkinUrl() {
  const sourceUrl = $('#skin-url').value.trim();
  if (!sourceUrl) throw new Error('Paste a direct skin PNG URL or a NameMC / Skindex skin page URL.');
  const button = $('#skin-url-preview');
  button.disabled = true;
  setSkinStatus('Downloading and validating skin…');
  try {
    const preview = await api('/api/skins/preview', { method: 'POST', body: { sourceUrl } });
    state.skinSourceUrl = preview.sourceUrl || sourceUrl;
    await renderSkinPreview(preview.dataUrl, new URL(state.skinSourceUrl).hostname, preview.metadata, true);
    setSkinStatus('Preview ready. Choose the correct arm model, then apply it.', 'success');
  } finally {
    button.disabled = false;
  }
}

async function applySelectedSkin() {
  if (!state.skinAccountId || !state.skinImageData) throw new Error('Choose and preview a skin first.');
  const button = $('#skin-apply');
  button.disabled = true;
  setSkinStatus('Uploading skin to the official Minecraft profile service…');
  try {
    const result = await api(`/api/accounts/${encodeURIComponent(state.skinAccountId)}/skin`, {
      method: 'POST',
      body: { imageData: state.skinImageData, variant: $('#skin-variant').value }
    });
    await loadAccounts();
    setSkinStatus('Skin applied. Minecraft may take a moment to refresh it in-game.', 'success');
    notify(`Skin updated for ${result.account?.username || 'your account'}.`);
  } catch (error) {
    setSkinStatus(error.message, 'error');
    throw error;
  } finally {
    button.disabled = false;
  }
}

// Versions
async function loadVersions() {
  const data = await api('/api/versions');
  state.versions = data.versions || [];
  renderVersionSelect();
  renderVersionList();
  populateMcSelect();
  const count = $('#versions-count');
  if (count) count.textContent = state.versions.length;
  await refreshLoaderVersions(state.settings?.loaderVersion || '');
  log(`Loaded ${state.versions.length} official versions from Mojang.`);
}

async function loadInstalledVersions() {
  try {
    const { versions } = await api('/api/versions/installed');
    state.installedVersions = versions || [];
    log(`Found ${state.installedVersions.length} installed versions.`);
  } catch (error) {
    state.installedVersions = [];
    log(`Could not load installed versions: ${error.message}`, 'error');
  }
}

function isVersionInstalled(versionId) {
  return state.installedVersions.some((v) => v.id === versionId);
}

function renderVersionSelect() {
  const select = $('#ql-version');
  if (!select) return;
  select.innerHTML = '<option value="">Select a version…</option>';
  // Quick Launch only shows installed versions
  const installed = state.versions.filter((v) => isVersionInstalled(v.id));
  for (const version of installed) {
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
  updateDetailInstallButton(id).catch(reportError);
  refreshLoaderVersions().catch(reportError);
}

async function updateDetailInstallButton(versionId) {
  const installBtn = $('#detail-install');
  const uninstallBtn = $('#detail-uninstall');
  if (!installBtn) return;
  // Use the loader-aware backend check so switching loaders correctly reflects
  // whether the version with the currently selected loader is actually installed.
  const check = await checkInstalled(versionId);
  const installed = check.installed;
  installBtn.innerHTML = installed
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 6 5-6 5V3Z"/></svg><span>Play</span>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 6 5-6 5V3Z"/></svg><span>Install &amp; play</span>';
  // Show/hide uninstall button
  if (uninstallBtn) {
    uninstallBtn.style.display = installed ? 'inline-flex' : 'none';
  }
}

function populateMcSelect() {
  const sel = $('#mp-new-mc');
  if (!sel) return;
  if (sel.options.length > 1) return;
  for (const v of state.versions.slice(0, 300)) {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.id;
    sel.append(o);
  }
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
  } catch { return '#'; }
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

// ── Drive selection ─────────────────────────────────────────────────
async function showDriveModal() {
  const modal = $('#drive-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const list = $('#drive-list');
  if (list) list.innerHTML = '<span class="muted">Loading drives…</span>';
  try {
    const { drives } = await api('/api/drives');
    if (!list) return;
    list.innerHTML = '';
    if (!drives.length) {
      list.innerHTML = '<span class="muted">No drives detected.</span>';
      return;
    }
    const currentDir = state.settings?.gameDir || '';
    for (const drive of drives) {
      const isCurrent = currentDir.startsWith(drive.path) || (drive.isDefault && !currentDir);
      const item = document.createElement('div');
      item.className = `drive-item${isCurrent ? ' current' : ''}`;
      item.innerHTML = `
        <div class="drive-item-icon">💾</div>
        <div class="drive-item-info">
          <span class="drive-item-label">${escapeHtml(drive.label)}</span>
          <span class="drive-item-path">${escapeHtml(drive.path)}</span>
          <span class="drive-item-space">${drive.freeFormatted} free / ${drive.totalFormatted} total</span>
        </div>
        <div class="drive-item-actions">
          ${isCurrent ? '<span class="drive-current-badge">Current</span>' : '<button class="button primary" style="min-height:31px; font-size:.68rem">Select</button>'}
        </div>`;
      const selectBtn = item.querySelector('.button.primary');
      if (selectBtn) {
        selectBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await setGameDirectory(drive.path);
        });
      }
      if (!isCurrent) {
        item.addEventListener('click', () => setGameDirectory(drive.path));
      }
      list.append(item);
    }
  } catch (error) {
    if (list) list.innerHTML = `<span class="muted">${escapeHtml(error.message)}</span>`;
  }
}

function hideDriveModal() {
  const modal = $('#drive-modal');
  if (modal) modal.style.display = 'none';
}

async function setGameDirectory(newDir) {
  const separator = newDir.includes('\\') ? '\\' : '/';
  const gameDir = newDir.endsWith(separator) ? newDir + 'amethyst' : newDir + separator + 'amethyst';
  try {
    const { settings } = await api('/api/settings', { method: 'POST', body: { ...state.settings, gameDir } });
    state.settings = settings;
    const gameDirectory = $('#settings-game-dir');
    if (gameDirectory) gameDirectory.textContent = settings.gameDir || '—';
    const dataDirectory = $('#settings-data-dir');
    if (dataDirectory) dataDirectory.textContent = settings.gameDir || '—';
    if ($('#detail-dir')) $('#detail-dir').textContent = settings.gameDir || '—';
    hideDriveModal();
    log(`Game directory set to: ${settings.gameDir}`);
    notify(`Game files will download to: ${settings.gameDir}`);
  } catch (error) {
    reportError(error);
  }
}

// ── Check installed ────────────────────────────────────────────────
async function checkInstalled(versionId) {
  try {
    const result = await api('/api/check-installed', {
      method: 'POST',
      body: {
        versionId,
        gameDir: state.settings?.gameDir,
        loaderType: selectedLoaderType(),
        loaderVersion: selectedLoaderVersion(),
      },
    });
    return result;
  } catch {
    return { installed: false };
  }
}

// ── Modpacks ───────────────────────────────────────────────────────
async function loadModpacks() {
  try {
    const { modpacks } = await api('/api/modpacks');
    state.modpacks = modpacks || [];
    renderModpacks();
  } catch (e) {
    log('Modpacks failed: '+e.message);
  }
}

function renderModpacks() {
  const container = $('#modpack-list');
  const countEl = $('#modpacks-count');
  if (countEl) countEl.textContent = state.modpacks.length;
  if (!container) return;
  container.innerHTML = '';
  if (!state.modpacks.length) {
    container.innerHTML = '<div class="account-empty"><div class="empty-glyph">◫</div><strong>No modpacks yet</strong><p>Create your first pack.</p></div>';
    return;
  }
  for (const mp of state.modpacks) {
    const item = document.createElement('div');
    item.className = `version-item${mp.id === state.selectedModpackId ? ' selected' : ''}`;
    const typeClass = mp.loader || 'vanilla';
    item.innerHTML = `<span class="version-dot ${typeClass}"></span><div><div class="version-name">${escapeHtml(mp.name)}</div><div class="version-type">${escapeHtml(mp.minecraftVersion)} · ${escapeHtml(mp.loader)}${mp.loaderVersion ? ' '+escapeHtml(mp.loaderVersion) : ''}</div></div>`;
    item.addEventListener('click', () => selectModpack(mp.id));
    container.append(item);
  }
}

async function selectModpack(id) {
  state.selectedModpackId = id;
  renderModpacks();
  const mp = state.modpacks.find(m => m.id === id) || await api(`/api/modpacks/${encodeURIComponent(id)}`).then(d=>d.modpack).catch(()=>null);
  if (!mp) return;
  showModpackDetail(mp);
}

function showModpackDetail(mp) {
  const empty = $('#modpack-empty');
  const content = $('#modpack-content');
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'flex';
  $('#mp-name').textContent = mp.name;
  $('#mp-sub').textContent = `${mp.minecraftVersion} • created ${formatDate(mp.createdAt)}`;
  const descEl = $('#mp-description');
  if (descEl) descEl.textContent = mp.description || 'No description yet.';
  $('#mp-badge-loader').textContent = mp.loader;
  $('#mp-badge-loader').className = `detail-badge ${mp.loader}`;
  $('#mp-badge-mc').textContent = mp.minecraftVersion;
  $('#mp-set-name').textContent = mp.name;
  $('#mp-set-mc').textContent = mp.minecraftVersion;
  $('#mp-set-loader').textContent = mp.loader;
  $('#mp-set-loader-ver').textContent = mp.loaderVersion || 'latest';
  $('#mp-set-dir').textContent = mp.gameDir || '—';
  $('#mp-set-mods-dir').textContent = mp.modsDir || (mp.gameDir ? `${mp.gameDir.replace(/[\\/]$/, '')}/mods` : '—');
  $('#mp-set-custom').textContent = mp.customVersionId || 'not installed';
  loadModpackMods(mp.id);
  loadModpackShaders(mp.id);
  loadModpackResourcePacks(mp.id);
}

async function loadModpackMods(id) {
  const listEl = $('#mp-mods-list');
  if (!listEl) return;
  listEl.innerHTML = '<span class="muted">Loading mods…</span>';
  try {
    const { mods } = await api(`/api/modpacks/${encodeURIComponent(id)}/mods`);
    listEl.innerHTML = '';
    if (!mods.length) {
      listEl.innerHTML = '<div class="account-empty" style="min-height:120px"><div class="empty-glyph">◫</div><strong>No mods yet</strong><p>Use the Modrinth selector on the left or Add .jar for local creator builds.</p></div>';
      return;
    }
    for (const m of mods) {
      const row = document.createElement('div');
      row.className = 'mod-installed';
      row.innerHTML = `<div style="flex:1; min-width:0"><div style="font-weight:600; font-size:.82rem">${escapeHtml(m.title||m.fileName)}</div><div class="muted" style="font-family:monospace; font-size:.68rem">${escapeHtml(m.fileName)} • ${escapeHtml(m.source)}${m.installed === false ? ' • MISSING FROM MODS FOLDER' : ''}</div></div><button class="button button-quiet" data-remove>Remove</button>`;
      row.querySelector('[data-remove]').addEventListener('click', async () => {
        if (!confirm(`Remove ${m.fileName}?`)) return;
        await api(`/api/modpacks/${encodeURIComponent(id)}/mods/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        loadModpackMods(id);
      });
      listEl.append(row);
    }
  } catch (e) {
    listEl.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  }
}

async function loadModpackShaders(id) {
  const listEl = $('#mp-shaders-list');
  if (!listEl) return;
  listEl.innerHTML = '<span class="muted">Loading shader packs…</span>';
  try {
    const { shaders } = await api(`/api/modpacks/${encodeURIComponent(id)}/shaderpacks`);
    listEl.innerHTML = '';
    if (!shaders.length) {
      listEl.innerHTML = '<div class="account-empty" style="min-height:120px"><div class="empty-glyph">◌</div><strong>No shader packs yet</strong><p>Search Shader packs on the left and install one into this pack.</p></div>';
      return;
    }
    for (const shader of shaders) {
      const row = document.createElement('div');
      row.className = 'mod-installed';
      row.innerHTML = `<div style="flex:1; min-width:0"><div style="font-weight:600; font-size:.82rem">${escapeHtml(shader.title || shader.fileName)}</div><div class="muted" style="font-family:monospace; font-size:.68rem">${escapeHtml(shader.fileName)} • ${formatBytes(shader.sizeOnDisk || shader.size || 0)}${shader.installed === false ? ' • MISSING' : ''}</div></div><button class="button button-quiet" data-remove>Remove</button>`;
      row.querySelector('[data-remove]').addEventListener('click', async () => {
        if (!confirm(`Remove ${shader.fileName}?`)) return;
        await api(`/api/modpacks/${encodeURIComponent(id)}/shaderpacks/${encodeURIComponent(shader.id || shader.fileName)}`, { method: 'DELETE' });
        loadModpackShaders(id);
      });
      listEl.append(row);
    }
  } catch (e) {
    listEl.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  }
}

async function loadModpackResourcePacks(id) {
  const listEl = $('#mp-resourcepacks-list');
  if (!listEl) return;
  listEl.innerHTML = '<span class="muted">Loading resource packs…</span>';
  try {
    const { resourcepacks } = await api(`/api/modpacks/${encodeURIComponent(id)}/resourcepacks`);
    listEl.innerHTML = '';
    if (!resourcepacks.length) {
      listEl.innerHTML = '<div class="account-empty" style="min-height:120px"><div class="empty-glyph">🎨</div><strong>No resource packs yet</strong><p>Search Resource packs on the left and install one into this pack.</p></div>';
      return;
    }
    for (const rp of resourcepacks) {
      const row = document.createElement('div');
      row.className = 'mod-installed';
      row.innerHTML = `<div style="flex:1; min-width:0"><div style="font-weight:600; font-size:.82rem">${escapeHtml(rp.title || rp.fileName)}</div><div class="muted" style="font-family:monospace; font-size:.68rem">${escapeHtml(rp.fileName)} • ${formatBytes(rp.sizeOnDisk || rp.size || 0)}${rp.installed === false ? ' • MISSING' : ''}</div></div><button class="button button-quiet" data-remove>Remove</button>`;
      row.querySelector('[data-remove]').addEventListener('click', async () => {
        if (!confirm(`Remove ${rp.fileName}?`)) return;
        await api(`/api/modpacks/${encodeURIComponent(id)}/resourcepacks/${encodeURIComponent(rp.id || rp.fileName)}`, { method: 'DELETE' });
        loadModpackResourcePacks(id);
      });
      listEl.append(row);
    }
  } catch (e) {
    listEl.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  }
}

function showModpackModal() { const el = $('#modpack-modal'); if (el) el.style.display = 'flex'; }
function hideModpackModal() { const el = $('#modpack-modal'); if (el) el.style.display = 'none'; }

async function refreshModpackLoaderVersions() {
  const loader = $('#mp-new-loader')?.value || 'fabric';
  const mc = $('#mp-new-mc')?.value || '';
  const sel = $('#mp-new-loader-ver');
  const wrap = $('#mp-new-loader-ver-wrap');
  if (!sel || !wrap) return;
  if (loader === 'vanilla') { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  sel.innerHTML = '<option value="">Loading…</option>';
  if (!mc) { sel.innerHTML = '<option value="">Select MC version first</option>'; return; }
  try {
    const data = await api(`/api/loaders/versions?loader=${encodeURIComponent(loader)}&gameVersion=${encodeURIComponent(mc)}`);
    const vers = data.versions || [];
    sel.innerHTML = '<option value="">Latest</option>';
    for (const v of vers.slice(0, 50)) {
      const id = v.version || v.forgeVersion || v.neoForgeVersion || v.id || '';
      const o = document.createElement('option');
      o.value = id;
      o.textContent = id;
      sel.append(o);
    }
    if (!vers.length) sel.innerHTML = '<option value="">No versions (latest)</option>';
  } catch (e) {
    sel.innerHTML = `<option value="">Error: ${escapeHtml(e.message)}</option>`;
  }
}

async function installModFile(packId, body, button, resultContainer) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Installing…';
  const mp = selectedModpack();
  try {
    const { mod, dependenciesInstalled = 0 } = await api(`/api/modpacks/${encodeURIComponent(packId)}/mods`, { method:'POST', body: { ...body, gameVersion: mp?.minecraftVersion, loader: mp?.loader } });
    await loadModpackMods(packId);
    if (resultContainer) resultContainer.innerHTML = `<span style="color:var(--green)">Installed ${escapeHtml(mod.fileName)}${dependenciesInstalled ? ` with ${dependenciesInstalled} dependenc${dependenciesInstalled === 1 ? 'y' : 'ies'}` : ''}.</span>`;
    notify(`${mod.title || mod.fileName} installed${dependenciesInstalled ? ` + ${dependenciesInstalled} dependencies` : ''}.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    notify(error.message, 'error');
    if (isNoSpaceError(error)) showCleanupModal();
    throw error;
  }
}

async function doModSearch(options = {}) {
  const query = $('#mp-search')?.value.trim() || '';
  const projectType = $('#mp-project-type')?.value || 'mod';
  const mp = selectedModpack();
  const resultsEl = $('#mp-browse-results');
  const infoEl = $('#mp-browse-info');
  const paginationEl = $('#mp-browse-pagination');
  if (!resultsEl) return;

  if ((projectType === 'mod' || projectType === 'shader' || projectType === 'resourcepack') && !mp) {
    notify('Select a modpack before installing mods, resource packs, or shader packs.', 'error');
  }

  if (typeof options.page === 'number') {
    state.modSearchPage = Math.max(1, options.page);
  } else if (query !== state.modSearchQuery || projectType !== state.modSearchType || options.resetPage) {
    state.modSearchPage = 1;
  }
  state.modSearchQuery = query;
  state.modSearchType = projectType;

  const limit = 20;
  const offset = (state.modSearchPage - 1) * limit;

  resultsEl.innerHTML = '<span class="muted">Searching Modrinth…</span>';
  if (infoEl) infoEl.textContent = '';
  if (paginationEl) paginationEl.style.display = 'none';

  try {
    const loader = (projectType === 'mod' || projectType === 'modpack') && mp?.loader && mp.loader !== 'vanilla' ? mp.loader : '';
    const gameVersion = (projectType === 'mod' || projectType === 'shader' || projectType === 'resourcepack' || projectType === 'modpack') ? (mp?.minecraftVersion || '') : '';
    const params = new URLSearchParams({ q: query, loader: loader || '', gameVersion, limit: String(limit), offset: String(offset), projectType });
    const data = await api(`/api/modrinth/search?${params.toString()}`);
    const hits = data.hits || [];
    const totalHits = Number(data.total_hits || hits.length || 0);
    state.modSearchTotalHits = totalHits;

    resultsEl.innerHTML = '';
    if (!hits.length) {
      resultsEl.innerHTML = '<div class="muted">No Modrinth results found.</div>';
      renderModSearchPagination(0, limit);
      return;
    }
    for (const hit of hits) renderModrinthHit(hit, projectType, resultsEl);
    resultsEl.scrollTop = 0;
    const typeLabel = projectType === 'shader' ? 'shader pack' : projectType === 'resourcepack' ? 'resource pack' : projectType;
    if (infoEl) {
      const startItem = offset + 1;
      const endItem = Math.min(offset + hits.length, totalHits);
      infoEl.textContent = `${totalHits.toLocaleString()} Modrinth ${typeLabel} results (showing ${startItem}-${endItem})`;
    }
    renderModSearchPagination(totalHits, limit);
  } catch (e) {
    resultsEl.innerHTML = `<span style="color:var(--red)">${escapeHtml(e.message)}</span>`;
    if (paginationEl) paginationEl.style.display = 'none';
  }
}

function renderModSearchPagination(totalHits, limit) {
  const paginationEl = $('#mp-browse-pagination');
  if (!paginationEl) return;
  const totalPages = Math.ceil(totalHits / limit) || 1;
  if (totalPages <= 1) {
    paginationEl.style.display = 'none';
    paginationEl.innerHTML = '';
    return;
  }
  paginationEl.style.display = 'flex';
  
  const currentPage = state.modSearchPage;
  
  const pages = [];
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  for (let p = startPage; p <= endPage; p++) {
    pages.push(p);
  }

  let pagesHtml = '';
  if (startPage > 1) {
    pagesHtml += `<button class="button button-quiet page-btn" data-page="1">1</button>`;
    if (startPage > 2) pagesHtml += `<span class="muted" style="padding:0 4px">…</span>`;
  }
  for (const p of pages) {
    if (p === currentPage) {
      pagesHtml += `<button class="button primary page-btn active" data-page="${p}" disabled style="cursor:default">${p}</button>`;
    } else {
      pagesHtml += `<button class="button button-quiet page-btn" data-page="${p}">${p}</button>`;
    }
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) pagesHtml += `<span class="muted" style="padding:0 4px">…</span>`;
    pagesHtml += `<button class="button button-quiet page-btn" data-page="${totalPages}">${totalPages}</button>`;
  }

  paginationEl.innerHTML = `
    <div class="pagination-info" style="font-size:.78rem">Page <strong>${currentPage}</strong> of <strong>${totalPages.toLocaleString()}</strong></div>
    <div class="pagination-controls" style="display:flex; align-items:center; gap:4px">
      <button class="button button-quiet" id="mp-page-prev" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
      ${pagesHtml}
      <button class="button button-quiet" id="mp-page-next" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
    </div>
  `;

  paginationEl.querySelector('#mp-page-prev')?.addEventListener('click', () => {
    if (state.modSearchPage > 1) doModSearch({ page: state.modSearchPage - 1 });
  });
  paginationEl.querySelector('#mp-page-next')?.addEventListener('click', () => {
    if (state.modSearchPage < totalPages) doModSearch({ page: state.modSearchPage + 1 });
  });
  paginationEl.querySelectorAll('.page-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const pageNum = Number(btn.dataset.page);
      if (pageNum && pageNum !== state.modSearchPage) {
        doModSearch({ page: pageNum });
      }
    });
  });
}

function renderModrinthHit(hit, projectType, resultsEl) {
  const div = document.createElement('div');
  div.className = 'mod-item';
  const icon = hit.icon_url ? `<img class="mod-item-icon" src="${escapeHtml(hit.icon_url)}" alt="">` : '<div class="mod-item-icon"></div>';
  const created = hit.date_created || hit.published;
  const updated = hit.date_modified || hit.updated;
  div.innerHTML = `${icon}<div class="mod-item-body"><div class="mod-item-head"><div><div class="mod-item-title">${escapeHtml(hit.title)}</div><div class="mod-item-meta">By ${escapeHtml(hit.author || 'Unknown creator')} • Created ${formatDate(created)}${updated ? ` • Updated ${formatDate(updated)}` : ''} • ${Number(hit.downloads || 0).toLocaleString()} downloads</div></div><button class="button button-quiet" data-details>Details</button></div><div class="mod-item-summary">${escapeHtml(hit.description || '')}</div><div class="mod-project-details"><div class="muted">Loading details…</div></div></div>`;
  const details = div.querySelector('.mod-project-details');
  const button = div.querySelector('[data-details]');
  button.addEventListener('click', async () => {
    if (details.classList.contains('open')) { details.classList.remove('open'); return; }
    details.classList.add('open');
    await loadModrinthDetails(hit, projectType, details);
  });
  resultsEl.append(div);
}

async function loadModrinthDetails(hit, projectType, detailsEl) {
  detailsEl.innerHTML = '<span class="muted">Loading description and versions…</span>';
  try {
    const [project, versionsData] = await Promise.all([
      api(`/api/modrinth/project/${encodeURIComponent(hit.project_id)}`),
      loadCompatibleVersions(hit.project_id, projectType)
    ]);
    const versions = versionsData.versions || [];
    const author = hit.author || project.team || 'Unknown creator';
    detailsEl.innerHTML = `<div class="mod-item-meta"><strong>Creator:</strong> ${escapeHtml(author)} • <strong>Created:</strong> ${formatDate(project.published || hit.date_created)} • <strong>Project:</strong> ${escapeHtml(project.project_type || projectType)}</div><div class="mod-description">${renderMarkdownSafe(project.body || hit.description || '')}</div><div><span class="section-eyebrow">COMPATIBLE DOWNLOADS</span><div class="mod-version-list"></div></div>`;
    const list = detailsEl.querySelector('.mod-version-list');
    if (!versions.length) {
      list.innerHTML = '<span class="muted">No compatible files found for the selected pack/version.</span>';
      return;
    }
    for (const ver of versions.slice(0, 12)) {
      renderModrinthVersionRow(hit, ver, projectType, list);
    }
  } catch (error) {
    detailsEl.innerHTML = `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`;
  }
}

async function loadCompatibleVersions(projectId, projectType) {
  const mp = selectedModpack();
  const params = new URLSearchParams();
  if ((projectType === 'mod' || projectType === 'modpack') && mp?.loader && mp.loader !== 'vanilla') params.set('loader', mp.loader);
  if ((projectType === 'mod' || projectType === 'shader' || projectType === 'resourcepack' || projectType === 'modpack') && mp?.minecraftVersion) params.set('gameVersion', mp.minecraftVersion);
  return api(`/api/modrinth/project/${encodeURIComponent(projectId)}/versions?${params.toString()}`);
}

function renderModrinthVersionRow(hit, ver, projectType, list) {
  const file = ver.files?.find(f => f.primary) || ver.files?.[0];
  if (!file) return;
  const row = document.createElement('div');
  row.className = 'mod-ver';
  const required = (ver.dependencies || []).filter(dep => dep.dependency_type === 'required').length;
  let label = 'Install';
  if (projectType === 'modpack') label = 'Install pack';
  if (projectType === 'shader') label = 'Install shader';
  if (projectType === 'resourcepack') label = 'Install resource pack';
  row.innerHTML = `<div><div class="mod-ver-name">${escapeHtml(ver.version_number)} — ${escapeHtml(ver.name || '')}</div><div class="muted" style="font-size:.6rem">${escapeHtml((ver.loaders || []).join(', ') || 'any loader')} · ${escapeHtml((ver.game_versions || []).join(', ').slice(0, 90))} · ${formatBytes(file.size || 0)}</div>${required ? `<div class="mod-dependency-note">${required} required dependenc${required === 1 ? 'y' : 'ies'} will auto-install</div>` : ''}</div><button class="button primary" style="min-height:28px; font-size:.68rem">${label}</button>`;
  row.querySelector('button').addEventListener('click', async (event) => {
    if (projectType === 'mod') {
      const mpId = state.selectedModpackId;
      if (!mpId) { notify('Select a modpack first', 'error'); return; }
      const body = { source:'modrinth', projectId:hit.project_id, projectSlug:hit.slug || hit.project_id, title:hit.title, versionId:ver.id, fileName:file.filename, fileUrl:file.url, size:file.size, autoInstallDependencies:true };
      await installModFile(mpId, body, event.currentTarget, list).catch((error) => {
        list.insertAdjacentHTML('beforeend', `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`);
      });
    } else if (projectType === 'shader') {
      await installShaderPack(hit, ver, file, event.currentTarget, list).catch((error) => {
        list.insertAdjacentHTML('beforeend', `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`);
      });
    } else if (projectType === 'resourcepack') {
      await installResourcePack(hit, ver, file, event.currentTarget, list).catch((error) => {
        list.insertAdjacentHTML('beforeend', `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`);
      });
    } else {
      await installModrinthModpack(hit, ver, event.currentTarget).catch((error) => {
        list.insertAdjacentHTML('beforeend', `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`);
      });
    }
  });
  list.append(row);
}

async function installResourcePack(hit, ver, file, button, resultContainer) {
  const mpId = state.selectedModpackId;
  if (!mpId) { notify('Select a modpack first', 'error'); return; }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Installing…';
  try {
    const body = { source:'modrinth', projectId:hit.project_id, projectSlug:hit.slug || hit.project_id, title:hit.title, versionId:ver.id, fileName:file.filename, fileUrl:file.url, size:file.size };
    const { resourcepack } = await api(`/api/modpacks/${encodeURIComponent(mpId)}/resourcepacks`, { method:'POST', body });
    await loadModpackResourcePacks(mpId);
    resultContainer.innerHTML = `<span style="color:var(--green)">Installed resource pack ${escapeHtml(resourcepack.fileName)}.</span>`;
    notify(`${resourcepack.title || resourcepack.fileName} installed.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    if (isNoSpaceError(error)) showCleanupModal();
    throw error;
  }
}

async function installShaderPack(hit, ver, file, button, resultContainer) {
  const mpId = state.selectedModpackId;
  if (!mpId) { notify('Select a modpack first', 'error'); return; }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Installing…';
  try {
    const body = { source:'modrinth', projectId:hit.project_id, projectSlug:hit.slug || hit.project_id, title:hit.title, versionId:ver.id, fileName:file.filename, fileUrl:file.url, size:file.size };
    const { shader } = await api(`/api/modpacks/${encodeURIComponent(mpId)}/shaderpacks`, { method:'POST', body });
    await loadModpackShaders(mpId);
    resultContainer.innerHTML = `<span style="color:var(--green)">Installed shader pack ${escapeHtml(shader.fileName)}.</span>`;
    notify(`${shader.title || shader.fileName} installed.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    if (isNoSpaceError(error)) showCleanupModal();
    throw error;
  }
}

async function installModrinthModpack(hit, ver, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const { modpack } = await api('/api/modpacks/import-modrinth', { method:'POST', body:{ projectId: hit.project_id, versionId: ver.id } });
    await loadModpacks();
    selectModpack(modpack.id);
    notify(`Imported ${modpack.name}.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    if (isNoSpaceError(error)) showCleanupModal();
    throw error;
  }
}

// Live game session
function appendGameConsole(message, stream = 'stdout') {
  const consoleEl = $('#game-console');
  if (!consoleEl || !message) return;
  const prefix = stream === 'stderr' ? '[ERR] ' : '';
  consoleEl.textContent = `${consoleEl.textContent}${prefix}${String(message).replace(/\r/g, '')}`.slice(-100000);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function formatElapsed(milliseconds = 0) {
  const total = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function resetRuntimeMetrics() {
  $('#runtime-cpu').textContent = '0.0%';
  $('#runtime-ram').textContent = '0 MB';
  $('#runtime-pid').textContent = 'Starting…';
  $('#runtime-elapsed').textContent = '00:00:00';
  $('#runtime-cpu-bar').style.width = '0%';
  $('#runtime-ram-bar').style.width = '0%';
}

function showRuntimeLoading(versionId = '') {
  state.gameLoading = true;
  state.gameRunning = false;
  state.startupLogCount = 0;
  $('#runtime-card').hidden = false;
  $('#runtime-title').textContent = `Loading Minecraft${versionId ? ` ${versionId}` : ''}…`;
  $('#runtime-detail').textContent = 'Java started. Waiting for Minecraft to finish loading…';
  $('#runtime-state').className = 'runtime-state loading';
  $('#runtime-state').innerHTML = '<i></i><span>Starting</span>';
  $('#game-console-wrap').hidden = true;
  $('#game-console').textContent = '';
  resetRuntimeMetrics();
}

function showRuntimeReady(event) {
  state.gameLoading = false;
  state.gameRunning = true;
  $('#runtime-card').hidden = false;
  $('#runtime-title').textContent = `Minecraft ${event.baseVersionId || event.versionId || ''} is running`;
  $('#runtime-detail').textContent = state.startupLogCount
    ? `Session is live. ${state.startupLogCount} startup log${state.startupLogCount === 1 ? '' : 's'} captured below.`
    : 'Session is live. Game logs will appear below.';
  $('#runtime-state').className = 'runtime-state';
  $('#runtime-state').innerHTML = '<i></i><span>Live</span>';
  $('#runtime-pid').textContent = event.pid ? `PID ${event.pid}` : 'Running';
  $('#game-console-wrap').hidden = false;
}

function updateResourceUsage(event) {
  if (!event.running) return;
  const cpu = Math.max(0, Number(event.cpu) || 0);
  const memory = Math.max(0, Number(event.memory) || 0);
  $('#runtime-cpu').textContent = `${cpu.toFixed(1)}%`;
  $('#runtime-ram').textContent = `${(memory / 1024 / 1024).toFixed(0)} MB`;
  $('#runtime-pid').textContent = event.pid ? `PID ${event.pid}` : 'Running';
  $('#runtime-elapsed').textContent = formatElapsed(event.elapsed);
  $('#runtime-cpu-bar').style.width = `${Math.min(100, cpu)}%`;
  $('#runtime-ram-bar').style.width = `${Math.min(100, memory / Math.max(1, state.runtimeMemoryLimit) * 100)}%`;
}

function stopRuntimeUi(message) {
  state.gameLoading = false;
  state.gameRunning = false;
  $('#runtime-title').textContent = message;
  $('#runtime-detail').textContent = 'The most recent game output remains available below.';
  $('#runtime-state').className = 'runtime-state stopped';
  $('#runtime-state').innerHTML = '<i></i><span>Stopped</span>';
  // If the game crashed, show a "View crash report" button on the runtime card
  if (message.toLowerCase().includes('crash') || message.toLowerCase().includes('unexpected')) {
    const existingBtn = $('#runtime-view-crash');
    if (!existingBtn) {
      const metricsEl = document.querySelector('.runtime-metrics');
      if (metricsEl) {
        const btn = document.createElement('button');
        btn.id = 'runtime-view-crash';
        btn.className = 'button button-subtle';
        btn.style.cssText = 'margin-top:14px; width:100%';
        btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM8 5v3.5M8 10.5h.007"/></svg><span>View crash report</span>';
        btn.addEventListener('click', () => {
          if (lastCrashAnalysis) showCrashReport(lastCrashAnalysis);
        });
        metricsEl.after(btn);
      }
    }
  } else {
    // Remove the crash button on normal exit
    $('#runtime-view-crash')?.remove();
  }
}

// ── Crash report modal ────────────────────────────────────────────
let lastCrashAnalysis = null;

function showCrashReport(analysis) {
  lastCrashAnalysis = analysis;

  const modal = $('#crash-modal');
  if (!modal) return;

  modal.style.display = 'flex';

  // Title and version
  $('#crash-modal-title').textContent = 'Minecraft Crashed';
  $('#crash-modal-version').textContent = analysis.versionId
    ? `Minecraft ${analysis.versionId} — exit code ${analysis.exitCode ?? 'unknown'}${analysis.signal ? ` (${analysis.signal})` : ''}`
    : `Exit code ${analysis.exitCode ?? 'unknown'}${analysis.signal ? ` (${analysis.signal})` : ''}`;

  // Severity badge
  const badge = $('#crash-severity-badge');
  const severity = analysis.severity || 'unknown';
  badge.textContent = severity.toUpperCase();
  badge.className = `crash-severity-badge ${severity}`;

  // Summary text
  $('#crash-summary-text').textContent = analysis.summary || 'The game stopped unexpectedly. Check the crash log below for details.';

  // Detected patterns
  const patternsEl = $('#crash-patterns');
  const patternList = $('#crash-pattern-list');
  patternList.innerHTML = '';

  if (analysis.matchedPatterns && analysis.matchedPatterns.length) {
    patternsEl.style.display = 'block';
    for (const pattern of analysis.matchedPatterns) {
      const item = document.createElement('div');
      item.className = 'crash-pattern-item';
      item.innerHTML = `
        <span class="crash-pattern-title">${escapeHtml(pattern.title)}</span>
        <span class="crash-pattern-description">${escapeHtml(pattern.description)}</span>
      `;
      patternList.append(item);
    }
  } else {
    patternsEl.style.display = 'none';
  }

  // Fix suggestions
  const fixList = $('#crash-fix-list');
  fixList.innerHTML = '';
  const fixes = analysis.fixSuggestions || [];
  for (const fix of fixes) {
    const li = document.createElement('li');
    if (typeof fix === 'object' && fix.url) {
      li.innerHTML = `<a href="${escapeHtml(fix.url)}" target="_blank" rel="noreferrer">${escapeHtml(fix.text)}</a>`;
    } else {
      li.textContent = String(fix);
    }
    fixList.append(li);
  }

  // GitHub link
  const githubLink = $('#crash-github-link');
  if (analysis.githubIssueUrl) {
    githubLink.href = analysis.githubIssueUrl;
  } else {
    githubLink.href = 'https://github.com/MinLOL12/Amethyst/issues/new';
  }

  // Exception / crash log
  const exceptionEl = $('#crash-exception');
  if (analysis.exceptionSection) {
    exceptionEl.textContent = analysis.exceptionSection;
  } else if (analysis.rawCrashText) {
    exceptionEl.textContent = analysis.rawCrashText.slice(0, 20000);
  } else if (analysis.stackSummary) {
    exceptionEl.textContent = analysis.stackSummary;
  } else {
    exceptionEl.textContent = 'No detailed crash log available. The game exited without generating a crash report file. Check the launcher console for Java output.';
  }
}

function hideCrashReport() {
  const modal = $('#crash-modal');
  if (modal) modal.style.display = 'none';
}

function copyCrashLog() {
  if (!lastCrashAnalysis) return;
  const text = lastCrashAnalysis.rawCrashText
    || lastCrashAnalysis.exceptionSection
    || lastCrashAnalysis.stackSummary
    || `Minecraft crashed (exit code ${lastCrashAnalysis.exitCode ?? 'unknown'})\n\n${lastCrashAnalysis.summary || ''}`;

  navigator.clipboard?.writeText(text).then(() => {
    notify('Crash log copied to clipboard.');
  }).catch(() => {
    // Fallback: select the exception text
    const el = $('#crash-exception');
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      notify('Crash log selected — press Ctrl+C to copy.');
    }
  });
}

async function loadRuntime() {
  const runtime = await api('/api/runtime');
  if (!runtime.running) return;
  showRuntimeReady(runtime);
  updateResourceUsage(runtime);
  const { lines = [] } = await api('/api/logs?limit=300').catch(() => ({ lines: [] }));
  for (const line of lines.filter(entry => entry.source === 'minecraft')) appendGameConsole(`${line.message}${line.message.endsWith('\n') ? '' : '\n'}`, line.stream);
}

// Status and modal
async function loadStatus() {
  try {
    const data = await api('/api/status');
    $('#app-version').textContent = data.version || '0.1.0';
    $('#about-version').textContent = data.version || '0.1.0';
    $('#settings-data-dir').textContent = data.dataRoot || '—';
    setOnline(true);
  } catch { setOnline(false); }
}

function setOnline(online) {
  $$('.status-dot').forEach((dot) => { dot.className = `status-dot ${online ? 'online' : 'offline'}`; });
  $('#status-text').textContent = online ? 'Connected' : 'Disconnected';
  $('#about-backend-status').textContent = online ? 'Running locally' : 'Disconnected';
  $('#topbar-status').textContent = online ? 'Ready' : 'Backend unavailable';
  
  // If backend comes back online, refresh critical data
  if (online && !state.onlineWasOnline) {
    state.onlineWasOnline = true;
    // Don't auto-refresh immediately to avoid spamming, but mark that we should try
    if (state.pendingRefresh) {
      state.pendingRefresh = false;
      // Refresh versions and accounts after reconnection
      loadVersions().catch(() => {});
      loadAccounts().catch(() => {});
      loadStatus().catch(() => {});
    }
  } else if (!online) {
    state.onlineWasOnline = false;
    state.pendingRefresh = true;
  }
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

function isNoSpaceError(error) {
  const message = (error?.message || String(error || '')).toLowerCase();
  return error?.code === 'ENOSPC' || message.includes('enospc') || message.includes('no space left') || message.includes('not enough space') || message.includes('out of space') || message.includes('disk full');
}

async function showCleanupModal() {
  const modal = $('#cleanup-modal');
  const list = $('#cleanup-list');
  if (!modal || !list) return;
  modal.style.display = 'flex';
  list.innerHTML = '<span class="muted">Scanning installed versions by size…</span>';
  try {
    const { versions } = await api('/api/storage/big-versions');
    if (!versions?.length) {
      list.innerHTML = '<span class="muted">No installed versions were found to remove.</span>';
      return;
    }
    list.innerHTML = '';
    for (const version of versions) {
      const row = document.createElement('div');
      row.className = 'cleanup-item';
      row.innerHTML = `<strong>${escapeHtml(version.id)}</strong><span class="cleanup-size">${formatBytes(version.size)}</span><button class="button button-quiet">Delete</button>`;
      row.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Delete version ${version.id} and free ${formatBytes(version.size)}?`)) return;
        await api(`/api/versions/${encodeURIComponent(version.id)}/uninstall`, { method: 'POST' });
        notify(`Deleted ${version.id}.`);
        showCleanupModal();
        loadInstalledVersions().then(renderVersionSelect).catch(() => {});
      });
      list.append(row);
    }
  } catch (error) {
    list.innerHTML = `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`;
  }
}

function hideCleanupModal() { const el = $('#cleanup-modal'); if (el) el.style.display = 'none'; }

async function addJarToSelectedPack() {
  const mpId = state.selectedModpackId;
  if (!mpId) { notify('Select a modpack first.', 'error'); return; }
  const input = prompt('Paste a full path to a local .jar, or an HTTPS .jar URL to add to this modpack:');
  if (!input) return;
  try {
    const body = input.trim().startsWith('https://') ? { fileUrl: input.trim() } : { filePath: input.trim() };
    const { mod } = await api(`/api/modpacks/${encodeURIComponent(mpId)}/mods/local`, { method: 'POST', body });
    await loadModpackMods(mpId);
    notify(`Added ${mod.fileName}.`);
  } catch (error) { reportError(error); }
}

async function importThirdPartyModpack() {
  const input = prompt('Paste a Modrinth .mrpack HTTPS URL or a full local path to a .mrpack file:');
  if (!input) return;
  try {
    const key = input.trim().startsWith('https://') ? 'sourceUrl' : 'filePath';
    const { modpack } = await api('/api/modpacks/import', { method: 'POST', body: { [key]: input.trim() } });
    await loadModpacks();
    selectModpack(modpack.id);
    navigateTo('modpacks');
    notify(`Imported ${modpack.name}.`);
  } catch (error) { reportError(error); }
}

function reportError(error) {
  if (isNoSpaceError(error)) showCleanupModal();
  let message = error?.message || String(error);
  let type = 'error';
  
  // Enhance error messages for common cases
  if (error?.type === 'NETWORK_ERROR' || message.includes('Failed to fetch') || message.includes('Network error')) {
    message = 'Network error: Unable to connect to the server. Please check if the backend is running and your internet connection is active.';
  } else if (error?.type === 'TIMEOUT_ERROR' || message.includes('timeout') || message.includes('timed out')) {
    message = 'Request timed out. Please check your internet connection and try again.';
  } else if (error?.status === 404) {
    message = 'Resource not found: ' + message;
  } else if (error?.status === 401) {
    message = 'Authentication required: ' + message;
  } else if (error?.status === 429) {
    message = 'Rate limited: Too many requests. Please wait and try again.';
  } else if (error?.status >= 500) {
    message = 'Server error: ' + message + ' (The server may be temporarily unavailable)';
  } else if (message.includes('ECONNREFUSED') || message.includes('Connection refused')) {
    message = 'Connection refused: The backend server is not running or not accessible.';
  } else if (message.includes('ECONNRESET') || message.includes('Connection reset')) {
    message = 'Connection reset: Network instability detected. Please try again.';
  } else if (message.includes('ENOTFOUND') || message.includes('DNS')) {
    message = 'DNS resolution failed: Unable to resolve the server address. Check your internet connection.';
  } else if (message.includes('SSL') || message.includes('TLS') || message.includes('certificate')) {
    message = 'SSL/TLS error: Security certificate issue. This might be a temporary network problem.';
  }
  
  setBusy(false, 'Error');
  log(message, 'error');
  notify(message, type);
}

// Live backend events
function connectEvents() {
  let source = null;
  let reconnectTimer = null;
  
  function setupEventSource() {
    if (source) {
      source.close();
    }
    
    try {
      source = new EventSource('/api/events');
      
      source.onopen = () => {
        state.retryCount = 0;
        log('Event stream connected.');
      };
      
      source.onmessage = async (message) => {
        let event;
        try { event = JSON.parse(message.data); } catch { return; }
        switch (event.type) {
          case 'hello':
            log(`${event.app} event stream connected.`);
            setOnline(true);
            break;
      case 'task-start':
      case 'queue-start':
        setBusy(true, event.name);
        setProgress(0, event.name);
        showModal(event.name, state.pendingVersionId);
        log(`Started: ${event.name}`);
        break;
      case 'task-complete':
      case 'queue-complete':
        setBusy(false, state.gameRunning ? 'Minecraft running' : 'Ready');
        setProgress(100, 'Complete');
        // launch-start already confirmed that Java stayed alive through startup;
        // do not replace that state with the misleading generic "Ready" modal.
        if (!state.gameRunning) {
          updateModal('✓', 'Everything is ready.', true);
          notify(`${event.name} completed.`, 'success');
        }
        // Refresh installed versions after an install task completes
        if (event.name.startsWith('Install ')) {
          await loadInstalledVersions();
          renderVersionSelect();
          if (state.selectedVersionId) updateDetailInstallButton(state.selectedVersionId).catch(reportError);
        }
        log(`Complete: ${event.name}`);
        break;
      case 'task-error':
      case 'queue-error':
        setBusy(false, 'Error');
        updateModal('!', event.message, false, true);
        notify(event.message, 'error');
        if (isNoSpaceError({ message: event.message })) showCleanupModal();
        log(`Error in ${event.name}: ${event.message}`, 'error');
        break;
      case 'queue-progress':
        setProgress(event.percent, event.speedText || `${event.percent}%`);
        $('#modal-status-text').textContent = event.label ? `${event.label}: ${event.percent}%` : `${event.percent}%`;
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
        if (!state.gameLoading) showRuntimeLoading(event.baseVersionId || event.versionId);
        log(`Launching ${event.versionId} with ${event.loaderType && event.loaderType !== 'vanilla' ? `${event.loaderType} ${event.loaderVersion || ''}`.trim() : 'vanilla'} (${event.mainClass || 'Minecraft'}) using ${event.java}`);
        setBusy(true, 'Minecraft loading');
        if ($('#download-modal')?.style.display === 'none') showModal('Loading Minecraft', event.baseVersionId || event.versionId);
        $('#modal-status-text').textContent = 'Java started. Waiting for Minecraft to finish loading…';
        notify(`Minecraft ${event.versionId} is loading.`);
        break;
      case 'launch-ready':
        showRuntimeReady(event);
        setBusy(false, 'Minecraft running');
        hideModal();
        notify(`Minecraft ${event.baseVersionId || event.versionId} is running.`);
        break;
      case 'resource-usage': updateResourceUsage(event); break;
      case 'discord-rpc':
        if (event.connected) updateDiscordPreview('Discord RPC is connected for this Minecraft session.');
        else if (event.message) {
          updateDiscordPreview(`Discord RPC: ${event.message}`);
          log(`Discord RPC: ${event.message}`, 'error');
        }
        break;
      case 'game-log':
        log((event.message || '').trim());
        appendGameConsole(event.message || '', event.stream);
        if (state.gameLoading) {
          state.startupLogCount += 1;
          $('#runtime-detail').textContent = `Minecraft is starting… captured ${state.startupLogCount} startup log${state.startupLogCount === 1 ? '' : 's'}.`;
        }
        break;
      case 'launch-error':
        stopRuntimeUi('Minecraft failed to start');
        setBusy(false, 'Launch failed');
        updateModal('!', event.message || 'Minecraft could not start.', false, true);
        notify(event.message || 'Minecraft could not start.', 'error');
        log(event.message || 'Minecraft could not start.', 'error');
        break;
      case 'launch-exit': {
        const failed = event.code !== 0 || Boolean(event.signal);
        const message = `Minecraft exited with code ${event.code ?? 'n/a'}${event.signal ? ` (${event.signal})` : ''}.`;
        stopRuntimeUi(failed ? 'Minecraft stopped unexpectedly' : 'Minecraft session ended');
        setBusy(false, failed ? 'Launch failed' : 'Ready');
        log(message, failed ? 'error' : 'info');
        appendGameConsole(`\n[Amethyst] ${message}\n`, failed ? 'stderr' : 'stdout');
        if (failed) {
          notify(`${message} Analyzing crash…`, 'error');
          // If the game-crash event doesn't arrive within 5 seconds (e.g. no crash report file),
          // show the fallback crash modal using just the exit code info.
          let crashReceived = false;
          const originalHandler = source.onmessage;
          const quickCheck = (msg) => {
            try {
              const evt = JSON.parse(msg.data);
              if (evt.type === 'game-crash') crashReceived = true;
            } catch (_) {}
          };
          source.addEventListener('message', (e) => quickCheck(e));
          setTimeout(() => {
            if (!crashReceived && failed) {
              // Fallback: show crash report with exit-only analysis
              showCrashReport({
                crashed: true,
                exitCode: event.code,
                signal: event.signal || null,
                versionId: event.versionId || event.baseVersionId || '',
                gameDir: event.gameDir || '',
                severity: 'error',
                matchedPatterns: [],
                summary: event.signal
                  ? `Minecraft was terminated by signal ${event.signal}. This usually means the process was killed externally or crashed due to a system-level error.`
                  : `Minecraft exited with error code ${event.code ?? 'unknown'}. A crash report may have been generated — check the details section below.`,
                exceptionSection: '',
                rawCrashText: '',
                githubIssueUrl: `https://github.com/MinLOL12/Amethyst/issues/new?title=${encodeURIComponent(`[Crash] Unexpected exit (code ${event.code ?? 'unknown'}) — Minecraft ${event.versionId || ''}`)}`,
                fixSuggestions: [
                  'Check the game console output above for Java error messages.',
                  'Try allocating more RAM in the launcher settings.',
                  'Make sure you are using the correct Java version for your Minecraft version.',
                  'If you have mods installed, try removing them and launching vanilla first.',
                  { text: 'Open a GitHub issue for help', url: 'https://github.com/MinLOL12/Amethyst/issues/new' }
                ]
              });
            }
          }, 5000);
        }
        break;
      }
      case 'game-crash': {
        stopRuntimeUi('Minecraft crashed');
        setBusy(false, 'Crash detected');
        const crashMessage = event.summary || 'Minecraft crashed unexpectedly.';
        log(crashMessage, 'error');
        appendGameConsole(`\n[Amethyst] ${crashMessage}\n`, 'stderr');
        showCrashReport(event);
        break;
      }
      default: break;
    }
  };
  
      source.onerror = () => {
        setOnline(false);
        // Try to reconnect
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = RECONNECT_DELAY_MS * reconnectAttempts;
          log(`Event stream disconnected. Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, 'error');
          reconnectTimer = setTimeout(setupEventSource, delay);
        } else {
          log('Event stream reconnection attempts exhausted.', 'error');
        }
      };
    } catch (error) {
      setOnline(false);
      log(`Failed to create EventSource: ${error.message}`, 'error');
      // Try to reconnect
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * reconnectAttempts;
        reconnectTimer = setTimeout(setupEventSource, delay);
      }
    }
  }
  
  // Start the connection
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAY_MS = 3000;
  let reconnectAttempts = 0;
  setupEventSource();
}

function selectedPayload() {
  const loaderType = selectedLoaderType();
  return {
    versionId: $('#ql-version')?.value || state.selectedVersionId || state.settings?.lastVersion || '',
    accountId: state.settings?.lastAccountId || '',
    memoryMb: memoryValue(),
    javaPath: $('#settings-java-path')?.value.trim() || '',
    loaderType,
    // Keep the legacy field for API clients built against the instance loader
    // endpoints; the backend accepts both names.
    loader: loaderType,
    loaderVersion: loaderType === 'vanilla' ? '' : selectedLoaderVersion(),
  };
}

async function doInstall(versionId) {
  const payload = selectedPayload();
  payload.versionId = versionId || payload.versionId;
  if (!payload.versionId) throw new Error('Choose a version first.');
  state.pendingVersionId = payload.versionId;

  // Check if already installed — skip downloads and launch directly
  const check = await checkInstalled(payload.versionId);
  if (check.installed) {
    log(`${payload.versionId} is already installed — launching directly.`);
    setBusy(true, `Launching ${payload.versionId}…`);
    await doLaunch(payload.versionId);
    return;
  }

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
  // Server will check install status and skip downloads if already installed
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
    updateDiscordPreview();
    refreshLoaderVersions().catch(reportError);
  });
  for (const selector of loaderTypeSelectors) {
    $(selector)?.addEventListener('change', async (event) => {
      await selectLoader(event.target.value);
      updateDiscordPreview();
      // Re-evaluate the install/play button with the new loader context
      if (state.selectedVersionId) updateDetailInstallButton(state.selectedVersionId);
    });
  }
  for (const selector of loaderVersionSelectors) {
    $(selector)?.addEventListener('change', async (event) => {
      syncSelectedLoaderVersion(event.target.value);
      // Changing loader version may affect whether the version is installed
      if (state.selectedVersionId) updateDetailInstallButton(state.selectedVersionId);
    });
  }
  $('#ql-launch')?.addEventListener('click', async () => {
    const versionId = $('#ql-version')?.value;
    if (versionId) {
      const check = await checkInstalled(versionId);
      if (check.installed) {
        log(`${versionId} is already installed — launching directly.`);
        setBusy(true, `Launching ${versionId}…`);
      }
    }
    doLaunch().catch(reportError);
  });
  $('#ql-memory')?.addEventListener('input', (event) => syncMemorySliders(event.target.value));

  $('#versions-refresh')?.addEventListener('click', () => loadVersions().catch(reportError));
  $('#versions-import-prism')?.addEventListener('click', async () => {
    const pathInput = prompt('Enter the full path to the Prism Launcher instance folder:');
    if (!pathInput) return;
    try {
      const { job } = await api('/api/instances/import-prism', { method: 'POST', body: { path: pathInput.trim() } });
      notify('Prism instance import started.');
    } catch (error) {
      reportError(error);
    }
  });
  $('#versions-search')?.addEventListener('input', (event) => { state.filterText = event.target.value; renderVersionList(); });
  $$('.filter-tab').forEach((tab) => tab.addEventListener('click', () => {
    const parent = tab.closest('.versions-list-panel, #mp-tabs') || document;
    if (tab.dataset.filter !== undefined) {
      tab.closest('.filter-tabs')?.querySelectorAll('.filter-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      state.filterType = tab.dataset.filter;
      renderVersionList();
    }
  }));
  $('#detail-install')?.addEventListener('click', async () => {
    if (!state.selectedVersionId) return;
    const check = await checkInstalled(state.selectedVersionId);
    if (check.installed) {
      log(`${state.selectedVersionId} is already installed — launching directly.`);
      setBusy(true, `Launching ${state.selectedVersionId}…`);
    }
    doInstall(state.selectedVersionId).catch(reportError);
  });
  $('#detail-uninstall')?.addEventListener('click', async () => {
    if (!state.selectedVersionId) return;
    if (!confirm(`Uninstall ${state.selectedVersionId}? This will delete the version files.`)) return;
    try {
      await api(`/api/versions/${encodeURIComponent(state.selectedVersionId)}/uninstall`, { method: 'POST' });
      notify(`${state.selectedVersionId} uninstalled.`);
      await loadInstalledVersions();
      renderVersionSelect();
      await updateDetailInstallButton(state.selectedVersionId);
    } catch (error) {
      reportError(error);
    }
  });
  $('#detail-memory')?.addEventListener('input', (event) => syncMemorySliders(event.target.value));

  $('#accounts-refresh')?.addEventListener('click', () => loadAccounts().catch(reportError));
  $('#account-add')?.addEventListener('click', addAccount);
  $('#account-username')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') addAccount(); });
  $('#account-microsoft')?.addEventListener('click', () => startMicrosoftLogin());
  $('#microsoft-user-code')?.addEventListener('click', async () => {
    const button = $('#microsoft-user-code');
    const code = button.textContent.trim();
    if (button.disabled || !/^[A-Z0-9-]{4,}$/i.test(code)) return;
    await navigator.clipboard?.writeText(code).catch(() => {});
    notify('Microsoft sign-in code copied.');
  });
  $('#microsoft-modal-close')?.addEventListener('click', () => closeMicrosoftModal(true));
  $('#microsoft-login-cancel')?.addEventListener('click', () => closeMicrosoftModal(true));
  $('#microsoft-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeMicrosoftModal(true); });

  $('#skin-file-button')?.addEventListener('click', () => $('#skin-file').click());
  $('#skin-file')?.addEventListener('change', (event) => previewSkinFile(event.target.files?.[0]).catch((error) => { setSkinStatus(error.message, 'error'); reportError(error); }));
  $('#skin-url-preview')?.addEventListener('click', () => previewSkinUrl().catch((error) => { setSkinStatus(error.message, 'error'); reportError(error); }));
  $('#skin-url')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') previewSkinUrl().catch((error) => { setSkinStatus(error.message, 'error'); reportError(error); }); });
  $('#skin-variant')?.addEventListener('change', () => {
    if (state.skinImageData) renderSkinPreview(state.skinImageData, $('#skin-preview-source').textContent, {}, true).catch(reportError);
  });
  $('#skin-apply')?.addEventListener('click', () => applySelectedSkin().catch(reportError));
  $('#skin-modal-close')?.addEventListener('click', hideSkinManager);
  $('#skin-cancel')?.addEventListener('click', hideSkinManager);
  $('#skin-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) hideSkinManager(); });

  $('#settings-save')?.addEventListener('click', () => saveSettings().then(() => notify('Settings saved.')).catch(reportError));
  $('#settings-memory')?.addEventListener('input', (event) => syncMemorySliders(event.target.value));
  $('#settings-theme-select')?.addEventListener('change', (event) => selectTheme(event.target.value));
  $('#settings-theme-new')?.addEventListener('click', () => createTheme());
  $('#settings-theme-delete')?.addEventListener('click', async () => {
    if (state.themes.length < 2) { notify('Keep at least one saved theme.', 'error'); return; }
    const id = currentThemeId();
    state.themes = state.themes.filter((theme) => theme.id !== id);
    state.activeThemeId = state.themes[0].id;
    populateThemeForm(state.themes[0]);
    renderThemeSelect();
    applyTheme(state.themes[0]);
    await saveSettings();
    notify('Theme deleted.');
  });
  $('#settings-theme-preview')?.addEventListener('click', () => { applyTheme(themeFromForm()); notify('Theme preview applied. Save to keep it.'); });
  $('#settings-theme-save')?.addEventListener('click', () => saveSettings().then(() => notify('Theme saved.')).catch(reportError));
  $('#settings-theme-reset')?.addEventListener('click', () => { populateThemeForm(defaultTheme); applyTheme(defaultTheme); notify('Amethyst colours restored. Save to keep them.'); });
  $('#settings-theme-name')?.addEventListener('input', () => applyTheme(themeFromForm()));
  $$('.theme-colors input[type="color"]').forEach(input => input.addEventListener('input', () => applyTheme(themeFromForm())));
  ['#settings-discord-enabled', '#settings-discord-client-id', '#settings-discord-details', '#settings-discord-state', '#settings-discord-image-key', '#settings-discord-image-text', '#settings-discord-elapsed'].forEach((selector) => {
    $(selector)?.addEventListener('input', () => updateDiscordPreview());
    $(selector)?.addEventListener('change', () => updateDiscordPreview());
  });
  $('#console-clear')?.addEventListener('click', () => { $('#game-console').textContent = ''; });
  $('#settings-change-dir')?.addEventListener('click', () => showDriveModal());
  $('#drive-cancel')?.addEventListener('click', hideDriveModal);
  $('#drive-modal-close')?.addEventListener('click', hideDriveModal);
  $('#drive-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) hideDriveModal(); });
  $('#drive-custom-select')?.addEventListener('click', async () => {
    const customPath = $('#drive-custom-path')?.value.trim();
    if (!customPath) return;
    await setGameDirectory(customPath);
  });
  $('#refresh-news')?.addEventListener('click', () => loadNews().catch(reportError));

  $('#modal-primary')?.addEventListener('click', () => {
    if ($('#modal-primary').dataset.state === 'complete') doLaunch(state.pendingVersionId).catch(reportError);
    else hideModal();
  });
  $('#modal-close')?.addEventListener('click', hideModal);
  $('#download-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) hideModal(); });
  $('#cleanup-modal-close')?.addEventListener('click', hideCleanupModal);
  $('#cleanup-cancel')?.addEventListener('click', hideCleanupModal);
  $('#cleanup-refresh')?.addEventListener('click', () => showCleanupModal());
  $('#cleanup-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) hideCleanupModal(); });

  // Crash report modal
  $('#crash-modal-close')?.addEventListener('click', hideCrashReport);
  $('#crash-close-btn')?.addEventListener('click', hideCrashReport);
  $('#crash-copy-log')?.addEventListener('click', copyCrashLog);
  $('#crash-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) hideCrashReport(); });

  // Modpacks
  $('#modpacks-refresh')?.addEventListener('click', () => loadModpacks());
  $('#modpacks-import')?.addEventListener('click', () => importThirdPartyModpack());
  $('#modpacks-new')?.addEventListener('click', () => showModpackModal());
  $('#modpack-empty-new')?.addEventListener('click', () => showModpackModal());
  $('#modpack-modal-close')?.addEventListener('click', () => hideModpackModal());
  $('#mp-new-cancel')?.addEventListener('click', () => hideModpackModal());
  $('#modpack-modal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) hideModpackModal(); });
  $('#mp-new-loader')?.addEventListener('change', () => refreshModpackLoaderVersions());
  $('#mp-new-mc')?.addEventListener('change', () => refreshModpackLoaderVersions());
  $('#mp-new-loader-refresh')?.addEventListener('click', () => refreshModpackLoaderVersions());
  $('#mp-new-create')?.addEventListener('click', async () => {
    const name = $('#mp-new-name')?.value.trim();
    const desc = $('#mp-new-desc')?.value.trim();
    const mc = $('#mp-new-mc')?.value;
    const loader = $('#mp-new-loader')?.value;
    const loaderVer = $('#mp-new-loader-ver')?.value;
    if (!name || !mc) { notify('Name and MC version required', 'error'); return; }
    try {
      const { modpack } = await api('/api/modpacks', { method:'POST', body:{ name, description:desc, minecraftVersion:mc, loader, loaderVersion:loaderVer||null } });
      hideModpackModal();
      await loadModpacks();
      selectModpack(modpack.id);
      navigateTo('modpacks');
      notify(`Modpack ${modpack.name} created`);
    } catch (e) { reportError(e); }
  });

  $('#mp-install')?.addEventListener('click', async () => {
    if (!state.selectedModpackId) return;
    try { await api(`/api/modpacks/${encodeURIComponent(state.selectedModpackId)}/install`, { method:'POST', body:{} }); notify('Modpack installed'); } catch (e) { reportError(e); }
  });
  $('#mp-launch')?.addEventListener('click', async () => {
    if (!state.selectedModpackId) return;
    try { const body = selectedPayload(); await api(`/api/modpacks/${encodeURIComponent(state.selectedModpackId)}/launch`, { method:'POST', body }); } catch (e) { reportError(e); }
  });
  $('#mp-add-jar')?.addEventListener('click', () => addJarToSelectedPack());
  $('#mp-delete')?.addEventListener('click', async () => {
    if (!state.selectedModpackId) return;
    if (!confirm('Delete this modpack? This will remove all files.')) return;
    try { await api(`/api/modpacks/${encodeURIComponent(state.selectedModpackId)}`, { method:'DELETE' }); state.selectedModpackId=null; $('#modpack-content').style.display='none'; $('#modpack-empty').style.display='flex'; await loadModpacks(); notify('Modpack deleted'); } catch (e) { reportError(e); }
  });

  $$('#mp-tabs .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('#mp-tabs .filter-tab').forEach(t=>t.classList.remove('active')); tab.classList.add('active');
      const name = tab.dataset.tab;
      $('#mp-tab-mods').style.display = name==='mods'?'block':'none';
      $('#mp-tab-resourcepacks').style.display = name==='resourcepacks'?'block':'none';
      $('#mp-tab-shaders').style.display = name==='shaders'?'block':'none';
      $('#mp-tab-settings').style.display = name==='settings'?'block':'none';
    });
  });

  $('#mp-project-type')?.addEventListener('change', () => doModSearch({ resetPage: true }));
  $('#mp-search-btn')?.addEventListener('click', () => doModSearch({ resetPage: true }));
  $('#mp-search')?.addEventListener('keydown', (e) => { if (e.key==='Enter') doModSearch({ resetPage: true }); });

  document.addEventListener('keydown', (event) => {
    if (event.key >= '1' && event.key <= '5' && !/input|select|textarea/i.test(document.activeElement?.tagName || '')) {
      const pages = ['home','versions','modpacks','accounts','settings'];
      navigateTo(pages[Number(event.key)-1]);
    }
    if (event.key === 'Escape') {
      hideModal();
      hideModpackModal();
      hideSkinManager();
      hideDriveModal();
      hideCleanupModal();
      hideCrashReport();
      if ($('#microsoft-modal')?.style.display !== 'none') closeMicrosoftModal(true);
    }
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
  const results = await Promise.allSettled([loadAccounts(), loadVersions(), loadJava(), loadNews(), loadModpacks(), loadRuntime()]);
  results.filter((result) => result.status === 'rejected').forEach((result) => reportError(result.reason));
  await loadInstalledVersions();
  renderVersionSelect();
  if (state.settings?.lastVersion) {
    const version = state.versions.find((item) => item.id === state.settings.lastVersion);
    if (version) selectVersion(version.id, version.type);
  }
  log('Amethyst launcher ready.');
}

boot().catch(reportError);
