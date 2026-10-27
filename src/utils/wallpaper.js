const axios = require('axios');
const cheerio = require('cheerio');

async function searchWallpapers(query) {
  try {
    const url = `https://4kwallpapers.com/search/?q=${encodeURIComponent(query)}`;
    
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);
    const results = [];

    $('.wallpapers__item').each((i, el) => {
      const pageUrl = $(el).find('.wallpapers__canvas_image').attr('href');
      const thumbUrl = $(el).find('img').attr('src');
      const title = $(el).find('.title2').text().trim() || '4K Wallpaper';

      if (pageUrl && thumbUrl) {
        results.push({
          title,
          pageUrl: `https://4kwallpapers.com${pageUrl}`,
          thumbUrl: `https://4kwallpapers.com${thumbUrl}`
        });
      }
    });

    // Return up to 20 results for pagination
    return results.slice(0, 20);
  } catch (error) {
    console.error('❌ Wallpaper scrape error:', error.message);
    return [];
  }
}

module.exports = { searchWallpapers };