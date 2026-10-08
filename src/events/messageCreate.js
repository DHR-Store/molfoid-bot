const { EmbedBuilder } = require('discord.js');
const { askGroq } = require('../utils/groq');
const { searchGif } = require('../utils/gif');

const cooldowns = new Map();
const COOLDOWN_MS = 3000;

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bots (prevents loops)
    if (message.author.bot) return;

    // Ignore system messages
    if (message.system) return;

    const isDM = !message.guild;

    // ---- Mention check ----
    // In servers: only respond when mentioned
    // In DMs: respond to every message
    if (!isDM && !message.mentions.has(message.client.user.id)) return;

    // ---- Cooldown ----
    const now = Date.now();
    const last = cooldowns.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) {
      return message.react('⏳').catch(() => {});
    }
    cooldowns.set(message.author.id, now);

    // ---- Extract prompt ----
    // Strip the bot mention if present, otherwise use full message
    let prompt = message.content
      .replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '')
      .trim();

    // Empty prompt handling
    if (!prompt) {
      return message.reply(
        "Hi! 👋 Ask me anything. Example: `What is Node.js?`\nTip: include the word **gif** to get a GIF too."
      );
    }

    try {
      await message.channel.sendTyping();
      console.log(`💬 ${isDM ? '[DM]' : '[Server]'} ${message.author.tag}: ${prompt}`);

      const wantsGif = /\bgif\b/i.test(prompt);
      const gifQuery = prompt.replace(/\bgif\b/i, '').trim() || 'celebration';

      const [aiResponse, gifUrl] = await Promise.all([
        askGroq(prompt),
        wantsGif ? searchGif(gifQuery) : Promise.resolve(null),
      ]);

      const chunks = aiResponse.match(/[\s\S]{1,1900}/g) || [aiResponse];

      if (gifUrl) {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setDescription(chunks[0])
          .setImage(gifUrl)
          .setFooter({ text: `Requested by ${message.author.username}` });
        await message.reply({ embeds: [embed] });
      } else {
        await message.reply(chunks[0]);
      }

      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
      }
    } catch (error) {
      console.error('❌ messageCreate error:', error);
      await message.reply('❌ Something went wrong.').catch(() => {});
    }
  },
};