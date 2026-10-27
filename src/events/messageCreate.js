const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  AttachmentBuilder 
} = require('discord.js');
const axios = require('axios');
const { askGroq } = require('../utils/groq');
const { searchGif } = require('../utils/gif');
const { searchMusicList, fetchSongByUrl } = require('../utils/music');
const { fetchAudioUrl } = require('../utils/ytmusic');
const { searchYouTube } = require('../utils/ytsearch');
const { getPlaylist } = require('../utils/playlist'); 
const { searchWallpapers } = require('../utils/wallpaper'); 
const { searchIMDb } = require('../utils/tvshow'); 

const cooldowns = new Map();
const COOLDOWN_MS = 3000;

const chatHistories = new Map();

const STICKERS = {
  teasing: '123456789012345678',
  smug: '123456789012345678',
  pouting: '123456789012345678',
  mischievous: '123456789012345678',
  blushing: '123456789012345678',
  comforting: '123456789012345678',
  'angry-pout': '123456789012345678',
  blank: '123456789012345678',
  broken: '123456789012345678'
};

// OPTIMIZED: Strict 15s timeout to prevent Suga server from killing the bot (SIGTERM)
async function downloadAudioBuffer(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity' 
      },
      timeout: 15000 // 15 seconds max!
    });
    return Buffer.from(response.data);
  } catch (error) {
    console.error('❌ Audio download failed or timed out:', error.message);
    return null;
  }
}

