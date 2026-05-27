require('dotenv').config();
const { client }  = require('./bot/bot');
const { app }     = require('./web/server');

const PORT = process.env.PORT || 3000;

// ── Validate config ───────────────────────────────────────────────────────────
const required = ['BOT_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI', 'ENCRYPTION_KEY'];
const missing  = required.filter(k => !process.env[k] || process.env[k].includes('your_'));

if (missing.length) {
  console.error('❌ Missing or unconfigured environment variables:');
  missing.forEach(k => console.error(`   • ${k}`));
  console.error('\nCopy .env.example to .env and fill in all values.');
  process.exit(1);
}

// ── Start web server ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐 OAuth2 web server running on port ${PORT}`);
  console.log(`   Callback URL: ${process.env.REDIRECT_URI}`);
});

// ── Start Discord bot ─────────────────────────────────────────────────────────
client.login(process.env.BOT_TOKEN).catch(err => {
  console.error('❌ Failed to login to Discord:', err.message);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down VaultBot...');
  client.destroy();
  process.exit(0);
});
