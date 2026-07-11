const path = require('node:path');

function gamePaths(gameDir, versionId) {
  return {
    root: gameDir,
    versions: path.join(gameDir, 'versions'),
    versionDir: path.join(gameDir, 'versions', versionId),
    versionJson: path.join(gameDir, 'versions', versionId, `${versionId}.json`),
    clientJar: path.join(gameDir, 'versions', versionId, `${versionId}.jar`),
    libraries: path.join(gameDir, 'libraries'),
    assets: path.join(gameDir, 'assets'),
    assetIndexes: path.join(gameDir, 'assets', 'indexes'),
    assetObjects: path.join(gameDir, 'assets', 'objects'),
    natives: path.join(gameDir, 'versions', versionId, 'natives'),
    mods: path.join(gameDir, 'mods'),
    saves: path.join(gameDir, 'saves'),
    screenshots: path.join(gameDir, 'screenshots'),
    resourcepacks: path.join(gameDir, 'resourcepacks'),
    logs: path.join(gameDir, 'logs'),
    crashReports: path.join(gameDir, 'crash-reports')
  };
}

module.exports = { gamePaths };
