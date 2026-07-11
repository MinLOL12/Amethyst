const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDataRoot } = require('../config');
const { ensureDir, readJson, writeJson } = require('./store');
const { fetchJson, downloadFile, progressBus } = require('./downloader');
// gamePaths moved to minecraftPaths in newer main, fallback to minecraft
let gamePaths;
try { ({ gamePaths } = require('./minecraftPaths')); } catch { ({ gamePaths } = require('./minecraft')); }
const { installVersion } = require('./minecraft');
const { readSettings } = require('./accounts');
const { pickJava, recommendedJavaRequirement } = require('./javaLocator');
const { runForgeInstaller, findInstalledLoaderVersion } = require('./forgeInstaller');

function modpacksRoot() {
  return path.join(getDataRoot(), 'modpacks');
}
function validatePackId(id) {
  const value = String(id || '');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw new Error('Invalid modpack id');
  return value;
}
function modpackDir(id) { return path.join(modpacksRoot(), validatePackId(id)); }
function modpackJsonPath(id) { return path.join(modpackDir(id), 'modpack.json'); }
function modpackGameDir(id) { return path.join(modpackDir(id), 'minecraft'); }
function modsFolder(id) { return path.join(modpackGameDir(id), 'mods'); }

async function ensurePackDirectories(id) {
  const gameDir = modpackGameDir(id);
  await Promise.all([
    ensureDir(modpackDir(id)),
    ensureDir(gameDir),
    ensureDir(modsFolder(id)),
    ensureDir(path.join(gameDir, 'config')),
    ensureDir(path.join(gameDir, 'resourcepacks')),
    ensureDir(path.join(gameDir, 'shaderpacks')),
    ensureDir(path.join(gameDir, 'saves')),
    ensureDir(path.join(gameDir, 'versions'))
  ]);
  return gameDir;
}

function slugify(name) {
  return String(name || 'modpack').toLowerCase().trim().replace(/[^a-z0-9_\-]+/g, '-').replace(/\-+/g, '-').replace(/^\-+|\-+$/g, '').slice(0,48) || 'modpack';
}
function newId(name) { const base=slugify(name); const suffix=crypto.randomBytes(3).toString('hex'); return `${base}-${suffix}`; }

async function listModpacks() {
  const root=modpacksRoot(); await ensureDir(root);
  let entries=[]; try{ entries=await fs.readdir(root,{withFileTypes:true}); }catch{ return []; }
  const packs=[];
  for(const ent of entries){ if(!ent.isDirectory()) continue; try{ const d=await getModpack(ent.name); if(d) packs.push(d);}catch{} }
  packs.sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt));
  return packs;
}
async function getModpack(id){
  const d=await readJson(modpackJsonPath(id),null);
  if(!d) throw new Error(`Modpack not found: ${id}`);
  await ensurePackDirectories(id);
  const gameDir=modpackGameDir(id);
  const modsDir=modsFolder(id);
  if(d.gameDir!==gameDir||d.modsDir!==modsDir){
    d.gameDir=gameDir;
    d.modsDir=modsDir;
    await writeJson(modpackJsonPath(id),d);
  }
  return d;
}
async function saveModpackFile(m){ m.updatedAt=new Date().toISOString(); await ensureDir(modpackDir(m.id)); await writeJson(modpackJsonPath(m.id),m); return m; }

async function createModpack({ name, minecraftVersion, loader, loaderVersion, description }) {
  if(!name||!name.trim()) throw new Error('Modpack name required');
  if(!minecraftVersion) throw new Error('Minecraft version required');
  let l=(loader||'vanilla').toLowerCase();
  const valid=['vanilla','fabric','forge','neoforge','quilt'];
  if(!valid.includes(l)) l='vanilla';
  const id=newId(name); const now=new Date().toISOString();
  const gameDir = await ensurePackDirectories(id);
  const manifest={ id, name:name.trim(), description:description||'', minecraftVersion, loader:l, loaderVersion:loaderVersion||null, createdAt:now, updatedAt:now, mods:[], gameDir, modsDir:modsFolder(id) };
  await saveModpackFile(manifest);
  return manifest;
}
async function deleteModpack(id){ await fs.rm(modpackDir(id),{recursive:true,force:true}); }
async function updateModpack(id,patch){
  const ex=await getModpack(id);
  const next={...ex,...patch,id:ex.id,gameDir:modpackGameDir(ex.id),modsDir:modsFolder(ex.id),updatedAt:new Date().toISOString()};
  // Mods are managed by the install/remove endpoints, never by an arbitrary
  // metadata patch.
  next.mods=ex.mods||[];
  await ensurePackDirectories(id);
  await writeJson(modpackJsonPath(id),next);
  return next;
}

