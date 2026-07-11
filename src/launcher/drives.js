const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(1)} ${units[i]}`;
}

async function getDiskSpace(dirPath) {
  try {
    if (process.platform === 'win32') {
      const drive = dirPath.charAt(0).toUpperCase() + ':';
      const output = execSync(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace,Size /format:csv`, {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      }).trim();
      const lines = output.split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        const parts = lines[1].split(',').map(s => s.trim());
        // CSV: Node,FreeSpace,Size
        const free = parseInt(parts[1]) || 0;
        const total = parseInt(parts[2]) || 0;
        return { total, free };
      }
    } else {
      const output = execSync(`df -B1 "${dirPath.replace(/"/g, '\\"')}" 2>/dev/null | tail -1`, {
        encoding: 'utf8',
        timeout: 5000
      }).trim();
      const parts = output.split(/\s+/);
      if (parts.length >= 4) {
        return { total: parseInt(parts[1]) || 0, free: parseInt(parts[3]) || 0 };
      }
    }
  } catch {
    // Ignore errors
  }
  return { total: 0, free: 0 };
}

async function listDrives() {
  const drives = [];

  if (process.platform === 'win32') {
    // On Windows, enumerate available drive letters
    try {
      const output = execSync('wmic logicaldisk get DeviceID,DriveType,Size,FreeSpace,VolumeName /format:csv', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      }).trim();

      const lines = output.split('\n').filter(l => l.trim());
      // Skip header
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim());
        // CSV: Node,DeviceID,DriveType,FreeSpace,Size,VolumeName
        if (parts.length >= 4 && parts[1]) {
          const driveLetter = parts[1];
          const total = parseInt(parts[4]) || 0;
          const free = parseInt(parts[3]) || 0;
          const volumeName = parts[5] || driveLetter;
          const driveType = parseInt(parts[2]) || 0;
          // DriveType 3 = Local Disk, 2 = Removable, etc.
          if (driveType === 2 || driveType === 3) {
            drives.push({
              path: driveLetter + '\\',
              label: volumeName !== driveLetter ? `${volumeName} (${driveLetter})` : driveLetter,
              total,
              free,
              totalFormatted: formatBytes(total),
              freeFormatted: formatBytes(free),
              isDefault: false
            });
          }
        }
      }
    } catch {
      // Fallback: try to list common drives
      for (const letter of 'CDEFGHIJ') {
        const drivePath = `${letter}:\\`;
        try {
          fs.accessSync(drivePath);
          drives.push({
            path: drivePath,
            label: `${letter}:`,
            total: 0,
            free: 0,
            totalFormatted: 'Unknown',
            freeFormatted: 'Unknown',
            isDefault: false
          });
        } catch {}
      }
    }
  } else if (process.platform === 'darwin') {
    // On macOS, list /Volumes
    try {
      const volumes = fs.readdirSync('/Volumes');
      for (const vol of volumes) {
        if (vol === 'dev' || vol.startsWith('.')) continue;
        const volPath = `/Volumes/${vol}`;
        try {
          fs.accessSync(volPath);
          const space = await getDiskSpace(volPath);
          drives.push({
            path: volPath,
            label: vol,
            total: space.total,
            free: space.free,
            totalFormatted: formatBytes(space.total),
            freeFormatted: formatBytes(space.free),
            isDefault: false
          });
        } catch {}
      }
    } catch {}

    // Also add home directory
    const homePath = os.homedir();
    const homeSpace = await getDiskSpace(homePath);
    drives.push({
      path: homePath,
      label: `Home (${path.basename(homePath)})`,
      total: homeSpace.total,
      free: homeSpace.free,
      totalFormatted: formatBytes(homeSpace.total),
      freeFormatted: formatBytes(homeSpace.free),
      isDefault: true
    });
  } else {
    // Linux: read mount points
    try {
      const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n');
      const seenPaths = new Set();
      const skipFs = new Set(['tmpfs', 'devtmpfs', 'sysfs', 'proc', 'devpts', 'cgroup', 'cgroup2', 'securityfs', 'pstore', 'debugfs', 'tracefs', 'bpf', 'autofs', 'mqueue', 'hugetlbfs', 'fusectl']);

      for (const line of mounts) {
        const parts = line.split(/\s+/);
        if (parts.length < 3) continue;
        const [device, mountPoint, fsType] = parts;
        if (skipFs.has(fsType)) continue;
        if (!mountPoint.startsWith('/')) continue;
        if (seenPaths.has(mountPoint)) continue;

        // Skip very nested or system-only mounts
        const depth = mountPoint.split('/').length;
        if (depth > 4 && mountPoint !== os.homedir()) continue;

        seenPaths.add(mountPoint);
        try {
          fs.accessSync(mountPoint);
          const space = await getDiskSpace(mountPoint);
          const label = mountPoint === '/' ? 'Root (/)' :
                        mountPoint === os.homedir() ? `Home (${path.basename(os.homedir())})` :
                        mountPoint;
          drives.push({
            path: mountPoint,
            label,
            total: space.total,
            free: space.free,
            totalFormatted: formatBytes(space.total),
            freeFormatted: formatBytes(space.free),
            isDefault: mountPoint === os.homedir() || (mountPoint === '/' && drives.length === 0)
          });
        } catch {}
      }
    } catch {}

    // Ensure at least home is there
    if (drives.length === 0) {
      const homePath = os.homedir();
      const homeSpace = await getDiskSpace(homePath);
      drives.push({
        path: homePath,
        label: `Home (${path.basename(homePath)})`,
        total: homeSpace.total,
        free: homeSpace.free,
        totalFormatted: formatBytes(homeSpace.total),
        freeFormatted: formatBytes(homeSpace.free),
        isDefault: true
      });
    }
  }

  // Mark the default game dir's drive
  const { getDataRoot } = require('../config');
  const dataRoot = getDataRoot();
  for (const drive of drives) {
    if (dataRoot.startsWith(drive.path)) {
      drive.isDefault = true;
    }
  }

  return drives;
}

module.exports = { listDrives, formatBytes };
