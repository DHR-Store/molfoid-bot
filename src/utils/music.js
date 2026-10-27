const ytSearch = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

process.env.YTDL_NO_UPDATE = '1';

let pontalabsYtdl = null;
try { pontalabsYtdl = require('@pontalabs/ytdl'); } catch {}
let ytdlCore = null;
try { ytdlCore = require('@distube/ytdl-core'); }
catch { try { ytdlCore = require('ytdl-core'); } catch {} }
let FormDataLib = null;
try { FormDataLib = require('form-data'); } catch {}


// ============================================================
// Constants
// ============================================================
const FLAC_CDN          = 'https://filescutyt.com';
const FLAC_CACHE        = path.join(os.homedir(), '.cutyt_flac_cache.json');
const FLAC_DIR          = path.join(os.homedir(), '.molfoid-flac');
const SLUG_MAX_LEN      = 80;
const FLAC_MAGIC_HEX    = '664c6143';
const DISCORD_ATTACH_MAX = 24 * 1024 * 1024;
const UPLOAD_MAX         = 1024 * 1024 * 1024; // Increased to 1GB for Litterbox

try { fs.mkdirSync(FLAC_DIR, { recursive: true }); } catch {}


// ============================================================
// Auto-detect python + ffmpeg
// ============================================================
let PYTHON = null, FFMPEG_DIR = null;

async function findPython() {
  if (PYTHON) return PYTHON;
  for (const c of ['python', 'python3', 'py']) {
    try {
      const { stdout } = await execFileP(c, ['--version'], { timeout: 4000 });
      if (String(stdout).toLowerCase().includes('python')) { PYTHON = c; return c; }
    } catch {}
  }
  return null;
}

function findFfmpegDir() {
  if (FFMPEG_DIR) return FFMPEG_DIR;
  const cands = [
    process.env.FFMPEG_LOCATION,
    'C:\\ffmpeg\\bin',
    'C:\\ffmpeg',
    ...(process.env.PATH || '').split(path.delimiter).map(p => p.trim()).filter(Boolean),
  ].filter(Boolean);
  for (const c of cands) {
    try { if (fs.existsSync(path.join(c, 'ffmpeg.exe'))) { FFMPEG_DIR = c; return c; } } catch {}
  }
  FFMPEG_DIR = 'C:\\ffmpeg\\bin';
  return FFMPEG_DIR;
}


// ============================================================
// Cache
// ============================================================
function loadCache() {
  try { return fs.existsSync(FLAC_CACHE) ? JSON.parse(fs.readFileSync(FLAC_CACHE, 'utf-8')) : {}; }
  catch { return {}; }
}
function saveCache(c) {
  try { fs.writeFileSync(FLAC_CACHE, JSON.stringify(c, null, 2)); } catch {}
}
function cacheGet(id) { return loadCache()[id] || null; }
function cacheSet(id, data) {
  const c = loadCache();
  c[id] = { ts: Date.now(), ...data };
  saveCache(c);
}


// ============================================================
// Helpers
// ============================================================
function getVideoId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  if (urlOrId.includes('youtube.com') || urlOrId.includes('youtu.be')) {
    const m = urlOrId.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return m ? m[1] : urlOrId;
  }
  return urlOrId;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildSlugCandidates(title) {
  if (!title) return [];
  const base = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const set = new Set([base]);
  if (base.length > SLUG_MAX_LEN) {
    const t80 = base.substring(0, SLUG_MAX_LEN).replace(/-+$/, '');
    set.add(t80);
    const lastH = t80.lastIndexOf('-');
    if (lastH > 40) set.add(t80.substring(0, lastH));
  }
  return [...set];
}


// ============================================================
// Play URL
// ============================================================
async function getPlayUrl(ytUrl) {
  if (ytdlCore) {
    try {
      const info = await ytdlCore.getInfo(ytUrl);
      const fmt = ytdlCore.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
      if (fmt?.url) return fmt.url;
    } catch {}
  }
  if (pontalabsYtdl) {
    try {
      const a = await pontalabsYtdl.downloadAudio(ytUrl, 320);
      return a?.download?.downloadUrl || null;
    } catch {}
  }
  return null;
}


