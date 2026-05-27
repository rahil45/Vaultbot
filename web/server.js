require('dotenv').config();
const express        = require('express');
const fetch          = require('node-fetch');
const rateLimit      = require('express-rate-limit');
const { EmbedBuilder } = require('discord.js');
const db             = require('../utils/database');
const logger         = require('../utils/logger');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Role assignment helper ────────────────────────────────────────────────────
async function assignVerifiedRole(guildId, userId, roleId) {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      {
        method:  'PUT',
        headers: {
          Authorization: `Bot ${process.env.BOT_TOKEN}`,
          'X-Audit-Log-Reason': 'VaultBot Verification',
        },
      }
    );
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

// Rate limiting
const limiter = rateLimit({ windowMs: 60_000, max: 30 });
app.use(limiter);

// ── HTML helpers ─────────────────────────────────────────────────────────────

function page(title, body, color = '#5865F2') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'gg sans', 'Noto Sans', sans-serif;
      background: #0d0f13;
      color: #dcddde;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1e2124;
      border: 1px solid #2f3136;
      border-radius: 16px;
      padding: 40px 48px;
      text-align: center;
      max-width: 480px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,.5);
    }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h1 { font-size: 1.6rem; color: #fff; margin-bottom: 10px; }
    p  { color: #b9bbbe; line-height: 1.6; margin-bottom: 20px; }
    .badge {
      display: inline-block;
      background: ${color}22;
      color: ${color};
      border: 1px solid ${color}44;
      border-radius: 20px;
      padding: 4px 14px;
      font-size: .85rem;
      font-weight: 600;
    }
    .username { color: #fff; font-weight: 700; }
    footer { margin-top: 24px; font-size: .75rem; color: #72767d; }
  </style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

// ── OAuth2 Callback Route ─────────────────────────────────────────────────────

app.get('/auth/callback', async (req, res) => {
  const { code, state: guildId, error } = req.query;

  if (error || !code) {
    return res.send(page('Verification Cancelled', `
      <div class="icon">❌</div>
      <h1>Verification Cancelled</h1>
      <p>You cancelled the verification process. No data was saved.</p>
    `, '#ed4245'));
  }

  if (!guildId) {
    return res.send(page('Invalid Link', `
      <div class="icon">⚠️</div>
      <h1>Invalid Verification Link</h1>
      <p>This link is missing required information. Please get a new link from your server.</p>
    `, '#faa61a'));
  }

  try {
    // ── Exchange code for tokens ──────────────────────────────────────────────
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[OAuth] Token exchange failed:', err);
      return res.send(page('Verification Failed', `
        <div class="icon">❌</div>
        <h1>Verification Failed</h1>
        <p>Could not exchange your code for a token. Please try verifying again.</p>
      `, '#ed4245'));
    }

    const tokens = await tokenRes.json();

    // ── Get user info ────────────────────────────────────────────────────────
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return res.send(page('Verification Failed', `
        <div class="icon">❌</div>
        <h1>Could Not Get User Info</h1>
        <p>Failed to fetch your Discord profile. Please try again.</p>
      `, '#ed4245'));
    }

    const user = await userRes.json();

    // ── Check if scopes include guilds.join ──────────────────────────────────
    if (!tokens.scope.includes('guilds.join')) {
      return res.send(page('Incomplete Permissions', `
        <div class="icon">⚠️</div>
        <h1>Incomplete Permissions</h1>
        <p>The <strong>guilds.join</strong> permission was not granted. Please reverify and accept all requested permissions.</p>
      `, '#faa61a'));
    }

    // ── Save to database ──────────────────────────────────────────────────────
    db.saveMember({
      userId:       user.id,
      guildId,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn:    tokens.expires_in,
      username:     user.username,
      avatar:       user.avatar,
    });

    // ── Load guild config ─────────────────────────────────────────────────────
    const guildConfig  = db.getGuildConfig(guildId);

    // ── Step 1: Add user to the guild (works even if they left) ──────────────
    const joinBody = { access_token: tokens.access_token };
    if (guildConfig.verifiedRoleId) joinBody.roles = [guildConfig.verifiedRoleId];

    const joinRes = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
      {
        method:  'PUT',
        headers: {
          Authorization:  `Bot ${process.env.BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(joinBody),
      }
    );

    // ── Step 2: Assign role separately (covers already-in-server case) ───────
    let roleAssigned   = false;
    let roleName       = '';
    if (guildConfig.verifiedRoleId) {
      roleAssigned = await assignVerifiedRole(guildId, user.id, guildConfig.verifiedRoleId);
      roleName     = guildConfig.verifiedRoleName || 'Verified';
    }

    console.log(`[OAuth] ✅ Verified: ${user.username} (${user.id}) for guild ${guildId}`);

    // ── Send log to log channel ───────────────────────────────────────────────
    const totalVerified = db.getMemberCount(guildId);
    const avatarUrl     = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;

    const logEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor({ name: `${user.username} verified`, iconURL: avatarUrl })
      .setThumbnail(avatarUrl)
      .addFields(
        { name: '◦ User',             value: `<@${user.id}> \`${user.username}\``,           inline: true },
        { name: '◦ User ID',          value: `\`${user.id}\``,                               inline: true },
        { name: '◦ Role Assigned',    value: roleAssigned ? `<@&${guildConfig.verifiedRoleId}>` : '`None`', inline: false },
        { name: '◦ Verified At',       value: `<t:${Math.floor(Date.now() / 1000)}:F>`,      inline: false },
        { name: '◦ Total Verified',    value: `\`${totalVerified}\` members`,                inline: false },
      )
      .setFooter({ text: `VaultBot • Verification Log` })
      .setTimestamp();

    await logger.sendLog(guildId, logEmbed);

    return res.send(page('Verified!', `
      <div class="icon">✅</div>
      <h1>Verification Successful!</h1>
      <p>Welcome, <span class="username">${user.username}</span>! You now have access to the server.</p>
      ${roleAssigned ? `<span class="badge">🎖️ Role Assigned: ${roleName}</span><br><br>` : ''}
      <span class="badge">🔒 Securely Verified</span>
      <footer>You can revoke this authorization at any time via Discord Settings → Authorized Apps</footer>
    `, '#57f287'));

  } catch (err) {
    console.error('[OAuth] Unexpected error:', err);
    return res.send(page('Server Error', `
      <div class="icon">🔧</div>
      <h1>Something Went Wrong</h1>
      <p>An unexpected error occurred. Please try again later.</p>
    `, '#ed4245'));
  }
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── 404 ───────────────────────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).send(page('Not Found', `
  <div class="icon">🔍</div>
  <h1>Page Not Found</h1>
  <p>This page doesn't exist.</p>
`, '#ed4245')));

module.exports = { app };
