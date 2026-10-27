
const axios = require('axios');

const client = axios.create({
  timeout: 12000,
  headers: {
    'User-Agent': 'MolfoidBot/1.0 (Discord Bot)'
  }
});

async function searchWallhaven(query) {
  const { data } = await client.get(
    'https://wallhaven.cc/api/v1/search',
    {
      params: {
        q: query,
        sorting: 'relevance',
        order: 'desc',
        categories: '111',
        purity: '100'
      }
    }
  );

  return (data?.data || []).map(item => ({
    id: `wh-${item.id}`,
    title: `${query} Wallpaper (${item.resolution})`,
    pageUrl: item.url,
    imageUrl: item.path,
    thumbUrl: item.thumbs?.large || item.path,
    resolution: item.resolution,
    uploader: item.uploader?.username || 'Unknown',
    source: 'Wallhaven'
  }));
}

async function searchWaifu(query) {
  // Waifu.im is an anime-image source, not a general movie wallpaper API.
  const { data } = await client.get(
    'https://api.waifu.im/images',
    {
      params: {
        IncludedTags: 'waifu',
        IsNsfw: false,
        PageSize: 10
      }
    }
  );

  return (data?.items || []).map(item => ({
    id: `waifu-${item.image_id}`,
    title: `${query} Anime Wallpaper`,
    pageUrl: item.url,
    imageUrl: item.url,
    thumbUrl: item.url,
    resolution: `${item.width}x${item.height}`,
    uploader: item.artist?.name || 'Unknown',
    source: 'Waifu.im'
  }));
}

async function searchWallpapers(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  let results = [];

  // Primary provider
  try {
    results = await searchWallhaven(cleanQuery);
  } catch (error) {
    console.error(
      'Wallhaven failed:',
      error.response?.status || error.message
    );
  }

  // Anime fallback only when Wallhaven returns no results.
  if (results.length === 0) {
    try {
      results = await searchWaifu(cleanQuery);
    } catch (error) {
      console.error(
        'Waifu.im failed:',
        error.response?.status || error.message
      );
    }
  }

  return results.slice(0, 20);
}

module.exports = { searchWallpapers };