// ============================================================
// Verify remote FLAC
// ============================================================
async function verifyRemoteFlac(url) {
  if (typeof url !== 'string') return false;
  try {
    const head = await axios.head(url, {
      timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' },
      validateStatus: () => true,
    });
    if (head.status !== 200) return false;
    const range = await axios.get(url, {
      timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-3' },
      responseType: 'arraybuffer', validateStatus: () => true,
    });
    return Buffer.from(range.data).toString('hex') === FLAC_MAGIC_HEX;
  } catch { return false; }
}

async function probeFirstWorking(urls) {
  if (!urls.length) return null;
  const r = await Promise.allSettled(urls.map(async u => ({ u, ok: await verifyRemoteFlac(u) })));
  for (const x of r) if (x.status === 'fulfilled' && x.value.ok) return x.value.u;
  return null;
}


// ============================================================
// LOCAL yt-dlp
// ============================================================
async function downloadFlacLocal(ytUrl, videoId) {
  try {
    const cached = fs.readdirSync(FLAC_DIR).find(f => f.includes(`[${videoId}]`) && f.endsWith('.flac'));
    if (cached) {
      const fp = path.join(FLAC_DIR, cached);
      if (fs.statSync(fp).size > 50_000) return fp;
    }
  } catch {}

  const py = await findPython();
  if (!py) { console.log('❌ [yt-dlp] python not found'); return null; }

  const ffmpegDir = findFfmpegDir();
  const output = path.join(FLAC_DIR, `%(title).180B [%(id)s].%(ext)s`);

  const args = [
    '-m', 'yt_dlp',
    '--no-playlist', '--no-mtime',
    '-f', 'bestaudio',
    '-x', '--audio-format', 'flac', '--audio-quality', '0',
    '--ffmpeg-location', ffmpegDir,
    '-o', output,
    '--no-warnings', '--no-progress',
    ytUrl,
  ];

  console.log(`🎬 [yt-dlp] converting to FLAC (ffmpeg: ${ffmpegDir})`);

  return new Promise(resolve => {
    const start = Date.now();
    const proc = spawn(py, args, { windowsHide: true });
    let stderr = '';

    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', err => {
      console.log(`❌ [yt-dlp] spawn error: ${err.message}`);
      resolve(null);
    });
    proc.on('close', code => {
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      if (code !== 0) {
        console.log(`❌ [yt-dlp] exit ${code} (${secs}s): ${stderr.slice(-200).replace(/\n/g, ' ')}`);
        return resolve(null);
      }
      try {
        const found = fs.readdirSync(FLAC_DIR).find(f => f.includes(`[${videoId}]`) && f.endsWith('.flac'));
        if (found) {
          const fp = path.join(FLAC_DIR, found);
          const mb = (fs.statSync(fp).size / 1024 / 1024).toFixed(2);
          console.log(`✅ [yt-dlp] FLAC ready in ${secs}s: ${found} (${mb} MB)`);
          resolve(fp);
        } else {
          console.log(`❌ [yt-dlp] finished but no .flac found in ${FLAC_DIR}`);
          resolve(null);
        }
      } catch { resolve(null); }
    });

    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      console.log(`❌ [yt-dlp] killed after 180s`);
      resolve(null);
    }, 180000);
  });
}


