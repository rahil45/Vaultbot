const fs      = require('fs');
const path    = require('path');
const { ChannelType } = require('discord.js');

// ── Data directory ────────────────────────────────────────────────────────────
function getDataDir() {
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (process.env.RAILWAY_ENVIRONMENT)       return '/data';
  return path.join(__dirname, '..', 'data');
}

function getBackupsDir() {
  const dir = path.join(getDataDir(), 'backups');
  try {
    if (!fs.existsSync(getDataDir())) fs.mkdirSync(getDataDir(), { recursive: true });
    if (!fs.existsSync(dir))          fs.mkdirSync(dir,          { recursive: true });
  } catch (e) {
    console.error('[Backup] Dir create failed:', e.message);
  }
  return dir;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Backup ────────────────────────────────────────────────────────────────────
async function createBackup(guild) {
  const BACKUPS_DIR = getBackupsDir();
  const backupId    = `${guild.id}_${Date.now()}`;

  // Roles
  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id:           r.id,
      name:         r.name,
      color:        r.color,
      hoist:        r.hoist,
      position:     r.position,
      permissions:  r.permissions.bitfield.toString(),
      mentionable:  r.mentionable,
      icon:         r.icon,
      unicodeEmoji: r.unicodeEmoji,
    }));

  // Channels & categories
  const categories = [];
  const channels   = [];

  for (const [, ch] of guild.channels.cache) {
    const perms = ch.permissionOverwrites?.cache.map(ow => ({
      id:    ow.id,
      type:  ow.type,
      allow: ow.allow.bitfield.toString(),
      deny:  ow.deny.bitfield.toString(),
    })) || [];

    const base = { id: ch.id, name: ch.name, type: ch.type, position: ch.position, perms };

    if (ch.type === ChannelType.GuildCategory) {
      categories.push(base);
    } else {
      channels.push({
        ...base,
        topic:            ch.topic || null,
        nsfw:             ch.nsfw || false,
        rateLimitPerUser: ch.rateLimitPerUser || 0,
        parentId:         ch.parentId || null,
        bitrate:          ch.bitrate || null,
        userLimit:        ch.userLimit || null,
        defaultAutoArchiveDuration: ch.defaultAutoArchiveDuration || null,
      });
    }
  }

  // Emojis
  const emojis = guild.emojis.cache.map(e => ({
    name: e.name, url: e.imageURL(), animated: e.animated,
  }));

  // Server settings
  const settings = {
    name:                        guild.name,
    icon:                        guild.iconURL({ dynamic: true }),
    description:                 guild.description,
    verificationLevel:           guild.verificationLevel,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    explicitContentFilter:       guild.explicitContentFilter,
    afkTimeout:                  guild.afkTimeout,
    systemChannelFlags:          guild.systemChannelFlags?.bitfield?.toString() || '0',
  };

  // Bans
  let bans = [];
  try {
    const banList = await guild.bans.fetch();
    bans = banList.map(b => ({ userId: b.user.id, reason: b.reason }));
  } catch {}

  const backup = {
    id: backupId, guildId: guild.id, guildName: guild.name,
    createdAt: new Date().toISOString(), auto: false,
    settings, roles, categories, channels, emojis, bans,
  };

  // ── Delete ALL previous backups for this guild — keep only latest ──────────
  try {
    const existing = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith(guild.id) && f.endsWith('.json'));
    for (const old of existing) {
      fs.unlinkSync(path.join(BACKUPS_DIR, old));
      console.log(`[Backup] 🗑️ Deleted old backup: ${old}`);
    }
  } catch (e) {
    console.error('[Backup] Failed to delete old backups:', e.message);
  }

  const outFile = path.join(BACKUPS_DIR, `${backupId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(backup, null, 2));
  console.log(`[Backup] ✅ Saved to ${outFile}`);
  return backupId;
}

// ── Restore ───────────────────────────────────────────────────────────────────
async function restoreBackup(targetGuild, backupId, opts = {}) {
  const { restoreRoles = true, restoreChannels = true, restoreSettings = true, clearExisting = true } = opts;

  const file = path.join(getBackupsDir(), `${backupId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Backup ${backupId} not found.`);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  const log    = [];

  if (restoreSettings) {
    try {
      await targetGuild.edit({
        name:              backup.settings.name,
        verificationLevel: backup.settings.verificationLevel,
        defaultMessageNotifications: backup.settings.defaultMessageNotifications,
        explicitContentFilter: backup.settings.explicitContentFilter,
        afkTimeout:        backup.settings.afkTimeout,
      });
      log.push('✅ Server settings restored');
    } catch (e) { log.push(`⚠️ Settings failed: ${e.message}`); }
  }

  if (clearExisting) {
    for (const [, ch] of targetGuild.channels.cache) {
      try { await ch.delete('VaultBot restore'); await sleep(300); } catch {}
    }
    log.push('🗑️ Existing channels cleared');
    for (const [, role] of targetGuild.roles.cache) {
      if (role.id === targetGuild.id || role.managed || role.position >= targetGuild.members.me.roles.highest.position) continue;
      try { await role.delete('VaultBot restore'); await sleep(300); } catch {}
    }
    log.push('🗑️ Existing roles cleared');
  }

  const roleMap = {};
  if (restoreRoles) {
    for (const r of [...backup.roles].reverse()) {
      try {
        const newRole = await targetGuild.roles.create({
          name: r.name, color: r.color, hoist: r.hoist,
          permissions: BigInt(r.permissions), mentionable: r.mentionable,
          reason: 'VaultBot restore',
        });
        roleMap[r.id] = newRole;
        await sleep(300);
      } catch (e) { log.push(`⚠️ Role "${r.name}": ${e.message}`); }
    }
    log.push(`✅ Roles restored (${Object.keys(roleMap).length}/${backup.roles.length})`);
  }

  function mapPerms(perms) {
    return perms.map(p => ({
      id: roleMap[p.id]?.id || p.id, type: p.type,
      allow: BigInt(p.allow), deny: BigInt(p.deny),
    }));
  }

  const categoryMap = {};
  if (restoreChannels) {
    for (const cat of [...backup.categories].sort((a, b) => a.position - b.position)) {
      try {
        const newCat = await targetGuild.channels.create({
          name: cat.name, type: ChannelType.GuildCategory,
          position: cat.position, permissionOverwrites: mapPerms(cat.perms),
          reason: 'VaultBot restore',
        });
        categoryMap[cat.id] = newCat;
        await sleep(300);
      } catch (e) { log.push(`⚠️ Category "${cat.name}": ${e.message}`); }
    }
    log.push(`✅ Categories restored (${Object.keys(categoryMap).length}/${backup.categories.length})`);

    let chCount = 0;
    for (const ch of [...backup.channels].sort((a, b) => a.position - b.position)) {
      if ([ChannelType.DM, ChannelType.GroupDM].includes(ch.type)) continue;
      try {
        const options = {
          name: ch.name, type: ch.type, position: ch.position,
          permissionOverwrites: mapPerms(ch.perms),
          parent: ch.parentId ? categoryMap[ch.parentId]?.id : undefined,
          reason: 'VaultBot restore',
        };
        if (ch.topic)            options.topic            = ch.topic;
        if (ch.nsfw)             options.nsfw             = ch.nsfw;
        if (ch.rateLimitPerUser) options.rateLimitPerUser = ch.rateLimitPerUser;
        if (ch.bitrate)          options.bitrate          = ch.bitrate;
        if (ch.userLimit)        options.userLimit        = ch.userLimit;
        await targetGuild.channels.create(options);
        chCount++;
        await sleep(300);
      } catch (e) { log.push(`⚠️ Channel "#${ch.name}": ${e.message}`); }
    }
    log.push(`✅ Channels restored (${chCount}/${backup.channels.length})`);
  }

  return { success: true, log, backup };
}

// ── List & Delete ─────────────────────────────────────────────────────────────
function listBackups(guildId) {
  const dir = getBackupsDir();
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(guildId) && f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { id: data.id, name: data.guildName, createdAt: data.createdAt, auto: data.auto || false, roleCount: data.roles.length, channelCount: data.channels.length + data.categories.length };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function listAllBackups() {
  const dir = getBackupsDir();
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { id: data.id, guildId: data.guildId, name: data.guildName, createdAt: data.createdAt, auto: data.auto || false, roleCount: data.roles.length, channelCount: data.channels.length + data.categories.length };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getBackup(backupId) {
  const file = path.join(getBackupsDir(), `${backupId}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function deleteBackup(backupId) {
  const file = path.join(getBackupsDir(), `${backupId}.json`);
  if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
  return false;
}

module.exports = { createBackup, restoreBackup, listBackups, listAllBackups, getBackup, deleteBackup };
