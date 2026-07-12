const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { getDataRoot } = require('../config');
const { ensureDir, readJson, writeJson } = require('./store');
const downloader = require('./downloader');
function fetchJson(...args) { return downloader.fetchJson(...args); }
function downloadFile(...args) { return downloader.downloadFile(...args); }
const progressBus = { emitEvent(...args) { return downloader.progressBus.emitEvent(...args); } };
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
  const manifest={ id, name:name.trim(), description:description||'', minecraftVersion, loader:l, loaderVersion:loaderVersion||null, createdAt:now, updatedAt:now, mods:[], resourcepacks:[], shaderpacks:[], gameDir, modsDir:modsFolder(id) };
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
  next.resourcepacks=ex.resourcepacks||[];
  next.shaderpacks=ex.shaderpacks||[];
  await ensurePackDirectories(id);
  await writeJson(modpackJsonPath(id),next);
  return next;
}

// Loader helpers — use config URLs if available
function getFabricMeta(){ try{ return require('../config').FABRIC_META_URL || 'https://meta.fabricmc.net/v2'; }catch{ return 'https://meta.fabricmc.net/v2'; } }
function getQuiltMeta(){ try{ return require('../config').QUILT_META_URL || 'https://meta.quiltmc.org/v3'; }catch{ return 'https://meta.quiltmc.org/v3'; } }

