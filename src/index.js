require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Create Discord client with all required intents
const client = new Client({
  intents: [
    // Server intents
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,

    // DM intents (required for private messages)
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
  ],
  // Partials — required so DM channels (which arrive uncached) can be handled
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`📦 Loaded command: ${command.data.name}`);
  } else {
    console.warn(`⚠️  Skipped ${file}: missing "data" or "execute"`);
  }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (!event.name || !event.execute) {
    console.warn(`⚠️  Skipped ${file}: missing "name" or "execute"`);
    continue;
  }
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`🔔 Loaded event: ${event.name}`);
}

// Global error handlers — prevents crashes from killing the bot
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);