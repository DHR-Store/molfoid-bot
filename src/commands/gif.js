const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { searchGif } = require('../utils/gif');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Send a GIF related to your query')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('What kind of GIF do you want?')
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString('query');
    await interaction.deferReply();

    const gifUrl = await searchGif(query);

    if (!gifUrl) {
      return interaction.editReply('😕 No GIF found for that query.');
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`GIF: ${query}`)
      .setImage(gifUrl) // Embed displays the GIF directly
      .setFooter({ text: 'Powered by Tenor' });

    await interaction.editReply({ embeds: [embed] });
  },
};