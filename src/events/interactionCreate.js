// events/interactionCreate.js (or wherever this file is located)

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // ==========================================
    // 1. Handle Slash Commands (/ping, /purge)
    // ==========================================
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`❌ Error executing /${interaction.commandName}:`, error);
        const reply = {
          content: '❌ There was an error executing this command.',
          ephemeral: true,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    // ==========================================
    // 2. Handle Buttons (For future Pro Bot menus)
    // ==========================================
    if (interaction.isButton()) {
      // Optional: If you move from collectors to global buttons later
      // console.log(`Button clicked: ${interaction.customId}`);
      return;
    }

    // ==========================================
    // 3. Handle Select Menus (For future Pro Bot menus)
    // ==========================================
    if (interaction.isStringSelectMenu()) {
      // Optional: If you move from collectors to global dropdowns later
      // console.log(`Menu selected: ${interaction.customId}`);
      return;
    }
  },
};