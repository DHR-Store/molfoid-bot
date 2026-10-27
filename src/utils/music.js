const ytSearch = require('yt-search');
const puppeteer = require('puppeteer');
const pontalabsYtdl = require('@pontalabs/ytdl');

function getVideoId(urlOrId) {
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
      url: v.url,
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
  let browser = null;
  try {
    const videoId = getVideoId(urlOrId);
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    let accurateTitle = 'Unknown Title';
    let accurateThumbnail = null;
    let accurateArtist = 'Unknown Artist';
    let accurateDuration = 'Unknown';
    let playUrl = null;

    // 1. Get accurate metadata via yt-search (Fixed: ytSearch returns video object directly)
    try {
      const v = await ytSearch({ videoId: videoId });
      if (v && v.title) {
        accurateTitle = v.title;
        accurateThumbnail = v.thumbnail;
        accurateArtist = v.author ? v.author.name : 'Unknown Artist';
        accurateDuration = v.timestamp;
      }
    } catch (err) {
      console.log('⚠️ Could not fetch metadata via yt-search.');
    }

    // 2. Get the direct playable URL using @pontalabs/ytdl
    try {
      const audio = await pontalabsYtdl.downloadAudio(ytUrl, 320);
      playUrl = audio?.download?.downloadUrl || null;
    } catch (ytdlError) {
      console.error('❌ @pontalabs/ytdl download error:', ytdlError.message);
    }

    // 3. Launch Puppeteer to get the REAL flac link from CutYT
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36');

    const cutytUrl = `https://www.cutyt.com/download?url=${encodeURIComponent(ytUrl)}&format=flac&type=audio`;
    await page.goto(cutytUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('a[href*=".flac"]', { timeout: 15000 });
    
    const realFlacUrl = await page.evaluate(() => document.querySelector('a[href*=".flac"]')?.href);
    await browser.close();

    const cleanFlacUrl = realFlacUrl ? realFlacUrl.split('?')[0] : null;

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
    console.error('❌ Fetch error:', e.message);
    
    // Fallback: If Puppeteer fails, give the YouTube link
    try {
      const v = await ytSearch({ videoId: getVideoId(urlOrId) });
      if (v && v.title) {
        return {
          title: v.title,
          url: v.url,
          thumbnail: v.thumbnail,
          downloadUrl: v.url,
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