/**
 * diagnostic.js
 * CutYT FLAC Extractor (NO Puppeteer — Reverse-Engineered Pipeline)
 *
 * Usage: node diagnostic.js <youtube_video_id_or_url>
 *
 * Flow (from live network capture of cutyt.com):
 *   [1] yt-search              → title, artist, thumbnail
 *   [2] @pontalabs/ytdl        → play URL (for Discord inline player)
 *   [3] Strategy A             → https://filescutyt.com/{slug}.flac  (0 API calls)
 *   [4] Strategy B (if 404)    → POST cutytapi.azurewebsites.net/exec/method
 *                                 {methodName:"GetYtDlpData", arguments:"...-x --audio-format flac..."}
 *                                 then re-poll the slug URL
 *   [5] Strategy C (fallback)  → saved discovery JSON (~/.cutyt_diagnostic.json)
 *   [6] Verify                 → HEAD 200  +  Range GET 0-3 bytes == "fLaC"
 *
 * Requires: npm install yt-search axios @pontalabs/ytdl
 */

const ytSearch = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pontalabsYtdl = null;
try { pontalabsYtdl = require('@pontalabs/ytdl'); } catch { /* optional */ }

// ---------- Reverse-engineered constants ----------
const FLAC_CDN        = 'https://filescutyt.com';
const AZURE_API       = 'https://cutytapi.azurewebsites.net/exec/method';
const DISCOVERY_JSON  = path.join(os.homedir(), '.cutyt_diagnostic.json');
const SLUG_MAX_LEN    = 80;
const FLAC_MAGIC_HEX  = '664c6143';  // bytes: 66 4C 61 43  =>  "fLaC"

// Exact yt-dlp argument template CutYT sends — captured from Azure POST payload
const YTDLP_ARGS = (ytUrl) =>
  '--no-playlist --no-mtime -N 8 ' +
  '-f ba[acodec!=none]/bestaudio[acodec!=none]/ba/bestaudio/best[acodec!=none][height<=360]/worst[acodec!=none] ' +
  `-x --audio-format flac --audio-quality 0 "${ytUrl}"`;

const input = process.argv[2] || 'FxAG_11PzCk';


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

// Reverse-engineered: filescutyt.com slugifies the title,
// strips non [a-z0-9 -], collapses hyphens, truncates to 80 chars.
function slugifyForCutyt(title) {
  if (!title) return null;
  let s = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // drop ( ) | , ' . ! ? etc.
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-+/g, '-')             // collapse repeats
    .replace(/^-|-$/g, '');          // trim edges
  if (s.length > SLUG_MAX_LEN) {
    s = s.substring(0, SLUG_MAX_LEN).replace(/-$/, '');
  }
  return s;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


