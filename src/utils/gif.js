const axios = require('axios');

const TENOR_BASE = 'https://tenor.googleapis.com/v2';

/**
 * Search Tenor for a GIF matching the query.
 * @param {string} query - The search term.
 * @returns {Promise<string|null>} Direct GIF URL or null.
 */
async function searchGif(query) {
  try {
    const response = await axios.get(`${TENOR_BASE}/search`, {
      params: {
        key: process.env.TENOR_API_KEY,
        q: query,
        limit: 10,
        media_filter: 'gif',
      },
    });

    const results = response.data.results;
    if (!results || results.length === 0) return null;

    // Pick a random result from the top 10
    const randomIndex = Math.floor(Math.random() * results.length);
    const gif = results[randomIndex];

    // Use the 'media' key for the direct GIF URL
    return gif.media_formats?.gif?.url || null;
  } catch (error) {
    console.error('GIF search error:', error.message);
    return null;
  }
}

module.exports = { searchGif };