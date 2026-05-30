const fs   = require('fs');
const path = require('path');
const { createBackup } = require('./backup');
const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');
 
const INTERVAL_HOURS = 24;
let _client = null;
 
function setClient(client) { _client = client; }
 
function getBackupsDir() {
  const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH
    || (process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(__dirname, '..', 'data'));
  const dir = path.join(dataDir, 'backups');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(dir))     fs.mkdirSync(dir,     { recursive: true });
  } catch (e) {
    console.error('[AutoBackup] Dir create failed:', e.message);
  }
  return dir;
}
 
async function runAutoBackups() {
  if (!_client) return;
 
  const guilds = _client.guilds.cache;
  console.log(`[AutoBackup] Running for ${guilds.size} server(s)...`);
 
  for (const [, guild] of guilds) {
    try {
      const BACKUPS_DIR = getBackupsDir();
      console.log(`[AutoBackup] Using dir: ${BACKUPS_DIR}`);
 
      // createBackup already deletes old backups before saving new one
      const backupId = await createBackup(guild);
 
      // Patch auto flag
      const file = path.join(BACKUPS_DIR, `${backupId}.json`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.auto  = true;
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
 
      console.log(`[AutoBackup] ✅ ${guild.name} (${guild.id}) — ${backupId}`);
 
      await logger.sendLog(guild.id, new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔄 Auto-Backup Completed')
        .addFields(
          { name: '🔑 Backup ID', value: `\`${backupId}\``,                                  inline: false },
          { name: '📁 Roles',     value: `${data.roles.length}`,                             inline: true  },
          { name: '📁 Channels',  value: `${data.channels.length + data.categories.length}`, inline: true  },
          { name: '🗑️ Old Backups', value: 'Deleted — only latest kept',                     inline: true  },
        )
        .setFooter({ text: `Auto-backup runs every ${INTERVAL_HOURS}h • Use /restore to recover` })
        .setTimestamp()
      );
 
    } catch (err) {
      console.error(`[AutoBackup] ❌ Failed for ${guild.name}: ${err.message}`);
    }
 
    await new Promise(r => setTimeout(r, 2000));
  }
}
 
function startScheduler(client) {
  _client = client;
  setClient(client);
  setTimeout(() => {
    runAutoBackups();
    setInterval(runAutoBackups, INTERVAL_HOURS * 60 * 60 * 1000);
  }, 30_000);
  console.log(`[AutoBackup] Scheduler started — runs every ${INTERVAL_HOURS}h`);
}
 
module.exports = { startScheduler, runAutoBackups, setClient };
