const axios = require('axios');

async function searchWallpapers(query) {
  try {
    const url = `https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(query)}&sorting=toplist&order=desc`;
    
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'MolfoidBot/1.0 (Discord Bot)'
      }
    });

    if (!data || !data.data) return [];

    return data.data.slice(0, 20).map(item => {
      return {
        title: `${query} Wallpaper (${item.resolution})`,
        pageUrl: item.url,           
        imageUrl: item.path,         
        thumbUrl: item.thumbs.large, 
        resolution: item.resolution,
        // Safely fallback to 'Unknown' if the uploader is hidden or missing
        uploader: item.uploader?.username || 'Unknown' 
      };
    });

  } catch (error) {
    console.error('❌ Wallpaper API error:', error.message);
    return [];
  }
}

module.exports = { searchWallpapers };