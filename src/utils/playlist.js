const ytSearch = require('yt-search');

async function getPlaylist(query) {
  try {
    // Instead of searching for a playlist ID (which breaks on Mixes), 
    // we search for the artist's top videos directly.
    const result = await ytSearch(`${query} songs`);
    
    if (!result || !result.videos || result.videos.length === 0) {
      return null;
    }

    // Take the top 20 videos for the playlist
    const playlistVideos = result.videos.slice(0, 20);

    return {
      title: `${query} - Top Songs`,
      videos: playlistVideos.map(v => ({
        title: v.title,
        id: v.videoId,
        url: v.url,
        thumbnail: v.thumbnail,
        duration: v.timestamp,
        author: v.author.name
      }))
    };
  } catch (error) {
    console.error('❌ Playlist fetch error:', error.message);
    return null;
  }
}

module.exports = { getPlaylist };