async function fetchFabricLoaderVersions(mcVersion){
  try {
    if(!mcVersion){ const url=`${getFabricMeta()}/versions/loader`; const d=await fetchJson(url,'Fabric loader list'); return d; }
    const url=`${getFabricMeta()}/versions/loader/${encodeURIComponent(mcVersion)}`;
    return await fetchJson(url, `Fabric loader for ${mcVersion}`);
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Fabric loader versions for ${mcVersion || 'all versions'}: ${error.message}` });
    throw error;
  }
}
async function fetchFabricProfile(mcVersion, loaderVersion){
  try {
    if(!loaderVersion){ const vers=await fetchFabricLoaderVersions(mcVersion); if(!vers.length) throw new Error(`No Fabric loader for ${mcVersion}`); loaderVersion=vers[0].loader.version; }
    const url=`${getFabricMeta()}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
    const profile=await fetchJson(url, `Fabric profile ${mcVersion} ${loaderVersion}`);
    return { profile, loaderVersion };
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Fabric profile for ${mcVersion} ${loaderVersion}: ${error.message}` });
    throw error;
  }
}
async function fetchQuiltLoaderVersions(mcVersion){
  try {
    const url= mcVersion ? `${getQuiltMeta()}/versions/loader/${encodeURIComponent(mcVersion)}` : `${getQuiltMeta()}/versions/loader`;
    return await fetchJson(url, 'Quilt loader list');
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Quilt loader versions for ${mcVersion || 'all versions'}: ${error.message}` });
    throw error;
  }
}
async function fetchQuiltProfile(mcVersion, loaderVersion){
  try {
    if(!loaderVersion){ const vers=await fetchQuiltLoaderVersions(mcVersion); if(!vers.length) throw new Error(`No Quilt loader for ${mcVersion}`); loaderVersion=vers[0].loader.version; }
    const url=`${getQuiltMeta()}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
    const profile=await fetchJson(url, `Quilt profile ${mcVersion} ${loaderVersion}`);
    return { profile, loaderVersion };
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Quilt profile for ${mcVersion} ${loaderVersion}: ${error.message}` });
    throw error;
  }
}
async function fetchForgePromotions(){
  try {
    const url='https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
    const data=await fetchJson(url,'Forge promotions');
    return data.promos||{};
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Forge promotions: ${error.message}. Using Maven metadata instead.` });
    return {};
  }
}
async function fetchForgeVersions(mcVersion){
  // Try Maven metadata first — it is more complete and reliable than the
  // promotions endpoint, which has been known to lag or omit recent releases.
  try {
    const { FORGE_MAVEN_URL } = require('../config');
    const metaUrl = `${FORGE_MAVEN_URL}/net/minecraftforge/forge/maven-metadata.xml`;
    const response = await fetch(metaUrl, {
      headers: { 'User-Agent': 'AmethystLauncher/0.2' },
      redirect: 'follow'
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
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Forge Maven metadata for ${mcVersion}: ${error.message}. Trying promotions endpoint...` });
    /* fall through to promotions */
  }

  // Fallback: the classic promotions endpoint.
  try {
    const promos=await fetchForgePromotions();
    const versions=[];
    for(const [key,ver] of Object.entries(promos)){
      if(!key.includes('-')) continue;
      const [mc,type]=key.split('-');
      if(mcVersion && mc!==mcVersion) continue;
      versions.push({ mcVersion:mc, type, forgeVersion:ver, id:`${mc}-${ver}` });
    }
    return versions.sort((a,b)=>b.forgeVersion.localeCompare(a.forgeVersion));
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Forge versions for ${mcVersion}: ${error.message}` });
    return [];
  }
}
async function fetchNeoForgeVersions(){
  try{
    const url='https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
    const resp=await fetch(url,{headers:{'User-Agent':'AmethystLauncher/0.2'}, redirect: 'follow'});
    if (!resp.ok) {
      const error = new Error(`NeoForge metadata HTTP ${resp.status}`);
      error.status = resp.status;
      throw error;
    }
    const text=await resp.text();
    const matches=[...text.matchAll(/<version>([^<]+)<\/version>/g)].map(m=>m[1]);
    return matches.slice(-100).reverse().map(v=>({ neoForgeVersion:v, id:v }));
  }catch(error){
    progressBus.emitEvent('status', { message: `Failed to fetch NeoForge versions: ${error.message}` });
    return [];
  }
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

async function addModToPack(id, modInfo, context = {}){
  const manifest=await getModpack(id);
  await ensurePackDirectories(id);
  const seen=context.seen || new Set();
  let dependenciesInstalled=0;

  if(modInfo.source === 'modrinth' && modInfo.versionId && modInfo.autoInstallDependencies !== false && !seen.has(String(modInfo.versionId))){
    seen.add(String(modInfo.versionId));
    try{
      const depResult=await installRequiredModrinthDependencies(id, modInfo, seen);
      dependenciesInstalled += depResult.installed || 0;
    }catch(error){
      progressBus.emitEvent('status',{message:`Failed to auto-install dependencies for ${modInfo.title || modInfo.fileName}: ${error.message}`});
      throw error;
    }
  }

  const current=await getModpack(id);
  if(modInfo.versionId){
    const existing=(current.mods||[]).find(m=>m.versionId===modInfo.versionId && m.installed!==false);
    if(existing) return {...existing, dependenciesInstalled};
  }

  const {fileName,fileUrl}=validatedModDownload(modInfo);
  const modsDir=modsFolder(id);
  const destPath=path.join(modsDir,fileName);
  await downloadFile(fileUrl,destPath,{label:fileName,size:modInfo.size});
  const downloaded=await fs.stat(destPath);
  if(!downloaded.isFile()||downloaded.size===0) throw new Error(`Downloaded mod is empty: ${fileName}`);

  const fresh=await getModpack(id);
  const previous=(fresh.mods||[]).filter(m=>m.projectId===modInfo.projectId);
  const entry={id:crypto.randomBytes(8).toString('hex'),source:modInfo.source,projectId:modInfo.projectId || `manual:${fileName}`,projectSlug:modInfo.projectSlug||modInfo.projectId||fileName,title:modInfo.title||fileName,versionId:modInfo.versionId,fileName,fileUrl,installedAt:new Date().toISOString(),installed:true,sizeOnDisk:downloaded.size};
  fresh.mods=(fresh.mods||[]).filter(m=>m.projectId!==entry.projectId&&m.fileName!==fileName);
  fresh.mods.push(entry);
  await saveModpackFile(fresh);

  // Remove an older jar only after the replacement has downloaded and the
  // manifest has been saved, so a failed update never leaves the pack empty.
  for(const old of previous){
    if(old.fileName!==fileName) await fs.rm(path.join(modsDir,old.fileName),{force:true}).catch(()=>{});
  }
  return {...entry, dependenciesInstalled};
}

async function installRequiredModrinthDependencies(id, modInfo, seen){
  const modrinth=require('./modrinth');
  const version=await modrinth.getVersion(modInfo.versionId);
  const deps=(version.dependencies||[]).filter(dep=>dep.dependency_type === 'required');
  let installed=0;
  for(const dep of deps){
    let depVersion=null;
    if(dep.version_id){
      if(seen.has(String(dep.version_id))) continue;
      depVersion=await modrinth.getVersion(dep.version_id);
    }else if(dep.project_id){
      const versions=await modrinth.getProjectVersions(dep.project_id, {
        loaders: modInfo.loader && modInfo.loader !== 'vanilla' ? [modInfo.loader] : [],
        gameVersions: modInfo.gameVersion ? [modInfo.gameVersion] : []
      });
      depVersion=versions && versions[0];
    }
    if(!depVersion || seen.has(String(depVersion.id))) continue;
    const file=(depVersion.files||[]).find(f=>f.primary) || (depVersion.files||[])[0];
    if(!file) continue;
    const projectId=dep.project_id || depVersion.project_id;
    const project=projectId ? await modrinth.getProject(projectId).catch(()=>null) : null;
    const result=await addModToPack(id, {
      source:'modrinth',
      projectId: projectId || depVersion.project_id || depVersion.id,
      projectSlug: project?.slug || projectId || depVersion.id,
      title: project?.title || depVersion.name || file.filename,
      versionId: depVersion.id,
      fileName: file.filename,
      fileUrl: file.url,
      size: file.size,
      loader: modInfo.loader,
      gameVersion: modInfo.gameVersion,
      autoInstallDependencies: true
    }, { seen });
    installed += 1 + (result.dependenciesInstalled || 0);
  }
  return { installed };
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

function safeRelativePath(value){
  const rel=String(value||'').replace(/\\/g,'/').replace(/^\/+/, '');
  if(!rel || rel.includes('\0') || rel.split('/').includes('..')) throw new Error(`Unsafe archive path: ${value}`);
  return rel;
}

async function addLocalModToPack(id, { filePath, fileUrl } = {}){
  if(fileUrl){
    let url;
    try{ url=new URL(String(fileUrl)); }catch{ throw new Error('Invalid .jar URL'); }
    const fileName=path.basename(url.pathname);
    return addModToPack(id,{source:'manual',projectId:`manual:${fileName}`,projectSlug:'manual',title:fileName,fileName,fileUrl:url.toString(),autoInstallDependencies:false});
  }
  const source=String(filePath||'').trim();
  if(!source) throw new Error('filePath or fileUrl is required');
  const fileName=path.basename(source);
  if(!/\.jar$/i.test(fileName)) throw new Error('Only .jar files can be added manually');
  await ensurePackDirectories(id);
  const dest=path.join(modsFolder(id), fileName);
  if(path.resolve(source) !== path.resolve(dest)) await fs.copyFile(source,dest);
  const stat=await fs.stat(dest);
  const manifest=await getModpack(id);
  const entry={id:crypto.randomBytes(8).toString('hex'),source:'manual',projectId:`manual:${fileName}`,projectSlug:'manual',title:fileName,versionId:null,fileName,fileUrl:null,installedAt:new Date().toISOString(),installed:true,sizeOnDisk:stat.size};
  manifest.mods=(manifest.mods||[]).filter(m=>m.fileName!==fileName&&m.projectId!==entry.projectId);
  manifest.mods.push(entry);
  await saveModpackFile(manifest);
  return entry;
}

function resourcepacksFolder(id){ return path.join(modpackGameDir(id), 'resourcepacks'); }

async function listResourcePacks(id){
  const manifest=await getModpack(id);
  await ensurePackDirectories(id);
  await ensureDir(resourcepacksFolder(id));
  return Promise.all((manifest.resourcepacks||[]).map(async entry=>{
    try{ const stat=await fs.stat(path.join(resourcepacksFolder(id),entry.fileName)); return {...entry,installed:stat.isFile()&&stat.size>0,sizeOnDisk:stat.size}; }
    catch{ return {...entry,installed:false,sizeOnDisk:0}; }
  }));
}

async function addResourcePackToPack(id, resourceInfo){
  const manifest=await getModpack(id);
  await ensurePackDirectories(id);
  await ensureDir(resourcepacksFolder(id));
  const fileName=String(resourceInfo.fileName||'').trim();
  if(!fileName || fileName!==path.basename(fileName) || /[\\/\0]/.test(fileName)) throw new Error('Invalid resource pack file name');
  if(!/\.(zip|jar)$/i.test(fileName)) throw new Error('Resource packs must be .zip or .jar files');
  let fileUrl;
  try{ fileUrl=new URL(String(resourceInfo.fileUrl||'')); }catch{ throw new Error('Invalid resource pack URL'); }
  if(fileUrl.protocol!=='https:') throw new Error('Resource pack URLs must use HTTPS');
  const dest=path.join(resourcepacksFolder(id),fileName);
  await downloadFile(fileUrl.toString(),dest,{label:fileName,size:resourceInfo.size});
  const stat=await fs.stat(dest);
  const entry={id:crypto.randomBytes(8).toString('hex'),source:resourceInfo.source||'modrinth',projectId:resourceInfo.projectId,projectSlug:resourceInfo.projectSlug||resourceInfo.projectId,title:resourceInfo.title||fileName,versionId:resourceInfo.versionId,fileName,fileUrl:fileUrl.toString(),installedAt:new Date().toISOString(),installed:true,sizeOnDisk:stat.size};
  manifest.resourcepacks=(manifest.resourcepacks||[]).filter(r=>r.projectId!==entry.projectId&&r.fileName!==fileName);
  manifest.resourcepacks.push(entry);
  await saveModpackFile(manifest);
  return entry;
}

async function removeResourcePackFromPack(modpackId, resourceId){
  const manifest=await getModpack(modpackId);
  const entry=(manifest.resourcepacks||[]).find(r=>r.id===resourceId||r.fileName===resourceId);
  if(!entry) throw new Error('Resource pack not found');
  await fs.rm(path.join(resourcepacksFolder(modpackId),entry.fileName),{force:true}).catch(()=>{});
  manifest.resourcepacks=(manifest.resourcepacks||[]).filter(r=>r.id!==entry.id);
  await saveModpackFile(manifest);
  return manifest.resourcepacks;
}

function shaderpacksFolder(id){ return path.join(modpackGameDir(id), 'shaderpacks'); }

async function listShaderPacks(id){
  const manifest=await getModpack(id);
  await ensurePackDirectories(id);
  await ensureDir(shaderpacksFolder(id));
  return Promise.all((manifest.shaderpacks||[]).map(async entry=>{
    try{ const stat=await fs.stat(path.join(shaderpacksFolder(id),entry.fileName)); return {...entry,installed:stat.isFile()&&stat.size>0,sizeOnDisk:stat.size}; }
    catch{ return {...entry,installed:false,sizeOnDisk:0}; }
  }));
}

async function addShaderPackToPack(id, shaderInfo){
  const manifest=await getModpack(id);
  await ensurePackDirectories(id);
  await ensureDir(shaderpacksFolder(id));
  const fileName=String(shaderInfo.fileName||'').trim();
  if(!fileName || fileName!==path.basename(fileName) || /[\\/\0]/.test(fileName)) throw new Error('Invalid shader pack file name');
  if(!/\.(zip|jar)$/i.test(fileName)) throw new Error('Shader packs must be .zip or .jar files');
  let fileUrl;
  try{ fileUrl=new URL(String(shaderInfo.fileUrl||'')); }catch{ throw new Error('Invalid shader pack URL'); }
  if(fileUrl.protocol!=='https:') throw new Error('Shader pack URLs must use HTTPS');
  const dest=path.join(shaderpacksFolder(id),fileName);
  await downloadFile(fileUrl.toString(),dest,{label:fileName,size:shaderInfo.size});
  const stat=await fs.stat(dest);
  const entry={id:crypto.randomBytes(8).toString('hex'),source:shaderInfo.source||'modrinth',projectId:shaderInfo.projectId,projectSlug:shaderInfo.projectSlug||shaderInfo.projectId,title:shaderInfo.title||fileName,versionId:shaderInfo.versionId,fileName,fileUrl:fileUrl.toString(),installedAt:new Date().toISOString(),installed:true,sizeOnDisk:stat.size};
  manifest.shaderpacks=(manifest.shaderpacks||[]).filter(s=>s.projectId!==entry.projectId&&s.fileName!==fileName);
  manifest.shaderpacks.push(entry);
  await saveModpackFile(manifest);
  return entry;
}

async function removeShaderPackFromPack(modpackId, shaderId){
  const manifest=await getModpack(modpackId);
  const entry=(manifest.shaderpacks||[]).find(s=>s.id===shaderId||s.fileName===shaderId);
  if(!entry) throw new Error('Shader pack not found');
  await fs.rm(path.join(shaderpacksFolder(modpackId),entry.fileName),{force:true}).catch(()=>{});
  manifest.shaderpacks=(manifest.shaderpacks||[]).filter(s=>s.id!==entry.id);
  await saveModpackFile(manifest);
  return manifest.shaderpacks;
}

async function readSourceBuffer({ sourceUrl, filePath }, label='modpack'){
  if(sourceUrl){
    const url=new URL(String(sourceUrl));
    if(url.protocol !== 'https:') throw new Error('Import URLs must use HTTPS');
    progressBus.emitEvent('status',{message:`Downloading ${label}`});
    const res=await fetch(url,{headers:{'User-Agent':'AmethystLauncher/0.2'},redirect:'follow'});
    if(!res.ok) throw new Error(`${label} failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if(filePath) return fs.readFile(filePath);
  throw new Error('sourceUrl or filePath is required');
}

