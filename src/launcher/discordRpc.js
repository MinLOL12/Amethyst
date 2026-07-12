let DiscordRPC = null;
try {
  DiscordRPC = require('discord-rpc');
} catch (_) {
  DiscordRPC = null;
}

const { progressBus } = require('./downloader');
const { readSettings } = require('./accounts');

let client = null;
let connectedClientId = '';
let startedAt = null;
let currentLaunch = null;
let updateTimer = null;

function clean(value, fallback = '') {
  return String(value || fallback).trim().slice(0, 128);
}

function interpolate(template, context) {
  return clean(template).replace(/\{(version|loader|player)\}/g, (_, key) => clean(context[key]));
}

async function disconnect() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = null;
  try { client?.clearActivity?.(); } catch (_) {}
  try { client?.destroy?.(); } catch (_) {}
  client = null;
  connectedClientId = '';
}

async function activityFor(settings, launch = currentLaunch) {
  if (!launch) return null;
  const context = {
    version: launch.baseVersionId || launch.versionId || 'Minecraft',
    loader: launch.loader && launch.loader !== 'vanilla' ? launch.loader : 'Vanilla',
    player: launch.username || 'Player'
  };
  const activity = {
    details: interpolate(settings.discordDetails || 'Playing Minecraft {version}', context),
    state: interpolate(settings.discordState || 'via {loader} · {player}', context),
    instance: false
  };
  if (settings.discordShowElapsed !== false && startedAt) activity.startTimestamp = startedAt;
  if (settings.discordLargeImageKey) activity.largeImageKey = clean(settings.discordLargeImageKey);
  if (settings.discordLargeImageText) activity.largeImageText = interpolate(settings.discordLargeImageText, context);
  return activity;
}

async function refreshDiscordPresence(launch = currentLaunch) {
  currentLaunch = launch;
  const settings = await readSettings();
  const clientId = clean(settings.discordClientId || process.env.AMETHYST_DISCORD_CLIENT_ID);
  if (!settings.discordEnabled || !clientId || !launch) {
    await disconnect();
    return { connected: false, reason: !clientId ? 'missing-client-id' : 'disabled' };
  }

  if (!DiscordRPC) {
    await disconnect();
    return { connected: false, reason: 'discord-rpc-unavailable', message: 'Discord RPC dependency is not installed.' };
  }

  if (!client || connectedClientId !== clientId) {
    await disconnect();
    client = new DiscordRPC.Client({ transport: 'ipc' });
    client.on('disconnected', () => {
      client = null;
      connectedClientId = '';
    });
    await client.login({ clientId });
    connectedClientId = clientId;
  }

  await client.setActivity(await activityFor(settings, launch));
  return { connected: true };
}

function reportFailure(error) {
  progressBus.emitEvent('discord-rpc', { connected: false, message: error.message });
}

progressBus.on('event', (event) => {
  if (event.type === 'launch-ready') {
    startedAt = new Date();
    refreshDiscordPresence({
      versionId: event.versionId,
      baseVersionId: event.baseVersionId,
      loader: event.loader,
      username: event.username
    }).then((status) => progressBus.emitEvent('discord-rpc', status)).catch(reportFailure);
  } else if (event.type === 'launch-exit' || event.type === 'launch-error') {
    currentLaunch = null;
    startedAt = null;
    disconnect().catch(() => {});
  }
});

async function applyDiscordSettings() {
  if (!currentLaunch) {
    const settings = await readSettings();
    if (!settings.discordEnabled) await disconnect();
    return { connected: Boolean(client), available: Boolean(DiscordRPC) };
  }
  return refreshDiscordPresence();
}

module.exports = { applyDiscordSettings, refreshDiscordPresence, disconnect, activityFor };
