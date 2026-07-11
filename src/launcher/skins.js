const dns = require('node:dns/promises');
const net = require('node:net');
const { getAccountRaw, updateAccountTokens } = require('./accounts');
const { ensureValidAccount } = require('./microsoftAuth');

const MINECRAFT_SKINS_URL = 'https://api.minecraftservices.com/minecraft/profile/skins';
const MINECRAFT_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';
const MAX_SKIN_BYTES = 512 * 1024;
const USER_AGENT = 'AmethystLauncher/0.2 (+https://github.com/MinLOL12/Amethyst)';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const SKIN_PROVIDERS = Object.freeze([
  { id: 'namemc', name: 'NameMC', url: 'https://namemc.com/minecraft-skins', supportsPageUrl: true },
  { id: 'skindex', name: 'The Skindex', url: 'https://www.minecraftskins.com/', supportsPageUrl: true },
  { id: 'planetminecraft', name: 'Planet Minecraft', url: 'https://www.planetminecraft.com/skins/', supportsPageUrl: false },
  { id: 'novaskin', name: 'Nova Skin', url: 'https://minecraft.novaskin.me/gallery', supportsPageUrl: false }
]);

function normalizeVariant(variant) {
  const value = String(variant || 'classic').toLowerCase();
  if (!['classic', 'slim'].includes(value)) throw new Error('Skin model must be classic or slim.');
  return value;
}

function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('The selected skin is not a valid PNG image.');
  }
  if (buffer.length > MAX_SKIN_BYTES) {
    throw new Error(`Skin PNG is too large (maximum ${Math.round(MAX_SKIN_BYTES / 1024)} KB).`);
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('The skin PNG has no valid IHDR header.');

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== 64 || ![32, 64].includes(height)) {
    throw new Error(`Minecraft Java skins must be 64×64 or legacy 64×32 PNG files (received ${width}×${height}).`);
  }
  return { width, height, size: buffer.length, legacy: height === 32 };
}

function decodeImageData(imageData) {
  const match = String(imageData || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error('Choose a PNG skin file before applying it.');
  const buffer = Buffer.from(match[1], 'base64');
  const metadata = inspectPng(buffer);
  return { buffer, metadata };
}

function resolveProviderUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter a direct skin PNG URL or choose a PNG file.');
  if (raw.length > 2048) throw new Error('Skin URL is too long.');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error('Enter a valid HTTPS skin URL.');
  }
  const rawHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
  // Minecraft profile responses historically used an http URL even though the
  // texture service supports HTTPS. Upgrade only this known host.
  if (parsed.protocol === 'http:' && rawHost === 'textures.minecraft.net') parsed.protocol = 'https:';
  if (parsed.protocol !== 'https:') throw new Error('Skin URLs must use HTTPS.');
  if (parsed.username || parsed.password) throw new Error('Skin URLs cannot contain credentials.');

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const nameMcMatch = host === 'namemc.com' && parsed.pathname.match(/^\/skin\/([a-f0-9]{64})(?:\/|$)/i);
  if (nameMcMatch) {
    const hash = nameMcMatch[1].toLowerCase();
    return `https://texture.namemc.com/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.png`;
  }

  const skindexMatch = host === 'minecraftskins.com' && parsed.pathname.match(/^\/skin\/(\d+)(?:\/|$)/i);
  if (skindexMatch) return `https://www.minecraftskins.com/skin/download/${skindexMatch[1]}`;
  return parsed.toString();
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateAddress(address) {
  const kind = net.isIP(address);
  if (kind === 4) return isPrivateIpv4(address);
  if (kind !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

async function assertPublicHostname(hostname) {
  if (hostname.toLowerCase() === 'localhost') throw new Error('Local skin URLs are not allowed.');
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Private-network skin URLs are not allowed.');
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`Could not resolve skin host ${hostname}: ${error.message}`);
  }
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error('Private-network skin URLs are not allowed.');
  }
}