function parseZip(buffer){
  const eocdSig=0x06054b50;
  let eocd=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-66000);i--){ if(buffer.readUInt32LE(i)===eocdSig){ eocd=i; break; } }
  if(eocd<0) throw new Error('Invalid zip/mrpack: end of central directory not found');
  const total=buffer.readUInt16LE(eocd+10);
  const cdOffset=buffer.readUInt32LE(eocd+16);
  let ptr=cdOffset;
  const entries=new Map();
  for(let i=0;i<total;i++){
    if(buffer.readUInt32LE(ptr)!==0x02014b50) throw new Error('Invalid zip central directory');
    const method=buffer.readUInt16LE(ptr+10);
    const compressedSize=buffer.readUInt32LE(ptr+20);
    const nameLen=buffer.readUInt16LE(ptr+28);
    const extraLen=buffer.readUInt16LE(ptr+30);
    const commentLen=buffer.readUInt16LE(ptr+32);
    const localOffset=buffer.readUInt32LE(ptr+42);
    const name=buffer.slice(ptr+46,ptr+46+nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;
    if(name.endsWith('/')) continue;
    if(buffer.readUInt32LE(localOffset)!==0x04034b50) throw new Error(`Invalid zip local header for ${name}`);
    const localNameLen=buffer.readUInt16LE(localOffset+26);
    const localExtraLen=buffer.readUInt16LE(localOffset+28);
    const dataStart=localOffset+30+localNameLen+localExtraLen;
    const raw=buffer.slice(dataStart,dataStart+compressedSize);
    let data;
    if(method===0) data=raw;
    else if(method===8) data=zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    entries.set(name,data);
  }
  return entries;
}

