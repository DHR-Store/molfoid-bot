const ytSearch = require('yt-search');

async function getPlaylist(query) {
  try {
    const cleanQuery = query.replace(/\s+yt$/i, '').trim();

    // 1. Try to find a real playlist or mix first
    const result = await ytSearch(`${cleanQuery} playlist`);
    
    if (result && Array.isArray(result.playlists) && result.playlists.length > 0) {
      const topPlaylist = result.playlists[0];
      
      if (topPlaylist && topPlaylist.listId) {
        const playlistData = await ytSearch({ listId: topPlaylist.listId });
        
        if (playlistData && Array.isArray(playlistData.videos) && playlistData.videos.length > 0) {
          return {
            title: topPlaylist.title || `${cleanQuery} Playlist`,
            videos: playlistData.videos.map(v => ({
              title: v.title,
              id: v.videoId,
              // FORCE A VALID URL to prevent crashes
              url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : v.url,
              thumbnail: v.thumbnail,
              duration: v.timestamp,
              author: v.author ? v.author.name : 'Unknown'
            }))
          };
        }
      }
    }

    // 2. Fallback: If no playlist found, search for top songs
    const fallbackResult = await ytSearch(`${cleanQuery} songs`);
    if (!fallbackResult || !Array.isArray(fallbackResult.videos) || fallbackResult.videos.length === 0) {
      return null;
    }

    return {
      title: `${cleanQuery} - Top Trending Songs`,
      videos: fallbackResult.videos.slice(0, 20).map(v => ({
        title: v.title,
        id: v.videoId,
        // FORCE A VALID URL to prevent crashes
        url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : v.url,
        thumbnail: v.thumbnail,
        duration: v.timestamp,
        author: v.author ? v.author.name : 'Unknown'
      }))
    };
  } catch (error) {
    console.error('❌ Playlist fetch error:', error.message);
    return null;
  }
}

module.exports = { getPlaylist };