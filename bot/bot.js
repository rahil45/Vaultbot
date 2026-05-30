require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require('discord.js');
const fs            = require('fs');
const path          = require('path');
const logger        = require('../utils/logger');
const autoBackup    = require('../utils/autoBackup');
const db            = require('../utils/database');

// ── Discord Client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

// ── Load Commands ─────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandFiles = fs.readdirSync(path.join(__dirname, '../commands')).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(__dirname, '../commands', file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`[Commands] Loaded: /${command.data.name}`);
  }
}

// ── Ready Event ───────────────────────────────────────────────────────────────
client.on(Events.ClientReady, () => {
  console.log(`\n✅ VaultBot online as ${client.user.tag}`);
  console.log(`📡 Serving ${client.guilds.cache.size} servers`);
  logger.setClient(client);
  autoBackup.startScheduler(client);
  client.user.setPresence({
    activities: [{ name: '/setup | VaultBot', type: ActivityType.Watching }],
    status: 'online',
  });
});

// ── Interaction Handler ───────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Owner-only guard for sensitive commands
  const ownerOnly = ['pull', 'restore'];
  if (ownerOnly.includes(interaction.commandName)) {
    if (interaction.user.id !== process.env.OWNER_ID && interaction.user.id !== interaction.guild?.ownerId) {
      return interaction.reply({
        content: '❌ Only the server owner can use this command.',
        ephemeral: true,
      });
    }
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Command Error] /${interaction.commandName}:`, err);
    const reply = { content: `❌ An error occurred: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// ── Welcome message on member join ───────────────────────────────────────────
client.on(Events.GuildMemberAdd, async member => {
  try {
    const cfg = db.getGuildConfig(member.guild.id);
    if (!cfg.welcomeChannelId) return;

    const channel = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
    if (!channel) return;

    const { sendWelcomeMessage } = require('../commands/welcome');
    await sendWelcomeMessage(channel, member, member.guild, cfg);
  } catch (err) {
    console.error('[Welcome] Error:', err.message);
  }
});

// ── Guild Join Event ──────────────────────────────────────────────────────────
client.on(Events.GuildCreate, guild => {
  console.log(`[Guild] Joined: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);
});

module.exports = { client };
