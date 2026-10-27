const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrape Giphy for a GIF matching the query.
 * @param {string} query - The search term.
 * @returns {Promise<string|null>} Direct GIF URL or null.
 */
async function searchGif(query) {
  try {
    const url = `https://giphy.com/search/${encodeURIComponent(query)}`;
    
    // Fetch the HTML page
    const { data } = await axios.get(url, {
      headers: {
        // Spoof a real browser so Giphy doesn't block the request
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    // Load the HTML into Cheerio
    const $ = cheerio.load(data);
    const gifs = [];

    // Extract GIF URLs based on the class we saw in your HTML dump
    $('img.giphy-gif-img').each((index, element) => {
      const src = $(element).attr('src');
      if (src && src.includes('.gif')) {
        gifs.push(src);
      }
    });

    if (gifs.length === 0) {
      console.log(`⚠️ No GIFs found for query: ${query}`);
      return null;
    }

    // Pick a random result from the first 15 found
    const randomIndex = Math.floor(Math.random() * Math.min(gifs.length, 15));
    return gifs[randomIndex];
    
  } catch (error) {
    console.error('❌ Giphy scraping error:', error.message);
    return null;
  }
}

module.exports = { searchGif };