async function readLimitedResponse(response) {
  const declared = Number(response.headers.get('content-length'));
  if (declared && declared > MAX_SKIN_BYTES) throw new Error('Skin image is larger than 512 KB.');
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SKIN_BYTES) {
      await reader.cancel();
      throw new Error('Skin image is larger than 512 KB.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function downloadSkin(sourceUrl, { fetchImpl = fetch } = {}) {
  let current = resolveProviderUrl(sourceUrl);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const parsed = new URL(current);
    await assertPublicHostname(parsed.hostname);

    let response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'image/png,image/*;q=0.8', 'User-Agent': USER_AGENT }
      });
    } catch (error) {
      throw new Error(`Could not download the skin from ${parsed.hostname}: ${error.message}`);
    }

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = resolveProviderUrl(new URL(response.headers.get('location'), current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Skin website returned HTTP ${response.status}.`);

    const buffer = await readLimitedResponse(response);
    const metadata = inspectPng(buffer);
    return { buffer, metadata, sourceUrl: current };
  }
  throw new Error('Skin URL redirected too many times.');
}

async function resolveSkinInput({ imageData, sourceUrl }, options = {}) {
  if (imageData) {
    const decoded = decodeImageData(imageData);
    return { ...decoded, sourceUrl: '' };
  }
  if (sourceUrl) return downloadSkin(sourceUrl, options);
  throw new Error('Choose a skin PNG file or enter a skin URL.');
}

function multipartSkinBody(buffer, variant) {
  const boundary = `----AmethystSkin${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const before = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\n${variant}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="amethyst-skin.png"\r\n` +
    'Content-Type: image/png\r\n\r\n',
    'utf8'
  );
  const after = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { boundary, body: Buffer.concat([before, buffer, after]) };
}

async function minecraftApiRequest(url, accessToken, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = {}; }
  }
  if (!response.ok) {
    const message = data.errorMessage || data.developerMessage || data.message || data.error || text || `HTTP ${response.status}`;
    throw new Error(`Minecraft rejected the skin: ${String(message).slice(0, 300)}`);
  }
  return data;
}

async function applySkin(accountId, input, { fetchImpl = fetch } = {}) {
  const stored = await getAccountRaw(accountId);
  if (!stored) throw new Error('Account not found.');
  if (stored.type !== 'microsoft') {
    throw new Error('Official skin changes require a signed-in Microsoft account. Offline profiles cannot publish skins to Minecraft services.');
  }

  const variant = normalizeVariant(input.variant);
  const { buffer, metadata, sourceUrl } = await resolveSkinInput(input, { fetchImpl });
  const account = await ensureValidAccount(accountId);
  const multipart = multipartSkinBody(buffer, variant);
  let profile = await minecraftApiRequest(MINECRAFT_SKINS_URL, account.accessToken, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`,
      'Content-Length': String(multipart.body.length)
    },
    body: multipart.body
  }, fetchImpl);

  // Some successful skin uploads return no body. Fetch the profile so the UI
  // immediately receives the canonical textures.minecraft.net URL.
  if (!profile?.skins) {
    profile = await minecraftApiRequest(MINECRAFT_PROFILE_URL, account.accessToken, {}, fetchImpl);
  }
  const activeSkin = profile.skins?.find((skin) => skin.state === 'ACTIVE') || profile.skins?.[0] || {};
  const skinUrl = activeSkin.url || sourceUrl || stored.skinUrl || '';
  const skinVariant = String(activeSkin.variant || variant).toLowerCase();
  const updated = await updateAccountTokens(accountId, {
    skinUrl,
    skinVariant,
    skinUpdatedAt: new Date().toISOString()
  });

  return { account: updated, skinUrl, variant: skinVariant, metadata };
}

async function previewSkin(input, options = {}) {
  const { buffer, metadata, sourceUrl } = await resolveSkinInput(input, options);
  return {
    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    sourceUrl,
    metadata
  };
}

module.exports = {
  SKIN_PROVIDERS,
  MAX_SKIN_BYTES,
  normalizeVariant,
  inspectPng,
  decodeImageData,
  resolveProviderUrl,
  isPrivateAddress,
  downloadSkin,
  resolveSkinInput,
  multipartSkinBody,
  applySkin,
  previewSkin
};
