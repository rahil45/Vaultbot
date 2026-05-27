const fetch         = require('node-fetch');
const db            = require('./database');
const { getValidToken } = require('./tokenManager');

/**
 * Pull all verified members from a source guild into a target guild.
 *
 * Uses each member's stored OAuth2 access token with the guilds.join scope
 * to call PUT /guilds/{targetGuildId}/members/{userId} — this is the official
 * Discord API endpoint for adding authorized users to a server.
 *
 * @param {string} sourceGuildId   - Guild whose verified member list to use
 * @param {string} targetGuildId   - Guild to pull members into
 * @param {string} botToken        - Bot token (bot must be in target guild)
 * @param {string|null} roleId     - Optional role to assign on join
 * @param {Function} onProgress    - Callback(done, total, username)
 * @returns {{ success, pulled, failed, skipped }}
 */
async function pullMembers(sourceGuildId, targetGuildId, botToken, roleId = null, onProgress = null) {
  const members = db.getMembersForGuild(sourceGuildId);

  if (!members.length) {
    return { success: false, error: 'No verified members found for this server.' };
  }

  let pulled  = 0;
  let failed  = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < members.length; i++) {
    const member = members[i];

    try {
      // Get a fresh, valid access token
      const accessToken = await getValidToken(member);
      if (!accessToken) {
        failed++;
        errors.push({ user: member.username, reason: 'Token refresh failed' });
        continue;
      }

      // Build payload
      const body = { access_token: accessToken };
      if (roleId) body.roles = [roleId];

      const res = await fetch(
        `https://discord.com/api/v10/guilds/${targetGuildId}/members/${member.userId}`,
        {
          method:  'PUT',
          headers: {
            Authorization:  `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (res.status === 201) {
        // 201 = user was added
        pulled++;
      } else if (res.status === 204) {
        // 204 = user was already in the server
        skipped++;
      } else if (res.status === 429) {
        // Rate limited — wait and retry
        const retry = res.headers.get('retry-after');
        await sleep((parseFloat(retry) + 0.5) * 1000);
        i--; // retry this member
        continue;
      } else {
        const body = await res.text();
        failed++;
        errors.push({ user: member.username, reason: `HTTP ${res.status}: ${body}` });
      }
    } catch (err) {
      failed++;
      errors.push({ user: member.username, reason: err.message });
    }

    // Progress callback
    if (onProgress) onProgress(i + 1, members.length, member.username);

    // Discord rate limit: ~10 req/10s for this endpoint
    await sleep(1100);
  }

  return { success: true, total: members.length, pulled, failed, skipped, errors };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { pullMembers };
