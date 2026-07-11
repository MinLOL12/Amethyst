const path = require('node:path');
const { MOJANG_MANIFEST_URL } = require('../config');
const { fetchJson, progressBus } = require('./downloader');

const FALLBACK_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

let manifestCache = null;
let manifestFetchedAt = 0;

async function getVersionManifest(force = false) {
  const ageMs = Date.now() - manifestFetchedAt;
  if (!force && manifestCache && ageMs < 5 * 60 * 1000) return manifestCache;

  try {
    manifestCache = await fetchJson(MOJANG_MANIFEST_URL, 'official Minecraft version manifest');
  } catch (error) {
    progressBus.emitEvent('status', {
      message: `Primary manifest failed (${error.message}). Trying fallback mirror...`
    });
    manifestCache = await fetchJson(FALLBACK_MANIFEST_URL, 'fallback Minecraft version manifest');
  }
  manifestFetchedAt = Date.now();
  return manifestCache;
}

async function listVersions() {
  const manifest = await getVersionManifest();
  return {
    latest: manifest.latest,
    versions: manifest.versions.map((version) => ({
      id: version.id,
      type: version.type,
      url: version.url,
      time: version.time,
      releaseTime: version.releaseTime
    }))
  };
}

async function getVersionMeta(versionId) {
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((version) => version.id === versionId);
  if (!entry) throw new Error(`Unknown Minecraft version: ${versionId}`);
  return fetchJson(entry.url, `Minecraft ${versionId} metadata`);
}

function artifactPathFromName(name) {
  const [group, artifact, version, classifier] = name.split(':');
  if (!group || !artifact || !version) return null;
  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`;
  return path.join(...group.split('.'), artifact, version, fileName);
}

module.exports = {
  getVersionManifest,
  listVersions,
  getVersionMeta,
  artifactPathFromName
};