// ============================================================
// File host upload — Pixeldrain + Litterbox + Tmpfiles Fallbacks
// ============================================================
async function uploadToFileHost(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const size = fs.statSync(filePath).size;
  if (size > UPLOAD_MAX) {
    console.log(`⚠️ [upload] File exceeds ${UPLOAD_MAX / 1024 / 1024} MB limit`);
    return null;
  }

  const fileName = path.basename(filePath).replace(/[^\w.\-]/g, '_');
  const sizeMB = (size / 1024 / 1024).toFixed(1);
  console.log(`📤 [upload] ${sizeMB} MB → ${fileName}`);

  // Helper to extract URL safely
  const getUrl = (data) => {
    if (typeof data === 'string' && data.startsWith('http')) return data.trim();
    if (data && typeof data === 'object') {
      if (typeof data.link === 'string' && data.link.startsWith('http')) return data.link;
      if (typeof data.url === 'string' && data.url.startsWith('http')) return data.url;
      if (typeof data.id === 'string') return `https://pixeldrain.com/api/file/${data.id}`;
      if (data.data && typeof data.data.url === 'string') {
        return data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      }
    }
    return null;
  };

  // ---- 1) Pixeldrain (POST, 20 GB limit, highly reliable) ----
  if (FormDataLib) {
    try {
      console.log(`   → pixeldrain.com...`);
      const form = new FormDataLib();
      form.append('file', fs.createReadStream(filePath));
      
      const res = await axios.post('https://pixeldrain.com/api/file', form, {
        headers: { ...form.getHeaders(), 'User-Agent': 'Mozilla/5.0' },
        maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000, validateStatus: () => true,
      });
      
      const url = getUrl(res.data);
      if (url) { console.log(`   ✅ pixeldrain: ${url}`); return url; }
      console.log(`   ⚠️ pixeldrain rejected:`, res.data);
    } catch (e) { console.log(`   ⚠️ pixeldrain: ${e.message}`); }
  }

  // ---- 2) Litterbox (POST, 1 GB limit) ----
  if (FormDataLib) {
    try {
      console.log(`   → litterbox.catbox.moe...`);
      const form = new FormDataLib();
      form.append('reqtype', 'fileupload');
      form.append('time', '72h');
      form.append('fileToUpload', fs.createReadStream(filePath));
      
      const res = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
        headers: { ...form.getHeaders(), 'User-Agent': 'Mozilla/5.0' },
        maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000, validateStatus: () => true,
      });
      
      const url = getUrl(res.data);
      if (url) { console.log(`   ✅ litterbox: ${url}`); return url; }
      console.log(`   ⚠️ litterbox rejected (maybe file too big?):`, res.data);
    } catch (e) { console.log(`   ⚠️ litterbox: ${e.message}`); }
  }

  // ---- 3) Tmpfiles (POST, 100 MB limit) ----
  if (FormDataLib) {
    try {
      console.log(`   → tmpfiles.org...`);
      const form = new FormDataLib();
      form.append('file', fs.createReadStream(filePath));
      
      const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: { ...form.getHeaders(), 'User-Agent': 'Mozilla/5.0' },
        maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000, validateStatus: () => true,
      });
      
      const url = getUrl(res.data);
      if (url) { console.log(`   ✅ tmpfiles: ${url}`); return url; }
      console.log(`   ⚠️ tmpfiles rejected:`, res.data);
    } catch (e) { console.log(`   ⚠️ tmpfiles: ${e.message}`); }
  }

  // ---- 4) Catbox (POST, 200 MB limit, permanent) ----
  if (FormDataLib) {
    try {
      console.log(`   → catbox.moe...`);
      const form = new FormDataLib();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', fs.createReadStream(filePath));
      
      const res = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: { ...form.getHeaders(), 'User-Agent': 'Mozilla/5.0' },
        maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000, validateStatus: () => true,
      });
      
      const url = getUrl(res.data);
      if (url) { console.log(`   ✅ catbox: ${url}`); return url; }
      console.log(`   ⚠️ catbox rejected:`, res.data);
    } catch (e) { console.log(`   ⚠️ catbox: ${e.message}`); }
  }

  console.log(`❌ [upload] all hosts failed for ${fileName}`);
  return null;
}

// ============================================================
// Fast FLAC lookup (cache + CDN, no conversion)
// ============================================================
async function findFlacFast(videoId, title) {
  const cached = cacheGet(videoId);
  if (cached?.url && await verifyRemoteFlac(cached.url)) {
    return { type: 'url', value: cached.url, size: cached.size };
  }
  if (cached?.localPath && fs.existsSync(cached.localPath)) {
    const size = fs.statSync(cached.localPath).size;
    return { type: 'local', value: cached.localPath, size };
  }

  const candidates = buildSlugCandidates(title).map(s => `${FLAC_CDN}/${s}.flac`);
  const hit = await probeFirstWorking(candidates);
  if (hit) {
    const size = (await axios.head(hit, { timeout: 5000, validateStatus: () => true })
      .catch(() => null))?.headers?.['content-length'];
    cacheSet(videoId, { url: hit, localPath: null, size: size ? Number(size) : null, via: 'cdn-probe' });
    return { type: 'url', value: hit, size: size ? Number(size) : null };
  }
  return null;
}


// ============================================================
// Background FLAC job
// ============================================================
const pendingFlac = new Map();