// Loader helpers — use config URLs if available
function getFabricMeta(){ try{ return require('../config').FABRIC_META_URL || 'https://meta.fabricmc.net/v2'; }catch{ return 'https://meta.fabricmc.net/v2'; } }
function getQuiltMeta(){ try{ return require('../config').QUILT_META_URL || 'https://meta.quiltmc.org/v3'; }catch{ return 'https://meta.quiltmc.org/v3'; } }

async function fetchFabricLoaderVersions(mcVersion){
  if(!mcVersion){ const url=`${getFabricMeta()}/versions/loader`; const d=await fetchJson(url,'Fabric loader list'); return d; }
  const url=`${getFabricMeta()}/versions/loader/${encodeURIComponent(mcVersion)}`;
  return fetchJson(url, `Fabric loader for ${mcVersion}`);
}
async function fetchFabricProfile(mcVersion, loaderVersion){
  if(!loaderVersion){ const vers=await fetchFabricLoaderVersions(mcVersion); if(!vers.length) throw new Error(`No Fabric loader for ${mcVersion}`); loaderVersion=vers[0].loader.version; }
  const url=`${getFabricMeta()}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const profile=await fetchJson(url, `Fabric profile ${mcVersion} ${loaderVersion}`);
  return { profile, loaderVersion };
}
async function fetchQuiltLoaderVersions(mcVersion){
  const url= mcVersion ? `${getQuiltMeta()}/versions/loader/${encodeURIComponent(mcVersion)}` : `${getQuiltMeta()}/versions/loader`;
  return fetchJson(url, 'Quilt loader list');
}
async function fetchQuiltProfile(mcVersion, loaderVersion){
  if(!loaderVersion){ const vers=await fetchQuiltLoaderVersions(mcVersion); if(!vers.length) throw new Error(`No Quilt loader for ${mcVersion}`); loaderVersion=vers[0].loader.version; }
  const url=`${getQuiltMeta()}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const profile=await fetchJson(url, `Quilt profile ${mcVersion} ${loaderVersion}`);
  return { profile, loaderVersion };
}
async function fetchForgePromotions(){
  const url='https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
  try{ const data=await fetchJson(url,'Forge promotions'); return data.promos||{}; }catch{ return {}; }
}
async function fetchForgeVersions(mcVersion){
  // Try Maven metadata first — it is more complete and reliable than the
  // promotions endpoint, which has been known to lag or omit recent releases.
  try {
    const { FORGE_MAVEN_URL } = require('../config');
    const metaUrl = `${FORGE_MAVEN_URL}/net/minecraftforge/forge/maven-metadata.xml`;
    const response = await fetch(metaUrl, {
      headers: { 'User-Agent': 'AmethystLauncher/0.2' }
    });
    if (response.ok) {
      const xml = await response.text();
      const mavenVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map(m => m[1])
        .filter(v => v.startsWith(`${mcVersion}-`))
        .reverse();
      if (mavenVersions.length) {
        return mavenVersions.map(version => ({
          mcVersion,
          type: 'release',
          forgeVersion: version.slice(mcVersion.length + 1),
          id: version
        }));
      }
    }
  } catch (_) { /* fall through to promotions */ }

  // Fallback: the classic promotions endpoint.
  const promos=await fetchForgePromotions();
  const versions=[];
  for(const [key,ver] of Object.entries(promos)){
    if(!key.includes('-')) continue;
    const [mc,type]=key.split('-');
    if(mcVersion && mc!==mcVersion) continue;
    versions.push({ mcVersion:mc, type, forgeVersion:ver, id:`${mc}-${ver}` });
  }
  return versions.sort((a,b)=>b.forgeVersion.localeCompare(a.forgeVersion));
}
async function fetchNeoForgeVersions(){
  try{
    const url='https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
    const resp=await fetch(url,{headers:{'User-Agent':'AmethystLauncher/0.2'}});
    const text=await resp.text();
    const matches=[...text.matchAll(/<version>([^<]+)<\/version>/g)].map(m=>m[1]);
    return matches.slice(-100).reverse().map(v=>({ neoForgeVersion:v, id:v }));
  }catch{ return []; }
}

