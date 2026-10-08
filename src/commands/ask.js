const { SlashCommandBuilder } = require('discord.js');
const { askGroq } = require('../utils/groq');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask Molfoid anything using AI')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Your question or message')
        .setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');

    // Defer reply because AI may take a moment
    await interaction.deferReply();

    const aiResponse = await askGroq(prompt);

    // Discord has a 2000 character limit per message
    const truncated =
      aiResponse.length > 1900
        ? aiResponse.substring(0, 1900) + '...'
        : aiResponse;

    await interaction.editReply(`🤖 **Molfoid says:**\n${truncated}`);
  },
};