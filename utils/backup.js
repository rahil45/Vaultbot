const fs      = require('fs');
const path    = require('path');
const { ChannelType, PermissionsBitField } = require('discord.js');

// On Railway: use persistent volume. Locally: use ./data/backups
const BACKUPS_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'backups')
  : path.join(__dirname, '..', 'data', 'backups');

if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Backup ────────────────────────────────────────────────────────────────────

/**
 * Create a full backup of a guild's structure.
 * @param {import('discord.js').Guild} guild
 * @returns {string} backupId
 */
async function createBackup(guild) {
  const backupId = `${guild.id}_${Date.now()}`;

  // ── Roles ──
  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id) // exclude @everyone
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id:          r.id,
      name:        r.name,
      color:       r.color,
      hoist:       r.hoist,
      position:    r.position,
      permissions: r.permissions.bitfield.toString(),
      mentionable: r.mentionable,
      icon:        r.icon,
      unicodeEmoji: r.unicodeEmoji,
    }));

  // ── Channels ──
  const categories = [];
  const channels   = [];

  for (const [, ch] of guild.channels.cache) {
    const perms = ch.permissionOverwrites?.cache.map(ow => ({
      id:    ow.id,
      type:  ow.type, // 0 = role, 1 = member
      allow: ow.allow.bitfield.toString(),
      deny:  ow.deny.bitfield.toString(),
    })) || [];

    const base = {
      id:       ch.id,
      name:     ch.name,
      type:     ch.type,
      position: ch.position,
      perms,
    };

    if (ch.type === ChannelType.GuildCategory) {
      categories.push(base);
    } else {
      channels.push({
        ...base,
        topic:           ch.topic || null,
        nsfw:            ch.nsfw || false,
        rateLimitPerUser: ch.rateLimitPerUser || 0,
        parentId:        ch.parentId || null,
        bitrate:         ch.bitrate || null,
        userLimit:       ch.userLimit || null,
        defaultAutoArchiveDuration: ch.defaultAutoArchiveDuration || null,
      });
    }
  }

  // ── Emoji ──
  const emojis = guild.emojis.cache.map(e => ({
    name:     e.name,
    url:      e.imageURL(),
    animated: e.animated,
  }));

  // ── Server Settings ──
  const settings = {
    name:                   guild.name,
    icon:                   guild.iconURL({ dynamic: true }),
    description:            guild.description,
    verificationLevel:      guild.verificationLevel,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    explicitContentFilter:  guild.explicitContentFilter,
    afkTimeout:             guild.afkTimeout,
    systemChannelFlags:     guild.systemChannelFlags?.bitfield?.toString() || '0',
  };

  // ── Bans (optional, requires BAN_MEMBERS perm) ──
  let bans = [];
  try {
    const banList = await guild.bans.fetch();
    bans = banList.map(b => ({ userId: b.user.id, reason: b.reason }));
  } catch {
    // no permission
  }

  const backup = {
    id:         backupId,
    guildId:    guild.id,
    guildName:  guild.name,
    createdAt:  new Date().toISOString(),
    auto:       false,
    settings,
    roles,
    categories,
    channels,
    emojis,
    bans,
  };

  fs.writeFileSync(
    path.join(BACKUPS_DIR, `${backupId}.json`),
    JSON.stringify(backup, null, 2)
  );

  return backupId;
}

// ── Restore ───────────────────────────────────────────────────────────────────

/**
 * Restore a backup onto a target guild.
 * @param {import('discord.js').Guild} targetGuild
 * @param {string} backupId
 * @param {{ restoreRoles, restoreChannels, restoreSettings, clearExisting }} opts
 */
