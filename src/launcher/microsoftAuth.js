const crypto = require('node:crypto');
const { MS_CLIENT_ID, MS_SCOPE, MS_DEVICE_CODE_URL, MS_TOKEN_URL } = require('../config');
const { upsertMicrosoftAccount, getAccountRaw, updateAccountTokens, listAccountsRaw } = require('./accounts');
const { progressBus } = require('./downloader');

const pendingLogins = new Map();

const USER_AGENT = 'AmethystLauncher/0.2 (+https://github.com/MinLOL12/Amethyst)';

async function postForm(url, fields) {
  const body = new URLSearchParams(fields);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`Microsoft auth failed (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = data.error_description || data.error || `HTTP ${response.status}`;
    const error = new Error(message);
    error.code = data.error;
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const XSTS_ERROR_MESSAGES = {
  2148916233: 'This Microsoft account does not have an Xbox Live profile. Sign in to minecraft.net once to create one.',
  2148916235: 'Xbox Live is not available in your country or region.',
  2148916236: 'An adult must add this child account to a Microsoft Family to use Xbox Live.',
  2148916237: 'This account has been blocked from Xbox Live.',
  2148916238: 'This is a child account. An adult must add it to a Microsoft Family to use Xbox Live.'
};

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...headers
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // XSTS errors use XErr numeric codes with empty Message strings
    let message = data.errorMessage || data.message || data.error;
    if (!message && data.XErr) {
      message = XSTS_ERROR_MESSAGES[data.XErr] || `Xbox Live error ${data.XErr}${data.Redirect ? ` (see ${data.Redirect})` : ''}`;
    }
    if (!message && data.Message) message = data.Message;
    if (!message) message = `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.errorMessage || data.error || data.message || data.developerMessage || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/**
 * Start Microsoft device-code login.
 * Returns user_code / verification_uri for the UI; polling continues in the background.
 */
function deviceCodeFields(endpoint = MS_DEVICE_CODE_URL) {
  const fields = { client_id: MS_CLIENT_ID, scope: MS_SCOPE };
  // The legacy Live endpoint used by the official Minecraft client requires
  // this field. The Entra v2 endpoint infers the device-code response type.
  if (new URL(endpoint).hostname === 'login.live.com') fields.response_type = 'device_code';
  return fields;
}

function deviceTokenFields(deviceCode) {
  return {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: MS_CLIENT_ID,
    device_code: deviceCode
  };
}

async function startDeviceLogin({ remember = true } = {}) {
  let data;
  try {
    data = await postForm(MS_DEVICE_CODE_URL, deviceCodeFields());
  } catch (error) {
    if (/AADSTS700016|application with identifier/i.test(error.message)) {
      throw new Error('Microsoft rejected the OAuth application. The client ID was sent to the wrong authority; update Amethyst or configure AMETHYST_MS_CLIENT_ID for a public device-code app.');
    }
    throw error;
  }
  if (!data.device_code || !data.user_code) {
    throw new Error('Microsoft did not return a device code. Check the configured Microsoft OAuth client and authority.');
  }

  const loginId = crypto.randomUUID();
  const session = {
    loginId,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || data.verification_url || data.verification_uri_complete || 'https://www.microsoft.com/link',
    message: data.message,
    interval: Math.max(2, Number(data.interval) || 5),
    expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000,
    remember: remember !== false,
    status: 'pending',
    account: null,
    error: null,
    abort: false
  };
  pendingLogins.set(loginId, session);

  progressBus.emitEvent('ms-login-start', {
    loginId,
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    message: session.message
  });

  pollDeviceLogin(session).catch(() => {});
  return {
    loginId,
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    message: session.message,
    expiresIn: Number(data.expires_in) || 900,
    interval: session.interval
  };
}

async function pollDeviceLogin(session) {
  while (!session.abort && Date.now() < session.expiresAt) {
    await sleep(session.interval * 1000);
    if (session.abort) break;

    try {
      const token = await postForm(MS_TOKEN_URL, deviceTokenFields(session.deviceCode));
      session.status = 'authenticating';
      progressBus.emitEvent('ms-login-progress', { loginId: session.loginId, status: 'authenticating' });

      const account = await completeMicrosoftAuth(token, session.remember);
      session.status = 'complete';
      session.account = account;
      progressBus.emitEvent('ms-login-complete', { loginId: session.loginId, account });
      return account;
    } catch (error) {
      if (error.code === 'authorization_pending') continue;
      if (error.code === 'slow_down') {
        session.interval += 2;
        continue;
      }
      if (error.code === 'expired_token') {
        session.status = 'expired';
        session.error = 'Device code expired. Start login again.';
        progressBus.emitEvent('ms-login-error', { loginId: session.loginId, message: session.error });
        return null;
      }
      session.status = 'error';
      session.error = error.message;
      progressBus.emitEvent('ms-login-error', { loginId: session.loginId, message: error.message });
      return null;
    }
  }

  if (session.status === 'pending') {
    session.status = 'expired';
    session.error = 'Device code expired. Start login again.';
    progressBus.emitEvent('ms-login-error', { loginId: session.loginId, message: session.error });
  }
  return null;
}

function getLoginStatus(loginId) {
  const session = pendingLogins.get(loginId);
  if (!session) return { status: 'unknown' };
  return {
    loginId: session.loginId,
    status: session.status,
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    message: session.message,
    account: session.account,
    error: session.error
  };
}

function cancelLogin(loginId) {
  const session = pendingLogins.get(loginId);
  if (session) {
    session.abort = true;
    session.status = 'cancelled';
    pendingLogins.delete(loginId);
  }
  return { ok: true };
}

async function completeMicrosoftAuth(msToken, remember = true) {
  const msAccessToken = msToken.access_token;
  const refreshToken = msToken.refresh_token || '';
  const expiresIn = Number(msToken.expires_in) || 3600;

  progressBus.emitEvent('status', { message: 'Authenticating with Xbox Live…' });
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });

  const userHash = xbl.DisplayClaims?.xui?.[0]?.uhs;
  if (!userHash) throw new Error('Xbox Live authentication did not return a user hash.');

  progressBus.emitEvent('status', { message: 'Requesting XSTS token…' });
  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: {
      SandboxId: 'RETAIL',
      UserTokens: [xbl.Token]
    },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });

  const xuid = xsts.DisplayClaims?.xui?.[0]?.xid || '';

  progressBus.emitEvent('status', { message: 'Logging into Minecraft services…' });
  const mcLogin = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${userHash};${xsts.Token}`
  });

  const mcToken = mcLogin.access_token;
  if (!mcToken) throw new Error('Minecraft services did not return an access token.');

  const ownership = await getJson('https://api.minecraftservices.com/entitlements/mcstore', {
    Authorization: `Bearer ${mcToken}`
  });
  const items = ownership.items || ownership;
  const ownsGame = Array.isArray(items)
    ? items.some((item) => /minecraft|product_minecraft|game_minecraft/i.test(item.name || item))
    : true;
  if (!ownsGame && Array.isArray(items) && items.length === 0) {
    // Soft-check: some accounts return empty briefly; still try profile.
  }

  progressBus.emitEvent('status', { message: 'Fetching Minecraft profile…' });
  const profile = await getJson('https://api.minecraftservices.com/minecraft/profile', {
    Authorization: `Bearer ${mcToken}`
  });

  if (!profile.id || !profile.name) {
    throw new Error('This Microsoft account does not own Minecraft Java Edition (or the profile is incomplete).');
  }

  const uuid = formatUuid(profile.id);
  const activeSkin = profile.skins?.find((skin) => skin.state === 'ACTIVE') || profile.skins?.[0] || {};
  const skinUrl = activeSkin.url || '';
  const skinVariant = String(activeSkin.variant || 'classic').toLowerCase();

  const account = await upsertMicrosoftAccount({
    username: profile.name,
    uuid,
    mcToken,
    refreshToken: remember ? refreshToken : '',
    msAccessToken: remember ? msAccessToken : '',
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    xuid,
    skinUrl,
    skinVariant,
    remembered: remember
  });

  progressBus.emitEvent('status', { message: `Signed in as ${profile.name}` });
  return account;
}

async function refreshMicrosoftAccount(accountId) {
  const account = await getAccountRaw(accountId);
  if (!account || account.type !== 'microsoft') {
    throw new Error('Microsoft account not found');
  }
  if (!account.refreshToken) {
    throw new Error('No refresh token stored. Sign in again with "Remember login" enabled.');
  }

  progressBus.emitEvent('status', { message: `Refreshing Microsoft session for ${account.username}…` });
  
  let token;
  try {
    token = await postForm(MS_TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: MS_CLIENT_ID,
      refresh_token: account.refreshToken,
      scope: MS_SCOPE
    });
  } catch (error) {
    // Provide clearer error messages for common refresh failures
    if (error.code === 'invalid_grant' || error.status === 400) {
      throw new Error(
        `Your Microsoft session has expired or been revoked. Please sign out and sign in again. ` +
        `(Original error: ${error.message || 'HTTP 400'})`
      );
    }
    throw error;
  }

  const updated = await completeMicrosoftAuth(
    {
      access_token: token.access_token,
      refresh_token: token.refresh_token || account.refreshToken,
      expires_in: token.expires_in
    },
    account.remembered !== false
  );
  return updated;
}

/**
 * Ensure the account has a valid Minecraft token, refreshing if needed.
 * Offline accounts are returned as-is.
 */
async function ensureValidAccount(accountId) {
  const account = await getAccountRaw(accountId);
  if (!account) throw new Error('Account not found');

  if (account.type === 'offline') {
    return {
      id: account.id,
      username: account.username,
      uuid: account.uuid,
      type: 'offline',
      accessToken: `offline-${account.uuid}`,
      userType: 'legacy',
      xuid: ''
    };
  }

  const expired = !account.expiresAt || Date.parse(account.expiresAt) <= Date.now() + 60_000;
  let current = account;
  if (expired || !account.mcToken) {
    if (account.refreshToken) {
      await refreshMicrosoftAccount(account.id);
      current = await getAccountRaw(account.id);
    } else {
      throw new Error('Microsoft session expired. Switch accounts or sign in again.');
    }
  }

  return {
    id: current.id,
    username: current.username,
    uuid: current.uuid,
    type: 'microsoft',
    accessToken: current.mcToken,
    userType: 'msa',
    xuid: current.xuid || ''
  };
}

async function switchAccount(accountId) {
  const account = await getAccountRaw(accountId);
  if (!account) throw new Error('Account not found');

  if (account.type === 'microsoft') {
    const expired = !account.expiresAt || Date.parse(account.expiresAt) <= Date.now() + 60_000;
    if (expired && account.refreshToken) {
      await refreshMicrosoftAccount(accountId);
    }
  }

  const { setActiveAccount } = require('./accounts');
  return setActiveAccount(accountId);
}

function formatUuid(id) {
  const hex = String(id).replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listRememberedMicrosoftAccounts() {
  const all = await listAccountsRaw();
  return all
    .filter((a) => a.type === 'microsoft' && a.remembered !== false)
    .map((a) => ({
      id: a.id,
      username: a.username,
      uuid: a.uuid,
      expiresAt: a.expiresAt,
      hasRefreshToken: Boolean(a.refreshToken)
    }));
}

module.exports = {
  startDeviceLogin,
  getLoginStatus,
  cancelLogin,
  refreshMicrosoftAccount,
  ensureValidAccount,
  switchAccount,
  completeMicrosoftAuth,
  listRememberedMicrosoftAccounts,
  deviceCodeFields,
  deviceTokenFields
};
