const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { askGroq } = require('../utils/groq');
const { searchGif } = require('../utils/gif');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('molfoid')
    .setDescription('Ask Molfoid and get an AI reply with a GIF')
    .addStringOption((option) =>
      option.setName('prompt').setDescription('Your message').setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();

    // Run AI and GIF search in parallel
    const [aiResponse, gifUrl] = await Promise.all([
      askGroq(prompt),
      searchGif(prompt),
    ]);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Molfoid Response')
      .setDescription(aiResponse.substring(0, 1900))
      .setFooter({ text: `Query: ${prompt}` });

    if (gifUrl) embed.setImage(gifUrl);

    await interaction.editReply({ embeds: [embed] });
  },
};