async function restoreBackup(targetGuild, backupId, opts = {}) {
  const {
    restoreRoles    = true,
    restoreChannels = true,
    restoreSettings = true,
    clearExisting   = true,
  } = opts;

  const file = path.join(BACKUPS_DIR, `${backupId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Backup ${backupId} not found.`);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));

  const log = [];

  // ── 1. Apply server settings ──────────────────────────────────────────────
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
    } catch (e) {
      log.push(`⚠️ Settings restore failed: ${e.message}`);
    }
  }

  // ── 2. Clear existing channels/roles if requested ─────────────────────────
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

  // ── 3. Restore roles ──────────────────────────────────────────────────────
  const roleMap = {}; // old ID -> new role
  if (restoreRoles) {
    const sortedRoles = [...backup.roles].reverse(); // lowest position first
    for (const r of sortedRoles) {
      try {
        const newRole = await targetGuild.roles.create({
          name:        r.name,
          color:       r.color,
          hoist:       r.hoist,
          permissions: BigInt(r.permissions),
          mentionable: r.mentionable,
          reason:      'VaultBot restore',
        });
        roleMap[r.id] = newRole;
        await sleep(300);
      } catch (e) {
        log.push(`⚠️ Role "${r.name}" failed: ${e.message}`);
      }
    }
    log.push(`✅ Roles restored (${Object.keys(roleMap).length}/${backup.roles.length})`);
  }

  // Helper: map permission overwrites from old IDs to new IDs
  function mapPerms(perms) {
    return perms.map(p => {
      const newId = roleMap[p.id]?.id || p.id;
      return { id: newId, type: p.type, allow: BigInt(p.allow), deny: BigInt(p.deny) };
    });
  }

  // ── 4. Restore categories ─────────────────────────────────────────────────
  const categoryMap = {};
  if (restoreChannels) {
    const sortedCats = [...backup.categories].sort((a, b) => a.position - b.position);
    for (const cat of sortedCats) {
      try {
        const newCat = await targetGuild.channels.create({
          name:                 cat.name,
          type:                 ChannelType.GuildCategory,
          position:             cat.position,
          permissionOverwrites: mapPerms(cat.perms),
          reason:               'VaultBot restore',
        });
        categoryMap[cat.id] = newCat;
        await sleep(300);
      } catch (e) {
        log.push(`⚠️ Category "${cat.name}" failed: ${e.message}`);
      }
    }
    log.push(`✅ Categories restored (${Object.keys(categoryMap).length}/${backup.categories.length})`);

    // ── 5. Restore channels ────────────────────────────────────────────────
    const sortedChannels = [...backup.channels].sort((a, b) => a.position - b.position);
    let chCount = 0;

    for (const ch of sortedChannels) {
      // Skip DM types
      if ([ChannelType.DM, ChannelType.GroupDM].includes(ch.type)) continue;

      try {
        const parentId = ch.parentId ? categoryMap[ch.parentId]?.id : undefined;
        const options  = {
          name:                 ch.name,
          type:                 ch.type,
          position:             ch.position,
          permissionOverwrites: mapPerms(ch.perms),
          parent:               parentId,
          reason:               'VaultBot restore',
        };

        if (ch.topic)            options.topic            = ch.topic;
        if (ch.nsfw)             options.nsfw             = ch.nsfw;
        if (ch.rateLimitPerUser) options.rateLimitPerUser = ch.rateLimitPerUser;
        if (ch.bitrate)          options.bitrate          = ch.bitrate;
        if (ch.userLimit)        options.userLimit        = ch.userLimit;

        await targetGuild.channels.create(options);
        chCount++;
        await sleep(300);
      } catch (e) {
        log.push(`⚠️ Channel "#${ch.name}" failed: ${e.message}`);
      }
    }
    log.push(`✅ Channels restored (${chCount}/${backup.channels.length})`);
  }

  return { success: true, log, backup };
}

// ── List & Delete backups ─────────────────────────────────────────────────────

function listBackups(guildId) {
  return fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith(guildId) && f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, f), 'utf8'));
      return { id: data.id, name: data.guildName, createdAt: data.createdAt, roleCount: data.roles.length, channelCount: data.channels.length + data.categories.length };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Lists ALL backups across every guild — used for recovery when you're in a new server
function listAllBackups() {
  return fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, f), 'utf8'));
      return { id: data.id, guildId: data.guildId, name: data.guildName, createdAt: data.createdAt, roleCount: data.roles.length, channelCount: data.channels.length + data.categories.length, auto: data.auto || false };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getBackup(backupId) {
  const file = path.join(BACKUPS_DIR, `${backupId}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function deleteBackup(backupId) {
  const file = path.join(BACKUPS_DIR, `${backupId}.json`);
  if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
  return false;
}

module.exports = { createBackup, restoreBackup, listBackups, listAllBackups, getBackup, deleteBackup };
