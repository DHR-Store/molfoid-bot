const cloudscraper = require('cloudscraper');
const cheerio = require('cheerio');
const { PROXY_URL } = require('./proxy'); 

const BASE_URL = 'https://pagalnew.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE_URL + '/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Upgrade-Insecure-Requests': '1'
};

function getRequestOptions() {
  const options = { headers: HEADERS };
  if (PROXY_URL) {
    options.proxy = PROXY_URL;
  }
  return options;
}

function toAbsolute(href) {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  return BASE_URL + (href.startsWith('/') ? href : '/' + href);
}

function parseSongPage($, url) {
  let title = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (!title) {
    title =
      $('meta[property="og:title"]')
        .attr('content')
        ?.replace(/\s*-\s*Pagalnew.*$/i, '')
        .trim() || 'Unknown Song';
  }

  let thumbnail = $('meta[property="og:image"]').attr('content') || '';
  if (thumbnail.startsWith('./')) thumbnail = BASE_URL + thumbnail.substring(1);
  if (thumbnail && !thumbnail.startsWith('http')) thumbnail = toAbsolute(thumbnail);
  if (!thumbnail) {
    thumbnail = toAbsolute($('img.b-lazy').first().attr('data-src')) || null;
  }

  let download320 = null;
  let download128 = null;
  $('a.dbutton, a[href*="-download"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().toLowerCase();
    if (!download320 && (href.includes('320-download') || text.includes('320'))) {
      download320 = toAbsolute(href);
    } else if (!download128 && (href.includes('128-download') || text.includes('128'))) {
      download128 = toAbsolute(href);
    }
  });

  const meta = {};
  $('b').each((_, el) => {
    const rawLabel = $(el).text();
    const label = rawLabel.trim().replace(/:$/, '').trim();

    let value = '';
    const next = el.nextSibling;
    if (next) {
      if (next.nodeType === 3) {
        value = (next.data || next.nodeValue || '').trim();
      } else if (next.tagName && next.tagName.toLowerCase() !== 'hr') {
        value = $(next).text().trim();
      }
    }

    if (!value) {
      const parentText = $(el).parent().text();
      const idx = parentText.indexOf(rawLabel);
      if (idx !== -1) {
        value = parentText.slice(idx + rawLabel.length).split(/\n/)[0].trim();
      }
    }

    if (label && value) meta[label] = value.replace(/\s+/g, ' ');
  });

  const singers = meta['Singer(s)'] || meta['Singer'] || meta['Singers'] || '';
  const composer = meta['Music Composer'] || meta['Composer'] || meta['Music'] || '';
  const releasedOn = meta['Released On'] || meta['Release Date'] || '';
  const starring = meta['Lead Star(s)'] || meta['Starring'] || meta['Actors'] || '';

  let movie = meta['Movie'] || meta['Album'] || '';
  if (!movie) {
    const m = title.match(/[-–]\s*(.+?)(?:\s+mp3.*)?$/i);
    if (m) movie = m[1].trim();
  }

  return {
    title,
    url,
    thumbnail,
    download320,
    download128,
    singers,
    composer,
    movie,
    releasedOn,
    starring,
    author: singers || starring || '',
    duration: '',
  };
}

async function searchMusicList(query) {
  try {
    const searchUrl = `${BASE_URL}/search.php?find=${encodeURIComponent(query)}`;
    const searchHtml = await cloudscraper.get(searchUrl, getRequestOptions());

    const $ = cheerio.load(searchHtml);
    const results = [];
    const seen = new Set();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!/\/songs\/[^/]+\.html$/.test(href)) return;

      const absolute = toAbsolute(href);
      if (seen.has(absolute)) return;
      seen.add(absolute);

      let title = $(el).find('.relatedfiles').first().text().replace(/\s+/g, ' ').trim();
      if (!title) title = $(el).text().replace(/\s+/g, ' ').trim();
      if (!title) {
        title = absolute.split('/').pop().replace('.html', '').replace(/-/g, ' ');
      }

      const artist = $(el).find('.h5').first().text().replace(/\s+/g, ' ').trim();
      const img = $(el).find('img').first();
      let thumbnail = img.attr('data-src') || img.attr('src') || null;
      
      if (thumbnail && thumbnail.startsWith('./')) {
        thumbnail = BASE_URL + thumbnail.substring(1);
      }
      if (thumbnail && !thumbnail.startsWith('http')) {
        thumbnail = toAbsolute(thumbnail);
      }

      results.push({ title, url: absolute, thumbnail, artist });
    });

    return results;
  } catch (error) {
    // If Cloudflare blocks the request (403), just return empty so the bot falls back to YouTube
    if (error.statusCode === 403 || error.message.includes('403')) {
      console.log(`⚠️ Pagalnew blocked the server IP. Falling back to YouTube...`);
    } else {
      console.error('❌ Pagalnew search error:', error.message || error);
    }
    return [];
  }
}

async function fetchSongByUrl(url) {
  try {
    const songHtml = await cloudscraper.get(url, getRequestOptions());
    const $ = cheerio.load(songHtml);
    return parseSongPage($, url);
  } catch (error) {
    console.error('❌ Pagalnew song fetch error:', error.message || error);
    return null;
  }
}

async function searchMusic(query, index = 0) {
  try {
    const list = await searchMusicList(query);
    if (!list[index]) return null;
    return await fetchSongByUrl(list[index].url);
  } catch (error) {
    return null;
  }
}

module.exports = { searchMusic, searchMusicList, fetchSongByUrl };