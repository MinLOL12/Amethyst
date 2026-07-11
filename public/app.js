/* Amethyst — polished UI + modpack creator */

const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

const state = {
  settings: null,
  accounts: [],
  versions: [],
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
  curseforgeEnabled: false,
  microsoftLoginId: null,
  microsoftLoginTimer: null,
  skinAccountId: null,
  skinImageData: '',
  skinSourceUrl: '',
  loaderVersions: {},
  loaderRequestId: 0,
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
async function loadSettings() {
  const { settings } = await api('/api/settings');
  state.settings = settings;
  syncMemorySliders(settings.memoryMb);
  $('#settings-java-path').value = settings.javaPath || '';
  if (settings.lastVersion && $('#ql-version')) $('#ql-version').value = settings.lastVersion;
  await selectLoader(settings.loaderType || 'vanilla', settings.loaderVersion || '');
  const dataDirectory = $('#settings-data-dir');
  if (dataDirectory) dataDirectory.textContent = settings.gameDir || '—';
  const gameDirectory = $('#settings-game-dir');
  if (gameDirectory) gameDirectory.textContent = settings.gameDir || '—';
}

async function saveSettings(extra = {}) {
  const body = {
    ...state.settings,
    memoryMb: memoryValue(),
    javaPath: $('#settings-java-path')?.value.trim() || '',
    lastVersion: $('#ql-version')?.value || state.settings?.lastVersion || '',
    lastAccountId: state.settings?.lastAccountId || '',
    loaderType: selectedLoaderType(),
    loaderVersion: selectedLoaderType() === 'vanilla' ? '' : selectedLoaderVersion(),
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
  refreshLoaderVersions().catch(reportError);
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
  $('#mp-sub').textContent = `${mp.minecraftVersion} • created ${mp.createdAt?.split('T')[0]||''}`;
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
}

async function loadModpackMods(id) {
  const listEl = $('#mp-mods-list');
  if (!listEl) return;
  listEl.innerHTML = '<span class="muted">Loading mods…</span>';
  try {
    const { mods } = await api(`/api/modpacks/${encodeURIComponent(id)}/mods`);
    listEl.innerHTML = '';
    if (!mods.length) {
      listEl.innerHTML = '<div class="account-empty" style="min-height:120px"><div class="empty-glyph">◫</div><strong>No mods yet</strong><p>Use Browse tab to add mods from Modrinth or CurseForge.</p></div>';
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

function showModpackModal() { const el = $('#modpack-modal'); if (el) el.style.display = 'flex'; }
function hideModpackModal() { const el = $('#modpack-modal'); if (el) el.style.display = 'none'; }

async function refreshLoaderVersions() {
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
  try {
    const { mod } = await api(`/api/modpacks/${encodeURIComponent(packId)}/mods`, { method:'POST', body });
    await loadModpackMods(packId);
    resultContainer.innerHTML = `<span style="color:var(--green)">Installed ${escapeHtml(mod.fileName)} in the pack's mods folder.</span>`;
    notify(`${mod.title || mod.fileName} installed.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    notify(error.message, 'error');
    throw error;
  }
}

async function doModSearch() {
  const query = $('#mp-search')?.value.trim() || '';
  const source = $('#mp-source')?.value || 'modrinth';
  const mpId = state.selectedModpackId;
  if (!mpId) { notify('Select a modpack first', 'error'); return; }
  const mp = state.modpacks.find(m => m.id === mpId);
  if (!mp) return;
  const resultsEl = $('#mp-browse-results');
  const infoEl = $('#mp-browse-info');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<span class="muted">Searching…</span>';
  if (infoEl) infoEl.textContent = '';
  try {
    if (source === 'modrinth') {
      const params = new URLSearchParams({ q: query, loader: mp.loader === 'vanilla' ? '' : mp.loader, gameVersion: mp.minecraftVersion, limit: '20' });
      const data = await api(`/api/modrinth/search?${params.toString()}`);
      const hits = data.hits || [];
      resultsEl.innerHTML = '';
      if (!hits.length) { resultsEl.innerHTML = '<div class="muted">No results</div>'; return; }
      for (const hit of hits) {
        const div = document.createElement('div');
        div.className = 'mod-item';
        div.innerHTML = `${hit.icon_url ? `<img src="${escapeHtml(hit.icon_url)}" alt="">` : `<div style="width:40px;height:40px;border-radius:8px;background:rgba(255,255,255,.06)"></div>`}<div style="flex:1; min-width:0"><div style="font-weight:600; font-size:.85rem">${escapeHtml(hit.title)}</div><div class="muted" style="font-size:.7rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(hit.description||'')}</div><div class="muted" style="font-size:.64rem; margin-top:4px">${escapeHtml(hit.author||'')} · ${hit.downloads||0} downloads</div><div class="mod-versions" style="display:none; flex-direction:column; margin-top:8px"></div></div><div><button class="button button-quiet" data-show>Versions</button></div>`;
        const versEl = div.querySelector('.mod-versions');
        const btn = div.querySelector('[data-show]');
        btn.addEventListener('click', async () => {
          if (versEl.style.display === 'none') {
            versEl.style.display = 'flex'; versEl.innerHTML = '<span class="muted">Loading…</span>';
            try {
              const vData = await api(`/api/modrinth/project/${encodeURIComponent(hit.project_id)}/versions?loader=${encodeURIComponent(mp.loader!=='vanilla'?mp.loader:'')}&gameVersion=${encodeURIComponent(mp.minecraftVersion)}`);
              const versions = vData.versions || [];
              versEl.innerHTML = '';
              if (!versions.length) { versEl.innerHTML = '<span class="muted">No compatible versions</span>'; return; }
              for (const ver of versions.slice(0, 10)) {
                const file = ver.files?.find(f=>f.primary) || ver.files?.[0]; if (!file) continue;
                const row = document.createElement('div'); row.className='mod-ver';
                row.innerHTML = `<div><div class="mod-ver-name">${escapeHtml(ver.version_number)} — ${escapeHtml(ver.name||'')}</div><div class="muted" style="font-size:.6rem">${(ver.loaders||[]).join(', ')} · ${escapeHtml((ver.game_versions||[]).join(', ').slice(0,60))}</div></div><button class="button primary" style="min-height:28px; font-size:.68rem">Install</button>`;
                row.querySelector('button').addEventListener('click', async (event) => {
                  const body = { source:'modrinth', projectId:hit.project_id, projectSlug:hit.slug||hit.project_id, title:hit.title, versionId:ver.id, fileName:file.filename, fileUrl:file.url, size:file.size };
                  await installModFile(mpId, body, event.currentTarget, versEl).catch((error) => {
                    versEl.insertAdjacentHTML('beforeend', `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`);
                  });
                });
                versEl.append(row);
              }
            } catch (e) { versEl.innerHTML = `<span style="color:var(--red)">${escapeHtml(e.message)}</span>`; }
          } else { versEl.style.display='none'; }
        });
        resultsEl.append(div);
      }
      if (infoEl) infoEl.textContent = `${data.total_hits||hits.length} results`;
    } else {
      if (!state.curseforgeEnabled) { resultsEl.innerHTML = '<div class="muted">CurseForge API key not configured. Set CURSEFORGE_API_KEY env var. Modrinth works without key.</div>'; return; }
      const params = new URLSearchParams({ q: query, gameVersion: mp.minecraftVersion, loader: mp.loader==='vanilla'?'':mp.loader, limit:'20' });
      const data = await api(`/api/curseforge/search?${params.toString()}`);
      const mods = data.data || [];
      resultsEl.innerHTML = '';
      if (!mods.length) { resultsEl.innerHTML = '<div class="muted">No results</div>'; return; }
      for (const mod of mods) {
        const div = document.createElement('div'); div.className='mod-item';
        const icon = mod.logo?.thumbnailUrl || mod.logo?.url || '';
        div.innerHTML = `${icon ? `<img src="${escapeHtml(icon)}" alt="">` : `<div style="width:40px;height:40px;background:rgba(255,255,255,.06);border-radius:8px"></div>`}<div style="flex:1; min-width:0"><div style="font-weight:600">${escapeHtml(mod.name)}</div><div class="muted" style="font-size:.7rem">${escapeHtml(mod.summary||'')}</div><div class="mod-versions" style="display:none; flex-direction:column; margin-top:8px"></div></div><div><button class="button button-quiet" data-show>Versions</button></div>`;
        const versEl = div.querySelector('.mod-versions'); const btn = div.querySelector('[data-show]');
        btn.addEventListener('click', async () => {
          if (versEl.style.display === 'none') {
            versEl.style.display='flex'; versEl.innerHTML='<span class="muted">Loading files…</span>';
            try {
              const fData = await api(`/api/curseforge/mod/${encodeURIComponent(mod.id)}/files?gameVersion=${encodeURIComponent(mp.minecraftVersion)}&loader=${encodeURIComponent(mp.loader!=='vanilla'?mp.loader:'')}`);
              const files = fData.data || [];
              versEl.innerHTML='';
              if (!files.length) { versEl.innerHTML='<span class="muted">No compatible files</span>'; return; }
              for (const file of files.slice(0,10)) {
                const row = document.createElement('div'); row.className='mod-ver';
                row.innerHTML = `<div><div class="mod-ver-name">${escapeHtml(file.displayName)}</div><div class="muted" style="font-size:.6rem">${escapeHtml((file.gameVersions||[]).join(', '))}</div></div><button class="button primary" style="min-height:28px">Install</button>`;
                row.querySelector('button').addEventListener('click', async (event) => {
                  if (!file.downloadUrl) { alert('No download URL (CurseForge may block). Try another file.'); return; }
                  const body = { source:'curseforge', projectId:String(mod.id), projectSlug:mod.slug||String(mod.id), title:mod.name, versionId:String(file.id), fileName:file.fileName, fileUrl:file.downloadUrl };
                  await installModFile(mpId, body, event.currentTarget, versEl).catch((error) => {
                    versEl.insertAdjacentHTML('beforeend', `<span style="color:var(--red)">${escapeHtml(error.message)}</span>`);
                  });
                });
                versEl.append(row);
              }
            } catch (e) { versEl.innerHTML=`<span style="color:var(--red)">${escapeHtml(e.message)}</span>`; }
          } else { versEl.style.display='none'; }
        });
        resultsEl.append(div);
      }
      if (infoEl) infoEl.textContent = `${data.pagination?.totalCount||mods.length} results`;
    }
  } catch (e) {
    resultsEl.innerHTML = `<span style="color:var(--red)">${escapeHtml(e.message)}</span>`;
  }
}

// Status and modal
async function loadStatus() {
  try {
    const data = await api('/api/status');
    $('#app-version').textContent = data.version || '0.1.0';
    $('#about-version').textContent = data.version || '0.1.0';
    $('#settings-data-dir').textContent = data.dataRoot || '—';
    state.curseforgeEnabled = !!data.curseforgeEnabled;
    setOnline(true);
  } catch { setOnline(false); }
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
      case 'queue-start':
        setBusy(true, event.name);
        setProgress(0, event.name);
        showModal(event.name, state.pendingVersionId);
        log(`Started: ${event.name}`);
        break;
      case 'task-complete':
      case 'queue-complete':
        setBusy(false, 'Ready');
        setProgress(100, 'Complete');
        updateModal('✓', 'Everything is ready.', true);
        notify(`${event.name} completed.`, 'success');
        log(`Complete: ${event.name}`);
        break;
      case 'task-error':
      case 'queue-error':
        setBusy(false, 'Error');
        updateModal('!', event.message, false, true);
        notify(event.message, 'error');
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
        log(`Launching ${event.versionId} with ${event.loaderType && event.loaderType !== 'vanilla' ? `${event.loaderType} ${event.loaderVersion || ''}`.trim() : 'vanilla'} (${event.mainClass || 'Minecraft'}) using ${event.java}`);
        setBusy(false, 'Ready');
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
    refreshLoaderVersions().catch(reportError);
  });
  for (const selector of loaderTypeSelectors) {
    $(selector)?.addEventListener('change', (event) => {
      selectLoader(event.target.value).catch(reportError);
    });
  }
  for (const selector of loaderVersionSelectors) {
    $(selector)?.addEventListener('change', (event) => syncSelectedLoaderVersion(event.target.value));
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

  // Modpacks
  $('#modpacks-refresh')?.addEventListener('click', () => loadModpacks());
  $('#modpacks-new')?.addEventListener('click', () => showModpackModal());
  $('#modpack-empty-new')?.addEventListener('click', () => showModpackModal());
  $('#modpack-modal-close')?.addEventListener('click', () => hideModpackModal());
  $('#mp-new-cancel')?.addEventListener('click', () => hideModpackModal());
  $('#modpack-modal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) hideModpackModal(); });
  $('#mp-new-loader')?.addEventListener('change', () => refreshLoaderVersions());
  $('#mp-new-mc')?.addEventListener('change', () => refreshLoaderVersions());
  $('#mp-new-loader-refresh')?.addEventListener('click', () => refreshLoaderVersions());
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
      $('#mp-tab-browse').style.display = name==='browse'?'block':'none';
      $('#mp-tab-settings').style.display = name==='settings'?'block':'none';
    });
  });

  $('#mp-search-btn')?.addEventListener('click', () => doModSearch());
  $('#mp-search')?.addEventListener('keydown', (e) => { if (e.key==='Enter') doModSearch(); });

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
  const results = await Promise.allSettled([loadAccounts(), loadVersions(), loadJava(), loadNews(), loadModpacks()]);
  results.filter((result) => result.status === 'rejected').forEach((result) => reportError(result.reason));
  if (state.settings?.lastVersion) {
    const version = state.versions.find((item) => item.id === state.settings.lastVersion);
    if (version) selectVersion(version.id, version.type);
  }
  log('Amethyst launcher ready.');
}

boot().catch(reportError);