function loaderFromMrpackDependencies(deps={}){
  if(deps['fabric-loader']) return { loader:'fabric', loaderVersion:deps['fabric-loader'] };
  if(deps.forge) return { loader:'forge', loaderVersion:deps.forge };
  if(deps.neoforge) return { loader:'neoforge', loaderVersion:deps.neoforge };
  if(deps['quilt-loader']) return { loader:'quilt', loaderVersion:deps['quilt-loader'] };
  return { loader:'vanilla', loaderVersion:null };
}

async function importMrpack(source, extra={}){
  const buffer=await readSourceBuffer(source, extra.label || 'Modrinth modpack');
  const entries=parseZip(buffer);
  const indexRaw=entries.get('modrinth.index.json');
  if(!indexRaw) throw new Error('This file is not a Modrinth .mrpack (missing modrinth.index.json)');
  const index=JSON.parse(indexRaw.toString('utf8'));
  const deps=index.dependencies||{};
  const { loader, loaderVersion }=loaderFromMrpackDependencies(deps);
  const manifest=await createModpack({
    name: extra.name || index.name || 'Imported modpack',
    description: extra.description || index.summary || `Imported from ${source.sourceUrl || source.filePath || 'mrpack'}`,
    minecraftVersion: deps.minecraft,
    loader,
    loaderVersion
  });
  const gameDir=await ensurePackDirectories(manifest.id);
  for(const [name,data] of entries){
    if(!name.startsWith('overrides/')) continue;
    const rel=safeRelativePath(name.slice('overrides/'.length));
    const dest=path.join(gameDir,rel);
    await ensureDir(path.dirname(dest));
    await fs.writeFile(dest,data);
  }
  const { mapLimit }=require('./downloader');
  const installedMods=[];
  const installedShaderPacks=[];
  const installedResourcePacks=[];
  const files=(index.files||[]).filter(file=>file?.env?.client !== 'unsupported');
  await mapLimit(files, 6, async file=>{
    const rel=safeRelativePath(file.path);
    const dest=path.join(gameDir,rel);
    await ensureDir(path.dirname(dest));
    const url=(file.downloads||[])[0];
    if(!url) throw new Error(`No download URL for ${file.path}`);
    await downloadFile(url,dest,{label:path.basename(rel),size:file.fileSize,sha1:file.hashes?.sha1});
    if(rel.toLowerCase().startsWith('mods/') && /\.jar$/i.test(rel)){
      const stat=await fs.stat(dest);
      installedMods.push({id:crypto.randomBytes(8).toString('hex'),source:'modrinth-pack',projectId:`pack:${rel}`,projectSlug:'modrinth-pack',title:path.basename(rel),versionId:null,fileName:path.basename(rel),fileUrl:url,installedAt:new Date().toISOString(),installed:true,sizeOnDisk:stat.size});
    } else if(rel.toLowerCase().startsWith('shaderpacks/') && /\.(zip|jar)$/i.test(rel)){
      const stat=await fs.stat(dest);
      installedShaderPacks.push({id:crypto.randomBytes(8).toString('hex'),source:'modrinth-pack',projectId:`pack:${rel}`,projectSlug:'modrinth-pack',title:path.basename(rel),versionId:null,fileName:path.basename(rel),fileUrl:url,installedAt:new Date().toISOString(),installed:true,sizeOnDisk:stat.size});
    } else if(rel.toLowerCase().startsWith('resourcepacks/') && /\.(zip|jar)$/i.test(rel)){
      const stat=await fs.stat(dest);
      installedResourcePacks.push({id:crypto.randomBytes(8).toString('hex'),source:'modrinth-pack',projectId:`pack:${rel}`,projectSlug:'modrinth-pack',title:path.basename(rel),versionId:null,fileName:path.basename(rel),fileUrl:url,installedAt:new Date().toISOString(),installed:true,sizeOnDisk:stat.size});
    }
  });
  const saved=await getModpack(manifest.id);
  saved.mods=installedMods;
  saved.shaderpacks=installedShaderPacks;
  saved.resourcepacks=installedResourcePacks;
  saved.importedFrom=source.sourceUrl || source.filePath || 'mrpack';
  saved.mrpackFormatVersion=index.formatVersion || 1;
  saved.mrpackVersionId=index.versionId || extra.versionId || null;
  saved.mrpackProjectId=extra.projectId || null;
  await saveModpackFile(saved);
  return saved;
}

