const ytSearch = require('yt-search');
const puppeteer = require('puppeteer');
const pontalabsYtdl = require('@pontalabs/ytdl');

function getVideoId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  if (urlOrId.includes('youtube.com') || urlOrId.includes('youtu.be')) {
    const match = urlOrId.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : urlOrId;
  }
  return urlOrId;
}

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
      duration: v.timestamp
    }));
  } catch (e) {
    console.error('❌ Music search error:', e.message);
    return [];
  }
}

async function fetchSongByUrl(urlOrId) {
  const overallStart = Date.now();
  let browser = null;
  
  try {
    const videoId = getVideoId(urlOrId);
    if (!videoId) throw new Error('Invalid Video ID');
    
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    let accurateTitle = 'Unknown Title';
    let accurateThumbnail = null;
    let accurateArtist = 'Unknown Artist';
    let accurateDuration = 'Unknown';
    let playUrl = null;

    // 1. Fetch Metadata (Fast)
    const metaStart = Date.now();
    try {
      const v = await ytSearch({ videoId: videoId });
      if (v && v.title) {
        accurateTitle = v.title;
        accurateThumbnail = v.thumbnail;
        accurateArtist = v.author ? v.author.name : 'Unknown Artist';
        accurateDuration = v.timestamp;
      }
      console.log(`⏱️ [Music] Metadata fetched in ${Date.now() - metaStart}ms`);
    } catch (err) {
      console.log(`⚠️ [Music] Metadata fetch failed: ${err.message}`);
    }

    // 2. Fetch Play URL via Pontalabs
    const playStart = Date.now();
    try {
      const audio = await pontalabsYtdl.downloadAudio(ytUrl, 320);
      playUrl = audio?.download?.downloadUrl || null;
      console.log(`⏱️ [Music] Play URL fetched in ${Date.now() - playStart}ms`);
    } catch (ytdlError) {
      console.log(`❌ [Music] Play URL failed (YouTube blocked Suga IP): ${ytdlError.message}`);
    }

    // 3. Fetch FLAC URL via Puppeteer (Optimized for Speed)
    const puppeteerStart = Date.now();
    console.log(`⏱️ [Music] Launching Puppeteer...`);
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] // Suga memory optimization
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36');

    // SPEED OPTIMIZATION: Block images, CSS, and fonts to make it 5x faster
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const cutytUrl = `https://www.cutyt.com/download?url=${encodeURIComponent(ytUrl)}&format=flac&type=audio`;
    await page.goto(cutytUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('a[href*=".flac"]', { timeout: 10000 });
    
    const realFlacUrl = await page.evaluate(() => document.querySelector('a[href*=".flac"]')?.href);
    await browser.close();
    console.log(`⏱️ [Music] Puppeteer FLAC URL fetched in ${Date.now() - puppeteerStart}ms`);

    const cleanFlacUrl = realFlacUrl ? realFlacUrl.split('?')[0] : null;

    console.log(`⏱️ [Music] Total fetch time: ${Date.now() - overallStart}ms`);
    return {
      title: accurateTitle,
      url: ytUrl,
      thumbnail: accurateThumbnail,
      downloadUrl: cleanFlacUrl, 
      playUrl: playUrl, 
      isFlac: true,
      singers: accurateArtist,
      author: accurateArtist,
      duration: accurateDuration
    };

  } catch (e) {
    if (browser) await browser.close();
    console.error(`❌ [Music] Fetch error after ${Date.now() - overallStart}ms:`, e.message);
    
    // Fallback
    try {
      const validId = getVideoId(urlOrId);
      const v = await ytSearch({ videoId: validId });
      if (v && v.title) {
        return {
          title: v.title,
          url: `https://www.youtube.com/watch?v=${validId}`,
          thumbnail: v.thumbnail,
          downloadUrl: `https://www.youtube.com/watch?v=${validId}`,
          playUrl: null, 
          isFlac: false,
          singers: v.author ? v.author.name : 'Unknown Artist',
          duration: v.timestamp
        };
      }
      return null;
    } catch (fallbackErr) {
      return null;
    }
  }
}

module.exports = { searchMusicList, fetchSongByUrl };