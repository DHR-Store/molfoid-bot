const ytSearch = require('yt-search');

async function getPlaylist(query) {
  try {
    const cleanQuery = query.replace(/\s+yt$/i, '').trim();
    const result = await ytSearch(`${cleanQuery} playlist`);

    // 1. Try to find a real playlist or mix first
    if (result && Array.isArray(result.playlists) && result.playlists.length > 0) {
      const topPlaylist = result.playlists[0];
      
      if (topPlaylist && topPlaylist.listId) {
        try {
          // This often fails for "Mix" playlists
          const playlistData = await ytSearch({ listId: topPlaylist.listId });
          
          if (playlistData && Array.isArray(playlistData.videos) && playlistData.videos.length > 0) {
            return {
              title: topPlaylist.title || `${cleanQuery} Playlist`,
              videos: playlistData.videos.map(v => {
                let durationStr = v.timestamp || (v.duration ? v.duration.timestamp : null) || '--:--';
                return {
                  title: v.title,
                  id: v.videoId,
                  url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : v.url,
                  thumbnail: v.thumbnail,
                  duration: durationStr,
                  author: (v.author && v.author.name) ? v.author.name : (v.author || 'Unknown')
                };
              })
            };
          }
        } catch (playlistErr) {
          // Catch the "unviewable" error and fall through to the fallback
          console.log(`⚠️ Playlist "${topPlaylist.title}" is unviewable. Using fallback...`);
        }
      }
    }

    // 2. Fallback: If no playlist found or it was unviewable, search for top songs
    const fallbackResult = await ytSearch(`${cleanQuery} songs`);
    if (!fallbackResult || !Array.isArray(fallbackResult.videos) || fallbackResult.videos.length === 0) {
      return null;
    }

    return {
      title: `${cleanQuery} - Top Trending Songs`,
      videos: fallbackResult.videos.slice(0, 20).map(v => {
        let durationStr = v.timestamp || (v.duration ? v.duration.timestamp : null) || '--:--';
        return {
          title: v.title,
          id: v.videoId,
          url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : v.url,
          thumbnail: v.thumbnail,
          duration: durationStr,
          author: (v.author && v.author.name) ? v.author.name : (v.author || 'Unknown')
        };
      })
    };
  } catch (error) {
    console.error('❌ Playlist fetch error:', error.message);
    return null;
  }
}

module.exports = { getPlaylist };