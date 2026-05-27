const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Paths ────────────────────────────────────────────────────────────────────
// On Railway: mount a volume at /data — this survives redeploys
// Locally: falls back to ./data inside the project
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : path.join(__dirname, '..', 'data');

const DB_FILE  = path.join(DATA_DIR, 'members.json');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE))     fs.writeFileSync(DB_FILE, JSON.stringify({ members: [] }));
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ guilds: {} }));

// ── Encryption helpers ────────────────────────────────────────────────────────
const ALGORITHM  = 'aes-256-gcm';
const KEY_STRING = (process.env.ENCRYPTION_KEY || 'fallback_key_32_chars_change_me!').padEnd(32, '0').slice(0, 32);
const KEY        = Buffer.from(KEY_STRING);

function encrypt(text) {
  const iv         = crypto.randomBytes(16);
  const cipher     = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  try {
    const [ivHex, authTagHex, encryptedHex] = text.split(':');
    const iv        = Buffer.from(ivHex, 'hex');
    const authTag   = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher  = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    return null;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save or update a verified member's OAuth2 tokens.
 */
function saveMember({ userId, guildId, accessToken, refreshToken, expiresIn, username, avatar }) {
  const db      = readDB();
  const expires = Date.now() + (expiresIn * 1000);
  const idx     = db.members.findIndex(m => m.userId === userId && m.guildId === guildId);
  const record  = {
    userId,
    guildId,
    accessToken:  encrypt(accessToken),
    refreshToken: encrypt(refreshToken),
    expiresAt:    expires,
    username,
    avatar,
    verifiedAt:   Date.now(),
  };
  if (idx >= 0) db.members[idx] = record;
  else          db.members.push(record);
  writeDB(db);
}

/**
 * Get all verified members for a guild.
 */
function getMembersForGuild(guildId) {
  const db = readDB();
  return db.members
    .filter(m => m.guildId === guildId)
    .map(m => ({
      ...m,
      accessToken:  decrypt(m.accessToken),
      refreshToken: decrypt(m.refreshToken),
    }));
}

/**
 * Get a single member record.
 */
function getMember(userId, guildId) {
  const db = readDB();
  const m  = db.members.find(m => m.userId === userId && m.guildId === guildId);
  if (!m) return null;
  return { ...m, accessToken: decrypt(m.accessToken), refreshToken: decrypt(m.refreshToken) };
}

/**
 * Count verified members for a guild.
 */
function getMemberCount(guildId) {
  const db = readDB();
  return db.members.filter(m => m.guildId === guildId).length;
}

/**
 * Update access token after refresh.
 */
function updateTokens(userId, guildId, accessToken, refreshToken, expiresIn) {
  const db  = readDB();
  const idx = db.members.findIndex(m => m.userId === userId && m.guildId === guildId);
  if (idx < 0) return;
  db.members[idx].accessToken  = encrypt(accessToken);
  db.members[idx].refreshToken = encrypt(refreshToken);
  db.members[idx].expiresAt    = Date.now() + (expiresIn * 1000);
  writeDB(db);
}

/**
 * Remove a member from the database.
 */
function removeMember(userId, guildId) {
  const db   = readDB();
  db.members = db.members.filter(m => !(m.userId === userId && m.guildId === guildId));
  writeDB(db);
}

// ── Guild Config ──────────────────────────────────────────────────────────────

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
function writeConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

/**
 * Save guild settings (verified role ID, etc.)
 */
function setGuildConfig(guildId, config) {
  const data = readConfig();
  data.guilds[guildId] = { ...(data.guilds[guildId] || {}), ...config };
  writeConfig(data);
}

/**
 * Get guild settings.
 */
function getGuildConfig(guildId) {
  const data = readConfig();
  return data.guilds[guildId] || {};
}

/**
 * List all unique guild IDs that have verified members saved.
 * Useful for recovery — owner can see all old server IDs.
 */
function listGuildsWithMembers() {
  const db = readDB();
  const map = {};
  for (const m of db.members) {
    if (!map[m.guildId]) map[m.guildId] = { guildId: m.guildId, count: 0, latest: 0 };
    map[m.guildId].count++;
    if (m.verifiedAt > map[m.guildId].latest) map[m.guildId].latest = m.verifiedAt;
  }
  return Object.values(map).sort((a, b) => b.latest - a.latest);
}

module.exports = {
  saveMember, getMembersForGuild, getMember, getMemberCount, updateTokens, removeMember,
  setGuildConfig, getGuildConfig, listGuildsWithMembers,
};
