const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { purgeMessages } = require('../utils/function');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) // Only mods can see/use this
    .addIntegerOption(opt => 
      opt.setName('amount').setDescription('Number of messages (1-100)')
    )
    .addUserOption(opt => 
      opt.setName('user').setDescription('Only delete messages from this user')
    )
    .addStringOption(opt => 
      opt.setName('time').setDescription('Only delete messages from the last X time (e.g., 1h, 30m)')
    ),
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user');
    const timeStr = interaction.options.getString('time');

    await interaction.deferReply({ ephemeral: true });

    // Package arguments the way purgeMessages expects them
    const args = [];
    if (amount) args.push(String(amount));
    if (targetUser) args.push(targetUser.id);
    if (timeStr) args.push(timeStr);

    // Wrap interaction to mimic message for the function
    const mockMessage = {
      guild: interaction.guild,
      client: interaction.client,
      channel: interaction.channel,
      reply: async (msg) => interaction.editReply(msg)
    };

    await purgeMessages(mockMessage, args);
  },
};