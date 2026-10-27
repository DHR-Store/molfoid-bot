const axios = require('axios');

async function searchIMDb(query) {
  try {
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`;
    
    const { data } = await axios.get(url);

    if (!data || !data.d) return [];

    // Return up to 20 results for pagination
    return data.d
      .filter(item => item.id && item.l)
      .map(item => ({
        title: item.l,
        id: item.id,
        type: item.qid || item.q || 'movie', 
        year: item.y || 'N/A',
        image: item.i ? item.i.imageUrl : null
      }))
      .slice(0, 20); 
  } catch (error) {
    console.error('❌ IMDb API error:', error.message);
    return [];
  }
}

module.exports = { searchIMDb };