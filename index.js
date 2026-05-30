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
    const { REST, Routes } = require('@discordjs/rest');
    const commands = fs.readdirSync(path.join(__dirname, 'commands'))
      .filter(f => f.endsWith('.js'))
      .map(f => require(path.join(__dirname, 'commands', f)).data.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

    // Deploy to specific guild if GUILD_ID is set — instant
    // Otherwise deploy globally — takes up to 1 hour
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
