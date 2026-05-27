const fetch = require('node-fetch');
const db    = require('./database');

/**
 * Refresh a user's Discord OAuth2 access token if it's expired.
 * Returns a valid access token or null on failure.
 */
async function getValidToken(member) {
  // If token is still valid (with 5-min buffer), return it as-is
  if (member.expiresAt > Date.now() + 300_000) {
    return member.accessToken;
  }

  try {
    const res  = await fetch('https://discord.com/api/v10/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: member.refreshToken,
      }),
    });

    if (!res.ok) {
      console.warn(`[TokenRefresh] Failed for ${member.userId}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    db.updateTokens(member.userId, member.guildId, data.access_token, data.refresh_token, data.expires_in);
    return data.access_token;
  } catch (err) {
    console.error(`[TokenRefresh] Error for ${member.userId}:`, err.message);
    return null;
  }
}

module.exports = { getValidToken };
