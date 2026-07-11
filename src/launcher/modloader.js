'use strict';

/**
 * Backward-compatible facade for clients that used the original singular
 * `modloader` module. The launcher itself uses `modLoaders`, which also supports
 * NeoForge and runs the official Forge processors.
 */

const {
  FABRIC_META_URL,
  QUILT_META_URL,
  FORGE_PROMOTIONS_URL
} = require('../config');
const { fetchJson } = require('./downloader');
const {
  listLoaderVersions,
  installLoader,
  loaderVersionId,
  findInstalledLoaderProfile
} = require('./modLoaders');

async function safeFetch(url, label, fallback) {
  try { return await fetchJson(url, label); } catch (_) { return fallback; }
}

function listFabricLoaders() {
  return safeFetch(`${FABRIC_META_URL}/versions/loader`, 'Fabric loader versions', []);
}

function listFabricGameVersions() {
  return safeFetch(`${FABRIC_META_URL}/versions/game`, 'Fabric game versions', []);
}

function getFabricProfile(mcVersion, loaderVersion) {
  return fetchJson(
    `${FABRIC_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    `Fabric profile ${mcVersion}/${loaderVersion}`
  );
}

function listQuiltLoaders() {
  return safeFetch(`${QUILT_META_URL}/versions/loader`, 'Quilt loader versions', []);
}

function listQuiltGameVersions() {
  return safeFetch(`${QUILT_META_URL}/versions/game`, 'Quilt game versions', []);
}

function getQuiltProfile(mcVersion, loaderVersion) {
  return fetchJson(
    `${QUILT_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    `Quilt profile ${mcVersion}/${loaderVersion}`
  );
}

async function listForgeVersions() {
  const data = await safeFetch(FORGE_PROMOTIONS_URL, 'Forge promotions', {});
  return data.promos || {};
}

async function listModLoaders(mcVersion) {
  const entries = await Promise.all(
    ['fabric', 'forge', 'neoforge', 'quilt'].map(async (loader) => [
      loader,
      (await listLoaderVersions(loader, mcVersion)).versions || []
    ])
  );
  return Object.fromEntries(entries);
}

async function installModLoader(loaderType, loaderVersion, mcVersion, gameDir, options = {}) {
  const installed = await installLoader(loaderType, mcVersion, loaderVersion, { ...options, gameDir });
  return installed.profile || { id: installed.versionId };
}

async function installForgeVersion(mcVersion, forgeVersion, gameDir, options = {}) {
  return installModLoader('forge', forgeVersion, mcVersion, gameDir, options);
}

function modLoaderVersionId(loaderType, loaderVersion, mcVersion) {
  return loaderVersionId(loaderType || 'vanilla', mcVersion, loaderVersion);
}

async function resolveVersionChain(versionId, gameDir) {
  const { resolveVersionMeta } = require('./minecraft');
  const merged = await resolveVersionMeta(versionId, gameDir);
  const result = { ...merged };
  delete result.inheritsFrom;
  delete result.jar;
  return result;
}

function versionFromProfileId(loader, profileId, mcVersion) {
  if (!profileId) return '';
  if (loader === 'fabric') return profileId.replace(/^fabric-loader-/, '').replace(new RegExp(`-${escapeRegex(mcVersion)}$`), '');
  if (loader === 'quilt') return profileId.replace(/^quilt-loader-/, '').replace(new RegExp(`-${escapeRegex(mcVersion)}$`), '');
  if (loader === 'forge') return profileId.replace(`${mcVersion}-forge-`, '');
  if (loader === 'neoforge') return profileId.replace(/^neoforge-/, '');
  return profileId;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getInstalledLoaders(mcVersion, gameDir) {
  const installed = { fabric: null, quilt: null, forge: null, neoforge: null };
  for (const loader of Object.keys(installed)) {
    const versionId = await findInstalledLoaderProfile(loader, mcVersion, '', gameDir);
    if (versionId) {
      installed[loader] = {
        versionId,
        loaderVersion: versionFromProfileId(loader, versionId, mcVersion)
      };
    }
  }
  return installed;
}

module.exports = {
  listFabricLoaders,
  listFabricGameVersions,
  getFabricProfile,
  listQuiltLoaders,
  listQuiltGameVersions,
  getQuiltProfile,
  listForgeVersions,
  installForgeVersion,
  listModLoaders,
  installModLoader,
  modLoaderVersionId,
  resolveVersionChain,
  getInstalledLoaders
};
