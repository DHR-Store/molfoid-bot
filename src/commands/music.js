const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { searchMusicList, fetchSongByUrl } = require('../utils/music');

// --- helpers -------------------------------------------------------------

function buildEmbed(song) {
  const embed = new EmbedBuilder()
    .setColor(0xff69b4)
    .setTitle(song.title || 'Unknown Song')
    .setURL(song.url)
    .setThumbnail(song.thumbnail || null)
    .addFields(
      { name: '🎤 Singer(s)', value: song.singers || '—', inline: true },
      { name: '🎬 Movie / Album', value: song.movie || '—', inline: true },
      { name: '🎵 Composer', value: song.composer || '—', inline: true }
    )
    .setFooter({ text: 'Click the title to open the song on Pagalnew' });

  if (song.starring) {
    embed.addFields({ name: '⭐ Starring', value: song.starring, inline: false });
  }
  if (song.releasedOn) {
    embed.addFields({ name: '📅 Released', value: song.releasedOn, inline: true });
  }
  return embed;
}

function buildDownloadRow(song) {
  const buttons = [];
  if (song.download320) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('💎 320 kbps Download')
        .setStyle(ButtonStyle.Link)
        .setURL(song.download320)
    );
  }
  if (song.download128) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('🎧 128 kbps Download')
        .setStyle(ButtonStyle.Link)
        .setURL(song.download128)
    );
  }
  if (buttons.length === 0) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('🌐 Open Song Page')
        .setStyle(ButtonStyle.Link)
        .setURL(song.url)
    );
  }
  return new ActionRowBuilder().addComponents(...buttons);
}

function buildSelectRow(list) {
  // Discord allows max 25 options per select menu
  const options = list.slice(0, 25).map((item, idx) => {
    const opt = {
      label: (item.title || `Result ${idx + 1}`).substring(0, 100),
      value: String(idx),
    };
    if (item.artist) opt.description = item.artist.substring(0, 100);
    return opt;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('music_pick')
    .setPlaceholder(`📋 ${list.length} results — pick a song`)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

// --- command -------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Search for a song and get high-quality download links (shows ALL results)')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('The song name or artist')
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString('query');
    await interaction.deferReply();

    // 1. Fetch ALL results from the search page
    const list = await searchMusicList(query);
    if (!list || list.length === 0) {
      return interaction.editReply('❌ Could not find that song, baka. *pouts*');
    }

    // 2. Fetch details for the first result
    const first = await fetchSongByUrl(list[0].url);
    if (!first) {
      return interaction.editReply('❌ Could not load song details.');
    }

    // 3. Build components: [select menu (if >1)] + [download buttons]
    const components = [];
    if (list.length > 1) components.push(buildSelectRow(list));
    components.push(buildDownloadRow(first));

    const reply = await interaction.editReply({
      embeds: [buildEmbed(first)],
      components,
    });

    // 4. If multiple results, listen for dropdown picks
    if (list.length > 1) {
      const collector = reply.createMessageComponentCollector({
        filter: (i) => i.customId === 'music_pick',
        time: 5 * 60 * 1000, // 5 minutes
      });

      collector.on('collect', async (i) => {
        // Only the original user can pick
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
        }

        await i.deferUpdate();

        const picked = list[Number(i.values[0])];
        if (!picked) {
          return i.followUp({ content: '❌ That result vanished. Try again.', ephemeral: true });
        }

        const song = await fetchSongByUrl(picked.url);
        if (!song) {
          return i.followUp({ content: '❌ Failed to load that song.', ephemeral: true });
        }

        // Keep the select menu, swap in the new buttons
        await i.editReply({
          embeds: [buildEmbed(song)],
          components: [buildSelectRow(list), buildDownloadRow(song)],
        });
      });

      collector.on('end', () => {
        // Optional: disable the dropdown when collector expires
        const disabled = buildSelectRow(list);
        disabled.components[0].setDisabled(true);
        reply.edit({ components: [disabled] }).catch(() => {});
      });
    }
  },
};