async function installModpack(id, options={}){
  const manifest=await getModpack(id);
  const gameDir=await ensurePackDirectories(id);
  const mcVersion=manifest.minecraftVersion;
  const loader=manifest.loader;
  const loaderVersion=manifest.loaderVersion;
  progressBus.emitEvent('status',{message:`Installing modpack ${manifest.name} (${mcVersion}) with ${loader}`});
  // A modpack manages its own loader below. Do not let the global Quick Launch
  // loader setting wrap the vanilla parent in a second, unrelated loader.
  const baseInstall=await installVersion(mcVersion,{
    ...options,
    gameDir,
    loader:'vanilla',
    loaderType:'vanilla',
    loaderVersion:''
  });
  let customVersionId=mcVersion;

  if(loader==='vanilla'){
    manifest.customVersionId=mcVersion; await saveModpackFile(manifest);
    return { manifest, versionMeta: baseInstall.versionMeta, paths: baseInstall.paths };
  }

  if(loader==='fabric'){
    const { profile, loaderVersion: resolved }=await fetchFabricProfile(mcVersion, loaderVersion);
    customVersionId=profile.id;
    const versionDir=path.join(gameDir,'versions',customVersionId);
    await ensureDir(versionDir);
    const customPaths=gamePaths(gameDir, customVersionId);
    await ensureDir(customPaths.libraries);
    await ensureDir(customPaths.versionDir || versionDir);
    await fs.writeFile(path.join(versionDir, `${customVersionId}.json`), JSON.stringify(profile,null,2));
    try{
      const { getLibraryDownloads } = require('./minecraft');
      const { downloads }=getLibraryDownloads(profile, customPaths);
      const { mapLimit } = require('./downloader');
      await mapLimit(downloads, 8, d=>downloadFile(d.url,d.destination,d));
    }catch{}
    manifest.loaderVersion=resolved; manifest.customVersionId=customVersionId; await saveModpackFile(manifest);
    return { manifest, versionMeta: profile, paths: customPaths };
  }

  if(loader==='quilt'){
    const { profile, loaderVersion: resolved }=await fetchQuiltProfile(mcVersion, loaderVersion);
    customVersionId=profile.id;
    const versionDir=path.join(gameDir,'versions',customVersionId);
    await ensureDir(versionDir);
    const customPaths=gamePaths(gameDir, customVersionId);
    await ensureDir(customPaths.libraries);
    await fs.writeFile(path.join(versionDir, `${customVersionId}.json`), JSON.stringify(profile,null,2));
    try{
      const { getLibraryDownloads } = require('./minecraft');
      const { downloads }=getLibraryDownloads(profile, customPaths);
      const { mapLimit } = require('./downloader');
      await mapLimit(downloads, 8, d=>downloadFile(d.url,d.destination,d));
    }catch{}
    manifest.loaderVersion=resolved; manifest.customVersionId=customVersionId; await saveModpackFile(manifest);
    return { manifest, versionMeta: profile, paths: customPaths };
  }

  if(loader==='forge' || loader==='neoforge'){
    const settings=await readSettings();
    let java=null;
    const javaRequirement=recommendedJavaRequirement(baseInstall.versionMeta);
    try{
      java=await pickJava(javaRequirement, options.javaPath||settings.javaPath);
    }catch{
      try{
        const jm=require('./javaManager');
        const list=await jm.listAllJava();
        java=list.find(item=>item.compatible!==false)||list[0];
      }catch{}
    }
    if(!java) throw new Error(`No compatible Java runtime found for the ${loader==='neoforge'?'NeoForge':'Forge'} installer (${javaRequirement.description}).`);

    let forgeVer=loaderVersion;
    // Older UI builds stored Forge's display id ("<mc>-<forge>") instead of
    // the Maven loader version. Accept those manifests so failed packs repair
    // themselves on the next install attempt.
    if(loader==='forge' && forgeVer && forgeVer.startsWith(`${mcVersion}-`)) forgeVer=forgeVer.slice(mcVersion.length+1);
    if(!forgeVer){
      if(loader==='forge'){
        const list=await fetchForgeVersions(mcVersion);
        const latest=list.find(v=>v.type==='recommended')||list.find(v=>v.type==='latest')||list[0];
        if(!latest) throw new Error(`No Forge version for ${mcVersion}`);
        forgeVer=latest.forgeVersion;
      }else{
        const list=await fetchNeoForgeVersions();
        if(!list.length) throw new Error('No NeoForge version');
        forgeVer=list[0].neoForgeVersion||list[0].id;
      }
    }

    const { FORGE_MAVEN_URL, NEOFORGE_MAVEN_URL } = require('../config');
    let installerUrl, fileName;
    if(loader==='forge'){
      fileName=`forge-${mcVersion}-${forgeVer}-installer.jar`;
      installerUrl=`${FORGE_MAVEN_URL}/net/minecraftforge/forge/${mcVersion}-${forgeVer}/${fileName}`;
    }else{
      fileName=`neoforge-${forgeVer}-installer.jar`;
      installerUrl=`${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/${forgeVer}/${fileName}`;
    }
    const installerPath=path.join(modpackDir(id), fileName);
    await downloadFile(installerUrl, installerPath, { label:`${loader} installer ${forgeVer}` });
    await runForgeInstaller({
      javaPath:java.path,
      installerPath,
      gameDir,
      cwd:modpackDir(id),
      loader,
      loaderVersion:forgeVer,
      minecraftVersion:mcVersion,
      modpackName:manifest.name
    });

    customVersionId=await findInstalledLoaderVersion(gameDir,{loader,loaderVersion:forgeVer});
    if(!customVersionId){
      throw new Error(`${loader==='neoforge'?'NeoForge':'Forge'} installer completed, but no matching ${forgeVer} version profile was created in ${path.join(gameDir,'versions')}.`);
    }
    const installedMeta=await readJson(path.join(gameDir,'versions',customVersionId,`${customVersionId}.json`),null);
    manifest.loaderVersion=forgeVer;
    manifest.customVersionId=customVersionId;
    await saveModpackFile(manifest);
    return { manifest, versionMeta:installedMeta, paths:gamePaths(gameDir,customVersionId) };
  }

  manifest.customVersionId=mcVersion; await saveModpackFile(manifest);
  return { manifest, versionMeta: baseInstall.versionMeta, paths: baseInstall.paths };
}

