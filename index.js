require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER;
const DISCORD_BOT_ID = process.env.DISCORD_BOT_ID || '1477458117921996901';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Discord client — monitors channel for bot replies to forward to SMS
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

discord.once('ready', async () => {
  console.log(`Discord bridge ready: ${discord.user.tag}`);
  console.log(`Monitoring channel: ${DISCORD_CHANNEL_ID}`);
  console.log(`Forwarding replies from bot: ${DISCORD_BOT_ID}`);
});

// Track SMS senders so we know who to reply to
let lastSender = null;

// Discord -> SMS: forward bot (IAMB1/OpenClaw) replies back to SMS
discord.on('messageCreate', async (msg) => {
  if (msg.channelId !== DISCORD_CHANNEL_ID) return;

  // Only forward messages from the AI bot
  if (msg.author.id !== DISCORD_BOT_ID) return;

  // Skip our own webhook posts
  if (msg.webhookId) return;

  const toNumber = lastSender;
  if (!toNumber) {
    console.log('Bot replied but no SMS sender to forward to.');
    return;
  }

  // Clean up the message for SMS
  let text = msg.content;

  const msgParams = {
    from: TWILIO_NUMBER,
    to: toNumber,
    body: text,
  };

  if (msg.attachments.size > 0) {
    msgParams.mediaUrl = [msg.attachments.first().url];
  }

  try {
    await twilioClient.messages.create(msgParams);
    console.log(`Forwarded bot reply via SMS to ${toNumber}: ${text.substring(0, 80)}...`);
  } catch (e) {
    console.error('Twilio send error:', e.message);
  }
});

// Twilio -> Discord: post SMS via webhook so the bot sees it as a mention
app.post('/sms', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0');

  lastSender = from;
  console.log(`Inbound SMS from ${from}: ${body}`);

  // Build message content — @mention the bot so OpenClaw responds
  let content = `${body}\n\n<@${DISCORD_BOT_ID}>`;

  // Handle MMS media
  const mediaUrls = [];
  for (let i = 0; i < numMedia; i++) {
    mediaUrls.push(req.body[`MediaUrl${i}`]);
  }
  if (mediaUrls.length > 0) {
    content += '\n' + mediaUrls.join('\n');
  }

  try {
    if (DISCORD_WEBHOOK_URL) {
      // Post via webhook — appears as a separate user, not the bot
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          username: `SMS ${from}`,
        }),
      });
      console.log('Posted SMS to Discord via webhook');
    } else {
      // Fallback: post as the bot (OpenClaw won't respond to its own messages)
      const channel = await discord.channels.fetch(DISCORD_CHANNEL_ID);
      await channel.send(content);
      console.log('Posted SMS to Discord as bot (webhook not configured)');
    }
  } catch (e) {
    console.error('Discord send error:', e.message);
  }

  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

app.get('/', (req, res) => res.send('SMS-Discord bridge running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

discord.login(process.env.DISCORD_TOKEN);
