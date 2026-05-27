const { createBackup, listBackups, deleteBackup } = require('./backup');
const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');

const INTERVAL_HOURS = 24;   // how often to auto-backup
const MAX_AUTO_KEEP  = 5;    // keep only the 5 most recent auto-backups per guild
const AUTO_TAG       = 'AUTO';

let _client = null;

function setClient(client) {
  _client = client;
}

/**
 * Run an auto-backup for every guild the bot is currently in.
 */
async function runAutoBackups() {
  if (!_client) return;

  const guilds = _client.guilds.cache;
  console.log(`[AutoBackup] Running auto-backup for ${guilds.size} server(s)...`);

  for (const [, guild] of guilds) {
    try {
      // Create backup and mark it as auto
      const backupId = await createBackup(guild);

      // Patch the auto flag onto the saved file
      const fs   = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', 'data', 'backups', `${backupId}.json`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.auto  = true;
      fs.writeFileSync(file, JSON.stringify(data, null, 2));

      console.log(`[AutoBackup] ✅ ${guild.name} (${guild.id}) — ${backupId}`);

      // Prune old auto-backups — keep only MAX_AUTO_KEEP
      const allBackups = listBackups(guild.id);
      const autoBackups = allBackups.filter(b => b.auto !== false); // includes ones just patched

      // re-read to get auto flag
      const fs2   = require('fs');
      const path2 = require('path');
      const BACKUPS_DIR = path2.join(__dirname, '..', 'data', 'backups');
      const autoOnes = fs2.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith(guild.id) && f.endsWith('.json'))
        .map(f => JSON.parse(fs2.readFileSync(path2.join(BACKUPS_DIR, f), 'utf8')))
        .filter(b => b.auto === true)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Delete oldest ones beyond MAX_AUTO_KEEP
      for (const old of autoOnes.slice(MAX_AUTO_KEEP)) {
        deleteBackup(old.id);
        console.log(`[AutoBackup] 🗑️ Pruned old auto-backup: ${old.id}`);
      }

      // Send log to guild's log channel
      await logger.sendLog(guild.id, new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔄 Auto-Backup Completed')
        .addFields(
          { name: '🔑 Backup ID',  value: `\`${backupId}\``,                       inline: false },
          { name: '📁 Roles',      value: `${data.roles.length}`,                  inline: true  },
          { name: '📁 Channels',   value: `${data.channels.length + data.categories.length}`, inline: true },
          { name: '💾 Auto-saves', value: `${Math.min(autoOnes.length, MAX_AUTO_KEEP)} / ${MAX_AUTO_KEEP} kept`, inline: true },
        )
        .setFooter({ text: `Auto-backup runs every ${INTERVAL_HOURS}h • Use /restore to recover` })
        .setTimestamp()
      );

    } catch (err) {
      console.error(`[AutoBackup] ❌ Failed for ${guild.name}: ${err.message}`);
    }

    // Small delay between guilds to avoid rate limits
    await new Promise(r => setTimeout(r, 2000));
  }
}

/**
 * Start the auto-backup scheduler.
 * Runs once immediately after bot is ready, then every INTERVAL_HOURS.
 */
function startScheduler(client) {
  _client = client;
  setClient(client);

  // Initial run after 30s (let bot fully connect first)
  setTimeout(() => {
    runAutoBackups();
    // Then repeat on interval
    setInterval(runAutoBackups, INTERVAL_HOURS * 60 * 60 * 1000);
  }, 30_000);

  console.log(`[AutoBackup] Scheduler started — runs every ${INTERVAL_HOURS}h`);
}

module.exports = { startScheduler, runAutoBackups, setClient };
