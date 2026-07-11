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
  populateMcSelect();
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
      row.innerHTML = `<div style="flex:1; min-width:0"><div style="font-weight:600; font-size:.82rem">${escapeHtml(m.title||m.fileName)}</div><div class="muted" style="font-family:monospace; font-size:.68rem">${escapeHtml(m.fileName)} • ${escapeHtml(m.source)}</div></div><button class="button button-quiet" data-remove>Remove</button>`;
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
      const id = v.version || v.id || v.forgeVersion || v.neoForgeVersion || '';
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
                row.querySelector('button').addEventListener('click', async () => {
                  const body = { source:'modrinth', projectId:hit.project_id, projectSlug:hit.slug||hit.project_id, title:hit.title, versionId:ver.id, fileName:file.filename, fileUrl:file.url, size:file.size };
                  await api(`/api/modpacks/${encodeURIComponent(mpId)}/mods`, { method:'POST', body });
                  loadModpackMods(mpId);
                  versEl.innerHTML = '<span style="color:var(--green)">Installed</span>';
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
                row.querySelector('button').addEventListener('click', async () => {
                  if (!file.downloadUrl) { alert('No download URL (CurseForge may block). Try another file.'); return; }
                  const body = { source:'curseforge', projectId:String(mod.id), projectSlug:mod.slug||String(mod.id), title:mod.name, versionId:String(file.id), fileName:file.fileName, fileUrl:file.downloadUrl };
                  await api(`/api/modpacks/${encodeURIComponent(mpId)}/mods`, { method:'POST', body });
                  loadModpackMods(mpId);
                  versEl.innerHTML='<span style="color:var(--green)">Installed</span>';
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
    const parent = tab.closest('.versions-list-panel, #mp-tabs') || document;
    if (tab.dataset.filter !== undefined) {
      tab.closest('.filter-tabs')?.querySelectorAll('.filter-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      state.filterType = tab.dataset.filter;
      renderVersionList();
    }
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
    if (event.key === 'Escape') { hideModal(); hideModpackModal(); }
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