// --- Helpers for Pagalnew ---
function buildMusicEmbed(song) {
  let safeThumbnail = song.thumbnail;
  if (safeThumbnail && safeThumbnail.includes('pagalnew.com')) {
    const cleanUrl = safeThumbnail.replace(/^https?:\/\//, '');
    safeThumbnail = `https://images.weserv.nl/?url=${cleanUrl}`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xff69b4)
    .setTitle(song.title || 'Unknown Song')
    .setURL(song.url)
    .setThumbnail(safeThumbnail || null)
    .addFields(
      { name: '🎤 Singer(s)', value: song.singers || '—', inline: true },
      { name: '🎬 Movie / Album', value: song.movie || '—', inline: true },
      { name: '🎵 Composer', value: song.composer || '—', inline: true }
    )
    .setFooter({ text: 'Pagalnew Download' });

  if (song.starring) embed.addFields({ name: '⭐ Starring', value: song.starring, inline: false });
  if (song.releasedOn) embed.addFields({ name: '📅 Released', value: song.releasedOn, inline: true });
  return embed;
}

function buildMusicRows(list, song) {
  const components = [];
  if (list.length > 1) {
    const options = list.slice(0, 25).map((item, idx) => ({
      label: (item.title || `Result ${idx + 1}`).substring(0, 100),
      value: String(idx),
      description: item.artist ? item.artist.substring(0, 100) : undefined,
      emoji: '🎵'
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId('music_pick_msg')
      .setPlaceholder(`📋 ${list.length} results — pick a song`)
      .addOptions(options);
    components.push(new ActionRowBuilder().addComponents(select));
  }

  const buttons = [];
  if (song.download320) buttons.push(new ButtonBuilder().setLabel('💎 320 kbps').setStyle(ButtonStyle.Link).setURL(song.download320));
  if (song.download128) buttons.push(new ButtonBuilder().setLabel('🎧 128 kbps').setStyle(ButtonStyle.Link).setURL(song.download128));
  if (buttons.length === 0) buttons.push(new ButtonBuilder().setLabel('🌐 Open Page').setStyle(ButtonStyle.Link).setURL(song.url));
  
  components.push(new ActionRowBuilder().addComponents(...buttons));
  return components;
}

// --- Helper for YT Embed ---
function buildYTEmbed(video, dlUrl) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(video.title)
    .setURL(video.url)
    .setThumbnail(video.thumbnail)
    .addFields(
      { name: '👤 Channel', value: video.author, inline: true },
      { name: '⏱️ Duration', value: video.duration, inline: true }
    )
    .setFooter({ text: 'YouTube MP3 Download' });

  const components = [];
  if (dlUrl) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🎧 Direct Download (320kbps)').setStyle(ButtonStyle.Link).setURL(dlUrl)
    ));
  } else {
    embed.setDescription('❌ Failed to generate download link (API Error).');
  }
  return { embed, components };
}

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot || message.system) return;

    const isDM = !message.guild;
    if (!isDM && !message.mentions.has(message.client.user.id)) return;

    const now = Date.now();
    const last = cooldowns.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return message.react('⏳').catch(() => {});
    cooldowns.set(message.author.id, now);

    let prompt = message.content;
    prompt = prompt.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '');
    
    const otherMentions = message.mentions.users.filter(u => u.id !== message.client.user.id);
    otherMentions.forEach(user => {
      prompt = prompt.replace(new RegExp(`<@!?${user.id}>`, 'g'), `@${user.username}`);
    });
    
    prompt = prompt.trim();

    if (!prompt) {
      return message.reply("*sends an annoyed sticker* What the hell do you want? At least say something, moron.");
    }

    try {
      await message.channel.sendTyping();
      console.log(`💬 ${isDM ? '[DM]' : '[Server]'} ${message.author.tag}: ${prompt}`);

      if (prompt.toLowerCase().includes('reset memory') || prompt.toLowerCase() === 'reset') {
        chatHistories.delete(message.author.id);
        return message.reply("*sends a smug sticker* Tch... fine, I forgot everything we talked about. Happy now, idiot?");
      }

      // ==========================================
      // --- 1. WALLPAPER SEARCH ---
      // ==========================================
      const isWallpaperReq = /^(wallpaper|wp)\s+(.+)$/i.test(prompt);

      if (isWallpaperReq) {
        const query = prompt.replace(/^(wallpaper|wp)\s+/i, '').trim();
        const allResults = await searchWallpapers(query);

        if (!allResults || allResults.length === 0) {
          return message.reply(`*sends an annoyed sticker* Tch... I couldn't find any wallpapers for "${query}", idiot.`);
        }

        let currentPage = 0;
        const itemsPerPage = 5;
        const totalPages = Math.ceil(allResults.length / itemsPerPage);

        const generateWallpaperPayload = (page) => {
          const start = page * itemsPerPage;
          const pageResults = allResults.slice(start, start + itemsPerPage);

          const textList = pageResults.map((wp, index) => {
            return `**${start + index + 1}.** [${wp.title.substring(0, 80)}](${wp.pageUrl})`;
          }).join('\n\n');

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`🖼️ Wallpaper Search: "${query}"`)
            .setDescription(textList || 'No results found.')
            .setFooter({ text: `Page ${page + 1}/${totalPages} | Click titles to view` });

          const components = [];
          if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('wp_prev')
                .setLabel('◀️ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
              new ButtonBuilder()
                .setCustomId('wp_next')
                .setLabel('Next ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
            ));
          }

          return {
            content: `*sends a smug sticker* Tch... here are some "${query}" wallpapers.`,
            embeds: [embed],
            components: components
          };
        };

        const replyMsg = await message.reply(generateWallpaperPayload(currentPage));

        if (totalPages > 1) {
          const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });
          collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
            if (i.customId === 'wp_prev') {
              currentPage--;
              await i.update(generateWallpaperPayload(currentPage));
            } else if (i.customId === 'wp_next') {
              currentPage++;
              await i.update(generateWallpaperPayload(currentPage));
            }
          });
          collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        }
        return;
      }

      // ==========================================
      // --- 2. IMDB MOVIE/TV SEARCH ---
      // ==========================================
      const isImdbReq = /^(movie|tv|show|film)\s+(.+)$/i.test(prompt);

      if (isImdbReq) {
        const query = prompt.replace(/^(movie|tv|show|film)\s+/i, '').trim();
        const allResults = await searchIMDb(query);

        if (!allResults || allResults.length === 0) {
          return message.reply(`*sends a pouting sticker* Tch... I couldn't find any movies or shows for "${query}", baka.`);
        }

        let currentPage = 0;
        const itemsPerPage = 5;
        const totalPages = Math.ceil(allResults.length / itemsPerPage);

        const generateImdbPayload = (page) => {
          const start = page * itemsPerPage;
          const pageResults = allResults.slice(start, start + itemsPerPage);

          const embeds = pageResults.map((item, index) => {
            const typeEmoji = item.type === 'tvSeries' ? '📺' : item.type === 'movie' ? '🎬' : '🎞️';
            const embed = new EmbedBuilder()
              .setColor(0xf5c518)
              .setTitle(`${typeEmoji} ${item.title} (${item.year})`)
              .setURL(`https://www.imdb.com/title/${item.id}/`)
              .setFooter({ text: `Type: ${item.type} | Click title for IMDb page` });
              
            if (item.image) embed.setThumbnail(item.image);
            return embed;
          });

          const components = [];
          if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('imdb_prev')
                .setLabel('◀️ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
              new ButtonBuilder()
                .setCustomId('imdb_next')
                .setLabel('Next ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
            ));
          }

          return {
            content: `*sends a smug sticker* Hmph. Here are the IMDb results for "${query}". Go watch your stupid movies. (Page ${page + 1}/${totalPages})`,
            embeds: embeds,
            components: components
          };
        };

        const replyMsg = await message.reply(generateImdbPayload(currentPage));

        if (totalPages > 1) {
          const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });
          collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
            if (i.customId === 'imdb_prev') {
              currentPage--;
              await i.update(generateImdbPayload(currentPage));
            } else if (i.customId === 'imdb_next') {
              currentPage++;
              await i.update(generateImdbPayload(currentPage));
            }
          });
          collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        }
        return;
      }

      // ==========================================
      // --- 3. PLAYLIST GENERATOR ---
      // ==========================================
      const isPlaylistRequest = prompt.toLowerCase().includes('playlist') || prompt.toLowerCase().includes('mix');

      if (isPlaylistRequest) {
        let query = prompt.replace(/\b(playlist|mix|make|a|of|the|music|songs?)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (!query) query = prompt;

        const playlistData = await getPlaylist(query);

        if (!playlistData) {
          return message.reply(`*sends an angry sticker* Tch... I couldn't find any playlist for "${query}", idiot.`);
        }

        let currentPage = 0;
        const itemsPerPage = 10;
        const totalPages = Math.ceil(playlistData.videos.length / itemsPerPage);

        const generatePlaylistPayload = (page) => {
          const start = page * itemsPerPage;
          const pageVideos = playlistData.videos.slice(start, start + itemsPerPage);

          const songList = pageVideos.map((v, i) => {
            return `**${start + i + 1}.** [${v.title.substring(0, 50)}...](${v.url}) \`${v.duration}\``;
          }).join('\n');

          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`🎶 ${message.author.username}'s Playlist: ${playlistData.title}`)
            .setDescription(songList || 'No songs found.')
            .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Songs: ${playlistData.videos.length}` });

          const options = pageVideos.map((v, index) => ({
            label: v.title.substring(0, 100),
            value: String(start + index), 
            description: `${v.author} • ${v.duration}`.substring(0, 100),
            emoji: '🎵'
          }));

          const select = new StringSelectMenuBuilder()
            .setCustomId('playlist_pick')
            .setPlaceholder(`🎧 Pick a song to play`)
            .addOptions(options);

          const components = [new ActionRowBuilder().addComponents(select)];

          if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('playlist_prev')
                .setLabel('◀️ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
              new ButtonBuilder()
                .setCustomId('playlist_next')
                .setLabel('Next ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
            ));
          }

          return { embeds: [embed], components };
        };

        const replyMsg = await message.reply(generatePlaylistPayload(currentPage));

        const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });

        collector.on('collect', async (i) => {
          if (i.user.id !== message.author.id) {
            return i.reply({ content: "❌ This playlist isn't for you, baka!", ephemeral: true });
          }

          if (i.customId === 'playlist_prev') {
            currentPage--;
            await i.update(generatePlaylistPayload(currentPage));
          } 
          else if (i.customId === 'playlist_next') {
            currentPage++;
            await i.update(generatePlaylistPayload(currentPage));
          } 
          else if (i.customId === 'playlist_pick') {
            await i.deferUpdate();
            const picked = playlistData.videos[Number(i.values[0])]; 
            const dlUrl = await fetchAudioUrl(picked.id);
            const { embed, components } = buildYTEmbed(picked, dlUrl);

            if (dlUrl) {
              const audioBuffer = await downloadAudioBuffer(dlUrl);
              if (audioBuffer) {
                const attachment = new AttachmentBuilder(audioBuffer, { name: `${picked.title.substring(0, 50)}.mp3` });
                await i.editReply({ 
                  content: `▶️ **Now Playing from Playlist:**\n*(Click the song title above to open on YouTube)*`, 
                  embeds: [embed], 
                  components,
                  files: [attachment]
                });
              } else {
                await i.editReply({ 
                  content: `▶️ **Direct Link:**\n${dlUrl}\n\n*(Click the song title above to open on YouTube)*`, 
                  embeds: [embed], 
                  components 
                });
              }
            } else {
              await i.editReply({ 
                content: `*sends a smug sticker* Fine, here's "${picked.title}".`, 
                embeds: [embed], 
                components 
              });
            }
          }
        });

        collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        return;
      }

      // ==========================================
      // --- 4. YOUTUBE SEARCH DROPDOWN ---
      // ==========================================
      const isYtSearch = /^(search|find)\s+(.+?)\s+yt$/i.test(prompt);

      if (isYtSearch) {
        const query = prompt.replace(/^(search|find)\s+/i, '').replace(/\s+yt$/i, '').trim();
        const results = await searchYouTube(query);

        if (results.length === 0) {
          return message.reply(`*sends a pouting sticker* Tch... I couldn't find any YouTube video for "${query}", baka.`);
        }

        let currentPage = 0;
        const itemsPerPage = 5;
        const totalPages = Math.ceil(results.length / itemsPerPage);

        const generateSearchPayload = (page) => {
          const start = page * itemsPerPage;
          const pageResults = results.slice(start, start + itemsPerPage);

          const searchEmbeds = pageResults.map((v, i) => {
            const globalIndex = start + i + 1;
            return new EmbedBuilder()
              .setColor(0xff0000)
              .setTitle(`${globalIndex}. ${v.title.substring(0, 80)}`)
              .setURL(v.url) 
              .setThumbnail(v.thumbnail) 
              .addFields(
                { name: 'Channel', value: v.author.substring(0, 30), inline: true },
                { name: 'Duration', value: v.duration, inline: true }
              );
          });

          const options = pageResults.map((v, index) => ({
            label: v.title.substring(0, 100),
            value: String(start + index), 
            description: `${v.author} • ${v.duration}`.substring(0, 100),
            emoji: '🎧'
          }));
          
          const select = new StringSelectMenuBuilder()
            .setCustomId('yt_search_pick')
            .setPlaceholder(`📋 ${results.length} results — pick one`)
            .addOptions(options);

          const components = [new ActionRowBuilder().addComponents(select)];

          if (totalPages > 1) {
            const paginationRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('yt_prev')
                .setLabel('◀️ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
              new ButtonBuilder()
                .setCustomId('yt_next')
                .setLabel('Next ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
            );
            components.push(paginationRow);
          }

          return {
            content: `*sends an annoyed sticker* Tch... Page ${page + 1}/${totalPages} for "${query}". Pick one, moron.`,
            embeds: searchEmbeds,
            components: components
          };
        };

        const replyMsg = await message.reply(generateSearchPayload(currentPage));

        const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });

        collector.on('collect', async (i) => {
          if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });

          if (i.customId === 'yt_prev') { currentPage--; await i.update(generateSearchPayload(currentPage)); } 
          else if (i.customId === 'yt_next') { currentPage++; await i.update(generateSearchPayload(currentPage)); } 
          else if (i.customId === 'yt_search_pick') {
            await i.deferUpdate();
            const picked = results[Number(i.values[0])];
            const dlUrl = await fetchAudioUrl(picked.id);
            const { embed, components } = buildYTEmbed(picked, dlUrl);

            if (dlUrl) {
              const audioBuffer = await downloadAudioBuffer(dlUrl);
              if (audioBuffer) {
                const attachment = new AttachmentBuilder(audioBuffer, { name: `${picked.title.substring(0, 50)}.mp3` });
                await i.editReply({ content: `▶️ **Audio Player:**`, embeds: [embed], components, files: [attachment] });
              } else {
                await i.editReply({ content: `▶️ **Direct Link:**\n${dlUrl}`, embeds: [embed], components });
              }
            } else {
              await i.editReply({ content: `*sends a smug sticker* Fine, here's "${picked.title}".`, embeds: [embed], components });
            }
          }
        });

        collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        return;
      }

      // ==========================================
      // --- 5. YOUTUBE DIRECT DOWNLOAD ---
      // ==========================================
      const isYtDirect = / yt$/i.test(prompt);

      if (isYtDirect) {
        const query = prompt.replace(/ yt$/i, '').replace(/\b(give|me|play|search|find|download|the|a|song|music|mp3)\b/gi, '').replace(/\s+/g, ' ').trim() || prompt.replace(/ yt$/i, '').trim();
        
        const results = await searchYouTube(query);
        if (results.length === 0) return message.reply(`*sends a pouting sticker* Tch... I couldn't find that on YouTube, baka.`);

        const picked = results[0];
        const dlUrl = await fetchAudioUrl(picked.id);
        const { embed, components } = buildYTEmbed(picked, dlUrl);

        if (dlUrl) {
          const audioBuffer = await downloadAudioBuffer(dlUrl);
          if (audioBuffer) {
             const attachment = new AttachmentBuilder(audioBuffer, { name: `${picked.title.substring(0, 50)}.mp3` });
             return message.reply({ content: `▶️ **Audio Player:**`, embeds: [embed], components, files: [attachment] });
          } else {
             return message.reply({ content: `▶️ **Direct Link:**\n${dlUrl}`, embeds: [embed], components });
          }
        } else {
          return message.reply({ content: `*sends a smug sticker* Tch... fine, here's "${query}".`, embeds: [embed], components });
        }
      }

      // ==========================================
      // --- 6. PAGALNEW MUSIC SEARCH (WITH YOUTUBE FALLBACK) ---
      // ==========================================
      const isMusicRequest = /\b(give|play|search|find|download)\b.*\b(song|music|mp3)\b/i.test(prompt) || /^play\s+/i.test(prompt) || prompt.toLowerCase().includes('song');

      if (isMusicRequest) {
        let query = prompt.replace(/\b(give|me|play|search|find|download|the|a|song|music|mp3)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (!query) query = prompt;

        const list = await searchMusicList(query);
        
        if (!list || list.length === 0) {
          console.log(`⚠️ Pagalnew failed/blocked, falling back to YouTube for: ${query}`);
          const ytResults = await searchYouTube(`${query} song`);
          
          if (ytResults.length > 0) {
            const picked = ytResults[0];
            const dlUrl = await fetchAudioUrl(picked.id);
            const { embed, components } = buildYTEmbed(picked, dlUrl);

            if (dlUrl) {
              const audioBuffer = await downloadAudioBuffer(dlUrl);
              if (audioBuffer) {
                const attachment = new AttachmentBuilder(audioBuffer, { name: `${picked.title.substring(0, 50)}.mp3` });
                return message.reply({ 
                  content: `*sends a smug sticker* Tch... the download site is being annoying, so I found it on YouTube. Here:`, 
                  embeds: [embed], 
                  components, 
                  files: [attachment] 
                });
              } else {
                return message.reply({ 
                  content: `*sends a smug sticker* Tch... the download site is being annoying, so I found it on YouTube. Here:`, 
                  embeds: [embed], 
                  components 
                });
              }
            } else {
              return message.reply({ 
                content: `*sends a smug sticker* Tch... the download site is being annoying, so I found it on YouTube. Here:`, 
                embeds: [embed], 
                components 
              });
            }
          } else {
            return message.reply(`*sends a pouting sticker* Tch... I couldn't find any song called "${query}", baka.`);
          }
        }

        const first = await fetchSongByUrl(list[0].url);
        if (!first) return message.reply("*sends a broken sticker* The download site gave me garbage data. Try again later, idiot.");

        const molfoidText = `*sends a smug sticker* Tch... fine, here's "${query}". Don't expect me to do this every time, dummy.`;
        
        const replyMsg = await message.reply({
          content: molfoidText,
          embeds: [buildMusicEmbed(first)],
          components: buildMusicRows(list, first)
        });

        if (list.length > 1) {
          const collector = replyMsg.createMessageComponentCollector({ filter: (i) => i.customId === 'music_pick_msg', time: 5 * 60 * 1000 });

          collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
            await i.deferUpdate();

            const picked = list[Number(i.values[0])];
            const song = await fetchSongByUrl(picked.url);

            if (song) {
              await i.editReply({ content: molfoidText, embeds: [buildMusicEmbed(song)], components: buildMusicRows(list, song) });
            }
          });

          collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        }
        return;
      }

      // ==========================================
      // --- 7. NORMAL AI CHAT (WITH GIFs & MEMORY) ---
      // ==========================================
      
      let aiPrompt = prompt;
      if (otherMentions.size > 0) {
        const lastMention = Array.from(otherMentions.values()).pop();
        aiPrompt = `[The user is talking to @${lastMention.username}] ${prompt}`;
      }
      
      let history = chatHistories.get(message.author.id) || [];

      history.push({ role: 'user', content: aiPrompt });

      if (history.length > 10) {
        history = history.slice(history.length - 10);
      }

      let aiResponse = await askGroq(history);

      let gifQuery = null;
      const aiGifMatch = aiResponse.match(/\[gif:\s*(.*?)\]/i);
      
      if (aiGifMatch) {
        gifQuery = aiGifMatch[1].trim();
        aiResponse = aiResponse.replace(aiGifMatch[0], '').trim();
      } 
      else if (/\bgif\b/i.test(prompt)) {
        gifQuery = prompt.replace(/\bgif\b/i, '').trim() || 'angry anime girl';
      }

      let gifUrl = null;
      if (gifQuery) {
        gifUrl = await searchGif(gifQuery);
      }

      let stickerId = null;
      const stickerMatch = aiResponse.match(/\*sends an? ([a-z-]+) sticker\*/i);
      if (stickerMatch) {
        const stickerName = stickerMatch[1].toLowerCase();
        const foundId = STICKERS[stickerName];
        if (foundId && foundId !== '123456789012345678') stickerId = foundId;
        aiResponse = aiResponse.replace(stickerMatch[0], '').trim();
      }

      const cleanAiResponse = aiResponse.replace(/\[gif:\s*(.*?)\]/ig, '').trim();
      history.push({ role: 'assistant', content: cleanAiResponse });
      chatHistories.set(message.author.id, history);

      const chunks = aiResponse.match(/[\s\S]{1,1900}/g) || [aiResponse];
      const firstPayload = {};

      if (chunks[0] && chunks[0].trim() !== '') firstPayload.content = chunks[0];

      if (gifUrl) {
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setImage(gifUrl)
          .setFooter({ text: `Requested by ${message.author.username}` });
        
        if (!firstPayload.content) {
          firstPayload.content = '*sends an angry sticker* Here is your stupid GIF.';
        }
        firstPayload.embeds = [embed];
      }

      if (stickerId) firstPayload.stickers = [stickerId];
      if (Object.keys(firstPayload).length === 0) firstPayload.content = '*sends a smug sticker*';

      await message.reply(firstPayload);

      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
      }
    } catch (error) {
      console.error('❌ messageCreate error:', error);
      await message.reply('❌ Something went wrong, idiot.').catch(() => {});
    }
  },
};