async function launchModpack(id, accountIdOrObj, options={}){
  let manifest=await getModpack(id);
  const gameDir=await ensurePackDirectories(id);

  // Never silently launch vanilla for a modded pack. If the user presses
  // Launch before Install (or the loader profile was removed), install/repair
  // the selected loader first so jars in mods/ are actually discovered.
  let loaderProfileExists=false;
  if(manifest.customVersionId){
    try{
      loaderProfileExists=(await fs.stat(path.join(gameDir,'versions',manifest.customVersionId,`${manifest.customVersionId}.json`))).isFile();
    }catch{}
  }
  if(manifest.loader!=='vanilla'&&(!manifest.customVersionId||!loaderProfileExists)){
    const installed=await installModpack(id,options);
    manifest=installed.manifest;
  }

  const versionToLaunch=manifest.customVersionId||manifest.minecraftVersion;
  if(!versionToLaunch) throw new Error('Modpack has no Minecraft version configured');

  // Resolve account id to object if needed (main's launchVersion expects accountId string)
  let accountId='';
  if(typeof accountIdOrObj==='string') accountId=accountIdOrObj;
  else if(accountIdOrObj && accountIdOrObj.id) accountId=accountIdOrObj.id;
  else if(options.accountId) accountId=options.accountId;

  // Always use the normal launch pipeline. It resolves inheritsFrom metadata,
  // picks the parent client jar, validates Microsoft sessions, and keeps the
  // working directory on this pack. The old Fabric/Quilt shortcut launched
  // the raw child profile with a non-existent child client jar.
  const { launchVersion } = require('./minecraft');
  return launchVersion(versionToLaunch, accountId, {
    ...options,
    gameDir,
    loader: 'vanilla',
    loaderType: 'vanilla',
    loaderVersion: '',
    persistLoader: false
  });
}

