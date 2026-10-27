const ytdl = require('@pontalabs/ytdl');

async function fetchAudioUrl(videoId) {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const audio = await ytdl.downloadAudio(videoUrl, 320); 
    return audio?.download?.downloadUrl || null;
  } catch (e) {
    console.error('❌ @pontalabs/ytdl download error:', e.message);
    return null;
  }
}

module.exports = { fetchAudioUrl };