function ensureFlac(videoId, ytUrl, title) {
  if (pendingFlac.has(videoId)) return pendingFlac.get(videoId);

  const task = (async () => {
    try {
      const quick = await findFlacFast(videoId, title);
      if (quick) return quick;

      const localPath = await downloadFlacLocal(ytUrl, videoId);
      if (!localPath) return null;

      const size = fs.statSync(localPath).size;

      let url = null;
      if (size > DISCORD_ATTACH_MAX) {
        console.log(`📤 [BG] FLAC is ${(size / 1024 / 1024).toFixed(1)} MB — uploading`);
        url = await uploadToFileHost(localPath);
      }

      cacheSet(videoId, { localPath, url, size, title, via: 'ytdlp' });

      return url
        ? { type: 'url', value: url, size, localPath }
        : { type: 'local', value: localPath, size };
    } catch (e) {
      console.log(`❌ [BG] job error: ${e.message}`);
      return null;
    } finally {
      pendingFlac.delete(videoId);
    }
  })();

  pendingFlac.set(videoId, task);
  return task;
}


// ============================================================
// Search
// ============================================================
async function searchMusicList(query) {
  try {
    const r = await ytSearch(query);
    if (!r || !r.videos) return [];
    return r.videos.slice(0, 10).map(v => ({
      title: v.title,
      url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : v.url,
      videoId: v.videoId,
      thumbnail: v.thumbnail,
      artist: v.author.name,
      duration: v.timestamp,
    }));
  } catch { return []; }
}


// ============================================================
// fetchSongByUrl
// ============================================================
async function fetchSongByUrl(urlOrId) {
  try {
    const videoId = getVideoId(urlOrId);
    if (!videoId) throw new Error('Invalid Video ID');
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    let title = 'Unknown Title', artist = 'Unknown Artist';
    let thumbnail = null, duration = 'Unknown';

    try {
      const v = await ytSearch({ videoId });
      if (v?.title) {
        title = v.title;
        thumbnail = v.thumbnail;
        artist = v.author?.name || 'Unknown Artist';
        duration = v.timestamp;
      }
    } catch {}

    const [playUrl, fastFlac] = await Promise.all([
      getPlayUrl(ytUrl),
      findFlacFast(videoId, title),
    ]);

    let downloadUrl = null, localPath = null, flacSize = null, flacPending = false;

    if (fastFlac) {
      if (fastFlac.type === 'url') downloadUrl = fastFlac.value;
      else localPath = fastFlac.value;
      flacSize = fastFlac.size || null;
    } else {
      flacPending = true;
      ensureFlac(videoId, ytUrl, title).catch(() => {});
      console.log(`⏳ [BG] FLAC conversion started for "${title}"`);
    }

    return {
      videoId, title, url: ytUrl, thumbnail, playUrl,
      downloadUrl, localPath, flacSize,
      isFlac: !!(downloadUrl || localPath),
      flacPending,
      singers: artist, author: artist, duration,
    };
  } catch (e) {
    console.error(`❌ Fetch error:`, e.message);
    return null;
  }
}


// ============================================================
// waitForFlac
// ============================================================
async function waitForFlac(videoId, timeoutMs = 180000, forceUpload = false) {
  const c = cacheGet(videoId);

  if (c?.url && await verifyRemoteFlac(c.url)) {
    return { type: 'url', value: c.url, size: c.size, localPath: c.localPath };
  }

  if (c?.localPath && fs.existsSync(c.localPath)) {
    const size = fs.statSync(c.localPath).size;

    if (forceUpload && size > DISCORD_ATTACH_MAX) {
      console.log(`📤 [on-demand] uploading ${(size / 1024 / 1024).toFixed(1)} MB FLAC...`);
      const url = await uploadToFileHost(c.localPath);
      if (url) {
        cacheSet(videoId, { ...c, url });
        return { type: 'url', value: url, size, localPath: c.localPath };
      }
      console.log(`❌ [on-demand] upload failed`);
    }
    return { type: 'local', value: c.localPath, size };
  }

  const pending = pendingFlac.get(videoId);
  if (pending) {
    const result = await Promise.race([pending, sleep(timeoutMs).then(() => null)]);
    if (!result) return null;

    if (forceUpload && result.type === 'local' && result.size > DISCORD_ATTACH_MAX) {
      console.log(`📤 [on-demand retry] uploading ${(result.size / 1024 / 1024).toFixed(1)} MB FLAC...`);
      const url = await uploadToFileHost(result.value);
      if (url) {
        cacheSet(videoId, { ...(cacheGet(videoId) || {}), url });
        return { type: 'url', value: url, size: result.size, localPath: result.value };
      }
    }
    return result;
  }

  return null;
}


module.exports = {
  searchMusicList,
  fetchSongByUrl,
  waitForFlac,
  getVideoId,
  uploadToFileHost,
};