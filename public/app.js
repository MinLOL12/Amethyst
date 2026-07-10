const $ = (selector) => document.querySelector(selector);

const state = {
  settings: null,
  accounts: [],
  versions: [],
  currentPercent: 0
};

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
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function setProgress(percent, text) {
  state.currentPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  $('#progress-bar').style.width = `${state.currentPercent}%`;
  if (text) $('#progress-text').textContent = text;
}

function setBusy(isBusy, label = 'Idle') {
  $('#task-state').textContent = label;
  $('#install-button').disabled = isBusy;
  $('#launch-button').disabled = isBusy;
}

async function loadSettings() {
  const { settings } = await api('/api/settings');
  state.settings = settings;
  $('#memory-slider').value = settings.memoryMb;
  $('#memory-value').textContent = settings.memoryMb;
  $('#java-path').value = settings.javaPath || '';
}

async function saveSettings(extra = {}) {
  const memoryMb = Number($('#memory-slider').value);
  const javaPath = $('#java-path').value.trim();
  const selectedVersion = $('#version-select').value;
  const selectedAccount = $('#account-select').value;
  const { settings } = await api('/api/settings', {
    method: 'POST',
    body: {
      ...state.settings,
      memoryMb,
      javaPath,
      lastVersion: selectedVersion || state.settings?.lastVersion || '',
      lastAccountId: selectedAccount || state.settings?.lastAccountId || '',
      ...extra
    }
  });
  state.settings = settings;
  $('#memory-value').textContent = settings.memoryMb;
  log('Settings saved.');
  return settings;
}

async function loadAccounts() {
  const { accounts } = await api('/api/accounts');
  state.accounts = accounts;
  const select = $('#account-select');
  select.innerHTML = '';
  if (!accounts.length) {
    const option = document.createElement('option');
    option.textContent = 'Create an offline account';
    option.value = '';
    select.append(option);
    return;
  }
  for (const account of accounts) {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = `${account.username} (${account.type})`;
    if (account.id === state.settings?.lastAccountId) option.selected = true;
    select.append(option);
  }
}

async function loadVersions() {
  const data = await api('/api/versions');
  state.versions = data.versions;
  const select = $('#version-select');
  select.innerHTML = '';

  for (const version of data.versions) {
    const option = document.createElement('option');
    option.value = version.id;
    option.textContent = `${version.id} · ${version.type}`;
    if (version.id === state.settings?.lastVersion || (!state.settings?.lastVersion && version.id === data.latest?.release)) {
      option.selected = true;
    }
    select.append(option);
  }
  log(`Loaded ${data.versions.length} official versions from Mojang.`);
}

async function loadJava() {
  const container = $('#java-list');
  container.textContent = 'Scanning…';
  try {
    const { installations } = await api('/api/java');
    if (!installations.length) {
      container.innerHTML = '<p class="muted">No Java executable found. Install Java 17+ or set a path override.</p>';
      return;
    }
    container.innerHTML = '';
    for (const java of installations) {
      const item = document.createElement('div');
      item.className = 'java-item';
      item.innerHTML = `<strong>Java ${java.major || java.version}</strong><code></code>`;
      item.querySelector('code').textContent = java.path;
      item.addEventListener('click', () => {
        $('#java-path').value = java.path;
        log(`Selected Java override: ${java.path}`);
      });
      container.append(item);
    }
  } catch (error) {
    container.textContent = error.message;
  }
}

async function loadNews() {
  const news = $('#news');
  news.innerHTML = '<p class="muted">Loading news…</p>';
  const template = $('#news-template');
  try {
    const { entries } = await api('/api/news');
    news.innerHTML = '';
    for (const entry of entries) {
      const node = template.content.cloneNode(true);
      node.querySelector('.news-meta').textContent = [entry.category, entry.date].filter(Boolean).join(' · ');
      node.querySelector('h3').textContent = entry.title;
      node.querySelector('p').textContent = entry.excerpt || '';
      node.querySelector('a').href = entry.url;
      news.append(node);
    }
  } catch (error) {
    news.innerHTML = `<p class="muted">${error.message}</p>`;
  }
}

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
        break;
      case 'task-complete':
        setBusy(false, 'Idle');
        setProgress(100, `${event.name} complete.`);
        log(`Complete: ${event.name}`);
        break;
      case 'task-error':
        setBusy(false, 'Error');
        log(`Error in ${event.name}: ${event.message}`, 'error');
        break;
      case 'download-start':
        log(`Downloading ${event.label}`);
        break;
      case 'download-progress':
        if (event.total) setProgress(event.percent, `${event.label}: ${event.percent}%`);
        break;
      case 'download-complete':
        log(`Downloaded ${event.label}`);
        break;
      case 'download-skip':
        log(`Already current: ${event.label}`);
        break;
      case 'assets-progress':
        setProgress(event.percent, `Assets: ${event.completed}/${event.total}`);
        break;
      case 'status':
        log(event.message);
        break;
      case 'launch-start':
        log(`Launching ${event.versionId} with ${event.java}`);
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

function selectedPayload() {
  const versionId = $('#version-select').value;
  const accountId = $('#account-select').value;
  return {
    versionId,
    accountId,
    memoryMb: Number($('#memory-slider').value),
    javaPath: $('#java-path').value.trim()
  };
}

function bindUi() {
  $('#memory-slider').addEventListener('input', (event) => {
    $('#memory-value').textContent = event.target.value;
  });

  $('#save-settings').addEventListener('click', () => saveSettings().catch((error) => log(error.message, 'error')));
  $('#refresh-java').addEventListener('click', () => loadJava());
  $('#refresh-news').addEventListener('click', () => loadNews());

  $('#account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#username').value;
    try {
      const { account } = await api('/api/accounts', { method: 'POST', body: { username } });
      $('#username').value = '';
      await loadAccounts();
      $('#account-select').value = account.id;
      await saveSettings({ lastAccountId: account.id });
      log(`Saved offline account ${account.username}.`);
    } catch (error) {
      log(error.message, 'error');
    }
  });

  $('#install-button').addEventListener('click', async () => {
    try {
      await saveSettings();
      await api('/api/install', { method: 'POST', body: selectedPayload() });
    } catch (error) {
      setBusy(false, 'Error');
      log(error.message, 'error');
    }
  });

  $('#launch-button').addEventListener('click', async () => {
    try {
      await saveSettings();
      await api('/api/launch', { method: 'POST', body: selectedPayload() });
    } catch (error) {
      setBusy(false, 'Error');
      log(error.message, 'error');
    }
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
  await loadSettings();
  await Promise.all([loadAccounts(), loadVersions(), loadJava(), loadNews()]);
  await initElectronIntegration();
}

boot().catch((error) => log(error.message, 'error'));