// ============================================================
// Verification — the only trustworthy check
// ============================================================
async function verifyRemoteFlac(url) {
  try {
    const head = await axios.head(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      validateStatus: () => true,
    });
    if (head.status !== 200) {
      return { ok: false, reason: `HEAD ${head.status}` };
    }

    const sizeMB = head.headers['content-length']
      ? (head.headers['content-length'] / 1024 / 1024).toFixed(2)
      : '?';
    const ctype = head.headers['content-type'] || '?';

    const range = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-3' },
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    const first4 = Buffer.from(range.data).toString('hex');
    const isFlac = first4 === FLAC_MAGIC_HEX;

    return {
      ok: isFlac,
      status: head.status,
      sizeMB,
      ctype,
      magic: first4,
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}


// ============================================================
// Strategy B — trigger conversion via CutYT's Azure backend
// (Only used when the slug URL isn't already on the CDN)
// ============================================================
async function triggerCutytConversion(ytUrl) {
  const payload = {
    methodName: 'GetYtDlpData',
    arguments: YTDLP_ARGS(ytUrl),
  };

  console.log(`     ⚡ POST ${AZURE_API}`);
  console.log(`        methodName: GetYtDlpData`);
  console.log(`        arguments : ${payload.arguments.slice(0, 120)}...`);

  const t0 = Date.now();
  try {
    const res = await axios.post(AZURE_API, payload, {
      timeout: 180000,
      headers: {
        'Content-Type': 'application/json',
        'Origin':  'https://www.cutyt.com',
        'Referer': `https://www.cutyt.com/download?url=${encodeURIComponent(ytUrl)}&format=flac&type=audio`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      validateStatus: () => true,
    });
    console.log(`     ✅ Azure HTTP ${res.status} in ${Date.now() - t0}ms`);
    return { ok: res.status >= 200 && res.status < 300, data: res.data };
  } catch (e) {
    console.log(`     ❌ Azure failed: ${e.message}`);
    return { ok: false };
  }
}


// ============================================================
// Strategy C — saved discovery from a previous `discover` run
// ============================================================
function loadSavedDiscovery(videoId) {
  try {
    if (!fs.existsSync(DISCOVERY_JSON)) return null;
    const cfg = JSON.parse(fs.readFileSync(DISCOVERY_JSON, 'utf-8'));
    const saved = cfg?.discoveries?.[videoId];
    if (!saved) return null;
    const urls = (saved.flac_urls || []).filter(u =>
      u.startsWith('https://filescutyt.com/') && u.includes('.flac')
    );
    return urls[0] || null;
  } catch {
    return null;
  }
}


// ============================================================
// Main
// ============================================================
async function runDiagnostic() {
  const videoId = getVideoId(input);
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

  console.log('\n================================================================');
  console.log(`🚀 CUTYT FLAC EXTRACTOR — NO PUPPETEER — for: ${videoId}`);
  console.log('================================================================');
  console.log('🧠 Reverse-engineered pipeline:');
  console.log('   [A] Slug construction → https://filescutyt.com/{slug}.flac');
  console.log('   [B] Azure POST trigger  → cutytapi.azurewebsites.net/exec/method');
  console.log('   [C] Verify             → HEAD 200 + 4-byte magic "fLaC"\n');

  const overallStart = Date.now();
  let title = 'Unknown', artist = 'Unknown';
  let playUrl = null;
  let cleanFlacUrl = null;

  try {
    // ---------- STEP 1: Metadata ----------
    console.log('⏳ [1/5] Fetching metadata via yt-search...');
    const metaStart = Date.now();
    try {
      const v = await ytSearch({ videoId });
      if (v && v.title) {
        title = v.title;
        artist = v.author ? v.author.name : 'Unknown';
        console.log(`  ✅ Title:  "${title}"`);
        console.log(`  ✅ Artist: "${artist}"`);
      }
    } catch (err) {
      console.log(`  ❌ Metadata failed: ${err.message}`);
    }
    console.log(`  ⏱️  Took: ${Date.now() - metaStart}ms\n`);

    // ---------- STEP 2: Play URL ----------
    console.log('⏳ [2/5] Fetching Play URL via @pontalabs/ytdl...');
    const playStart = Date.now();
    if (pontalabsYtdl) {
      try {
        const audio = await pontalabsYtdl.downloadAudio(ytUrl, 320);
        playUrl = audio?.download?.downloadUrl || null;
        console.log(`  ${playUrl ? '✅ Play URL found' : '⚠️  Play URL returned empty'}`);
      } catch (err) {
        console.log(`  ❌ Play URL failed: ${err.message}`);
      }
    } else {
      console.log('  ⏭️  @pontalabs/ytdl not installed — skipping');
    }
    console.log(`  ⏱️  Took: ${Date.now() - playStart}ms\n`);

    // ---------- STEP 3: Reverse-engineered FLAC URL ----------
    console.log('⏳ [3/5] Reverse-engineered FLAC URL extraction...');

    const slug = slugifyForCutyt(title);
    const slugUrl = slug ? `${FLAC_CDN}/${slug}.flac` : null;

    // === Strategy A: construct + verify (0 API calls) ===
    if (slugUrl) {
      console.log(`\n  🔎 Strategy A: slug URL (already on CDN?)`);
      console.log(`     ${slugUrl}`);
      const v = await verifyRemoteFlac(slugUrl);
      if (v.ok) {
        console.log(`     ✅ VERIFIED — ${v.sizeMB} MB, ${v.ctype}, magic=${v.magic}`);
        cleanFlacUrl = slugUrl;
      } else {
        console.log(`     ❌ Not on CDN (${v.reason || `status=${v.status}`})`);
      }
    } else {
      console.log('  ⚠️  Cannot build slug (no title).');
    }

    // === Strategy B: trigger conversion on CutYT's Azure backend ===
    if (!cleanFlacUrl && slugUrl) {
      console.log(`\n  🔎 Strategy B: trigger Azure conversion`);
      const az = await triggerCutytConversion(ytUrl);

      if (az.ok) {
        console.log(`     ⏳ Polling CDN for up to 60s...`);
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          const v = await verifyRemoteFlac(slugUrl);
          if (v.ok) {
            console.log(`     ✅ VERIFIED after ${(i + 1) * 2}s — ${v.sizeMB} MB`);
            cleanFlacUrl = slugUrl;
            break;
          }
        }
        if (!cleanFlacUrl) {
          console.log(`     ❌ CDN didn't produce the file within 60s.`);
        }
      } else {
        console.log(`     ⚠️  Azure POST was unsuccessful — skipping poll.`);
      }
    }

    // === Strategy C: saved discovery JSON ===
    if (!cleanFlacUrl) {
      console.log(`\n  🔎 Strategy C: saved discovery from ${DISCOVERY_JSON}`);
      const savedUrl = loadSavedDiscovery(videoId);
      if (savedUrl) {
        console.log(`     ${savedUrl}`);
        const v = await verifyRemoteFlac(savedUrl);
        if (v.ok) {
          console.log(`     ✅ VERIFIED — ${v.sizeMB} MB`);
          cleanFlacUrl = savedUrl;
        } else {
          console.log(`     ❌ Saved URL no longer valid (${v.reason || `status=${v.status}`})`);
        }
      } else {
        console.log(`     ⏭️  No saved discovery for this video ID.`);
      }
    }

    console.log('');

    // ---------- STEP 4: Clean URL (strip query params) ----------
    console.log('⏳ [4/5] Final cleanup...');
    if (cleanFlacUrl) {
      // Guarantee no ?forceDownload=true style query params survive
      cleanFlacUrl = cleanFlacUrl.split('?')[0];
      console.log(`  🧹 Clean URL: ${cleanFlacUrl}`);
    } else {
      console.log(`  ⏭️  Nothing to clean.`);
    }
    console.log('');

    // ---------- STEP 5: Summary ----------
    console.log('================================================================');
    console.log(`✅ DIAGNOSTIC COMPLETE in ${Date.now() - overallStart}ms`);
    console.log('================================================================');
    console.log('📋 SUMMARY:');
    console.log(`  - Title:    ${title}`);
    console.log(`  - Artist:   ${artist}`);
    console.log(`  - Play URL: ${playUrl ? '✅ WORKING' : '❌ FAILED'}`);

    if (cleanFlacUrl) {
      console.log(`  - FLAC URL: ✅ VERIFIED & WORKING`);
      console.log(`              ${cleanFlacUrl}`);
    } else {
      console.log(`  - FLAC URL: ❌ FAILED`);
      console.log(`              Try:  python cutyt_diagnostic.py discover ${videoId}`);
      console.log(`              Then re-run this script.`);
    }
    console.log('');

  } catch (error) {
    console.error('\n❌ FATAL DIAGNOSTIC ERROR');
    console.error(error);
  }
}

runDiagnostic();