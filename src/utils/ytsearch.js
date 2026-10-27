const ytSearch = require('yt-search');

async function searchYouTube(query) {
  try {
    const result = await ytSearch(query);
    if (!result || !result.videos || result.videos.length === 0) return [];
    
    // Return top 25 results (Discord select menu limit)
    return result.videos.slice(0, 25).map(v => ({
      title: v.title,
      id: v.videoId,
      url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : v.url,
      thumbnail: v.thumbnail,
      duration: v.timestamp || '--:--',
      author: v.author ? v.author.name : 'Unknown'
    }));
  } catch (error) {
    console.error('❌ YT Search error:', error);
    return [];
  }
}

module.exports = { searchYouTube };