async function listMods(id){
  const manifest=await getModpack(id);
  await ensurePackDirectories(id);
  return Promise.all((manifest.mods||[]).map(async (entry) => {
    try {
      const stat=await fs.stat(path.join(modsFolder(id),entry.fileName));
      return {...entry,installed:stat.isFile()&&stat.size>0,sizeOnDisk:stat.size};
    } catch {
      return {...entry,installed:false,sizeOnDisk:0};
    }
  }));
}

function validatedModDownload(modInfo) {
  const fileName=String(modInfo.fileName||'').trim();
  if(!fileName || fileName!==path.basename(fileName) || /[\\/\0]/.test(fileName)) throw new Error('Invalid mod file name');
  if(!/\.jar$/i.test(fileName)) throw new Error('Mods must be downloadable .jar files');
  let fileUrl;
  try { fileUrl=new URL(String(modInfo.fileUrl||'')); } catch { throw new Error('Invalid mod download URL'); }
  if(fileUrl.protocol!=='https:') throw new Error('Mod download URLs must use HTTPS');
  return {fileName,fileUrl:fileUrl.toString()};
}

async function addModToPack(id, modInfo){
  const manifest=await getModpack(id);
  await ensurePackDirectories(id);
  const {fileName,fileUrl}=validatedModDownload(modInfo);
  const modsDir=modsFolder(id);
  const destPath=path.join(modsDir,fileName);
  await downloadFile(fileUrl,destPath,{label:fileName,size:modInfo.size});
  const downloaded=await fs.stat(destPath);
  if(!downloaded.isFile()||downloaded.size===0) throw new Error(`Downloaded mod is empty: ${fileName}`);

  const previous=(manifest.mods||[]).filter(m=>m.projectId===modInfo.projectId);
  const entry={id:crypto.randomBytes(8).toString('hex'),source:modInfo.source,projectId:modInfo.projectId,projectSlug:modInfo.projectSlug||modInfo.projectId,title:modInfo.title||fileName,versionId:modInfo.versionId,fileName,fileUrl,installedAt:new Date().toISOString(),installed:true,sizeOnDisk:downloaded.size};
  manifest.mods=(manifest.mods||[]).filter(m=>m.projectId!==entry.projectId&&m.fileName!==fileName);
  manifest.mods.push(entry);
  await saveModpackFile(manifest);

  // Remove an older jar only after the replacement has downloaded and the
  // manifest has been saved, so a failed update never leaves the pack empty.
  for(const old of previous){
    if(old.fileName!==fileName) await fs.rm(path.join(modsDir,old.fileName),{force:true}).catch(()=>{});
  }
  return entry;
}
async function removeModFromPack(modpackId, modEntryId){
  const manifest=await getModpack(modpackId);
  const entry=(manifest.mods||[]).find(m=>m.id===modEntryId||m.fileName===modEntryId);
  if(!entry) throw new Error('Mod not found in pack');
  const filePath=path.join(modsFolder(modpackId), entry.fileName);
  try{ await fs.rm(filePath,{force:true}); }catch{}
  manifest.mods=manifest.mods.filter(m=>m.id!==entry.id);
  await saveModpackFile(manifest);
  return manifest.mods;
}

module.exports={
  modpacksRoot, modpackDir, modpackGameDir, modsFolder, ensurePackDirectories, validatePackId,
  listModpacks, getModpack, createModpack, deleteModpack, updateModpack,
  installModpack, launchModpack, listMods, addModToPack, removeModFromPack, validatedModDownload,
  fetchFabricLoaderVersions, fetchFabricProfile, fetchQuiltLoaderVersions, fetchQuiltProfile,
  fetchForgeVersions, fetchForgePromotions, fetchNeoForgeVersions
};
