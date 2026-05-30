require('dotenv').config();

const PORT = process.env.PORT || 3000;

console.log('🚀 Starting VaultBot...');
console.log('📦 Node version:', process.version);
console.log('🌐 PORT:', PORT);
console.log('🔑 BOT_TOKEN set:', !!process.env.BOT_TOKEN);
console.log('🔑 CLIENT_ID set:', !!process.env.CLIENT_ID);
console.log('🔑 CLIENT_SECRET set:', !!process.env.CLIENT_SECRET);
console.log('🔑 REDIRECT_URI:', process.env.REDIRECT_URI);
console.log('🔑 ENCRYPTION_KEY set:', !!process.env.ENCRYPTION_KEY);
console.log('🔑 GUILD_ID:', process.env.GUILD_ID || 'not set (global deploy)');

// ── Ensure data directories exist ─────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const DATA_DIR    = process.env.RAILWAY_VOLUME_MOUNT_PATH || (process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(__dirname, 'data'));
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

try {
  if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  console.log('📁 Data directory:', DATA_DIR);
} catch (err) {
  console.error('❌ Could not create data directory:', err.message);
}

// ── Auto-deploy slash commands on every startup ───────────────────────────────
async function deployCommands() {
  try {
    // Use Routes from discord.js — NOT @discordjs/rest (Routes isn't exported there)
    const { REST, Routes } = require('discord.js');

    const commands = fs.readdirSync(path.join(__dirname, 'commands'))
      .filter(f => f.endsWith('.js'))
      .map(f => {
        try {
          return require(path.join(__dirname, 'commands', f)).data.toJSON();
        } catch (e) {
          console.error(`❌ Failed to load command ${f}:`, e.message);
          return null;
        }
      })
      .filter(Boolean); // remove any that failed to load

    console.log(`📋 Loaded ${commands.length} commands:`, commands.map(c => c.name).join(', '));

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Slash commands deployed to guild ${process.env.GUILD_ID} (${commands.length} commands)`);
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log(`✅ Slash commands deployed globally (${commands.length} commands)`);
    }
  } catch (err) {
    console.error('❌ Command deploy failed:', err.message);
  }
}

// ── Start web server FIRST (so Railway health check passes) ───────────────────
try {
  const { app } = require('./web/server');
  const server  = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server listening on 0.0.0.0:${PORT}`);
  });
  server.on('error', err => console.error('❌ Web server error:', err.message));
} catch (err) {
  console.error('❌ Failed to start web server:', err.message);
}

// ── Deploy commands then start bot ────────────────────────────────────────────
deployCommands().then(() => {
  try {
    const { client } = require('./bot/bot');
    client.login(process.env.BOT_TOKEN).catch(err => {
      console.error('❌ Discord login failed:', err.message);
    });
  } catch (err) {
    console.error('❌ Failed to load bot:', err.message);
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT',  () => { console.log('👋 Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('👋 Shutting down...'); process.exit(0); });
process.on('uncaughtException',  err => console.error('💥 Uncaught:', err.message));
process.on('unhandledRejection', err => console.error('💥 Unhandled:', err));
