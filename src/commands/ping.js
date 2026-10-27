const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot latency'),
  async execute(interaction) {
    await interaction.reply(`🏓 Pong! Latency is **${Math.round(interaction.client.ws.ping)}ms**.`);
  },
};