async function importModrinthModpack({ projectId, versionId }){
  const modrinth=require('./modrinth');
  let version=null;
  if(versionId) version=await modrinth.getVersion(versionId);
  else if(projectId){
    const versions=await modrinth.getProjectVersions(projectId);
    version=versions && versions[0];
  }
  if(!version) throw new Error('No Modrinth modpack version found');
  const file=(version.files||[]).find(f=>f.primary && /\.mrpack$/i.test(f.filename)) || (version.files||[]).find(f=>/\.mrpack$/i.test(f.filename));
  if(!file) throw new Error('Selected Modrinth version does not have a .mrpack file');
  const project=projectId ? await modrinth.getProject(projectId).catch(()=>null) : null;
  return importMrpack({ sourceUrl:file.url }, { label:file.filename, name:project?.title || version.name, description:project?.description || version.name, projectId, versionId:version.id });
}

module.exports={
  modpacksRoot, modpackDir, modpackGameDir, modsFolder, resourcepacksFolder, ensurePackDirectories, validatePackId,
  listModpacks, getModpack, createModpack, deleteModpack, updateModpack,
  installModpack, launchModpack, listMods, addModToPack, removeModFromPack, validatedModDownload,
  addLocalModToPack, listShaderPacks, addShaderPackToPack, removeShaderPackFromPack,
  listResourcePacks, addResourcePackToPack, removeResourcePackFromPack,
  importMrpack, importModrinthModpack,
  fetchFabricLoaderVersions, fetchFabricProfile, fetchQuiltLoaderVersions, fetchQuiltProfile,
  fetchForgeVersions, fetchForgePromotions, fetchNeoForgeVersions
};
