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

// Discord client
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

let discordChannel = null;

discord.once('ready', async () => {
  console.log(`Discord bot ready: ${discord.user.tag}`);
  discordChannel = await discord.channels.fetch(DISCORD_CHANNEL_ID);
});

// Discord -> SMS
discord.on('messageCreate', async (msg) => {
  if (msg.channelId !== DISCORD_CHANNEL_ID) return;
  if (msg.author.bot) return;

  // We need a target number — store last inbound SMS number
  const toNumber = lastSender;
  if (!toNumber) {
    console.log('No SMS sender to reply to yet.');
    return;
  }

  const text = `[${msg.author.username}]: ${msg.content}`;

  const msgParams = {
    from: TWILIO_NUMBER,
    to: toNumber,
    body: text,
  };

  // Forward attachments as MMS
  if (msg.attachments.size > 0) {
    msgParams.mediaUrl = msg.attachments.first().url;
  }

  try {
    await twilioClient.messages.create(msgParams);
    console.log(`Sent SMS to ${toNumber}: ${text}`);
  } catch (e) {
    console.error('Twilio send error:', e.message);
  }
});

// Track last SMS sender so we know who to reply to
let lastSender = null;

// Twilio -> Discord
app.post('/sms', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0');

  lastSender = from;
  console.log(`Inbound SMS from ${from}: ${body}`);

  if (!discordChannel) {
    console.error('Discord channel not ready');
    res.sendStatus(200);
    return;
  }

  let content = `📱 **${from}**: ${body}`;

  // Handle MMS media
  const mediaUrls = [];
  for (let i = 0; i < numMedia; i++) {
    mediaUrls.push(req.body[`MediaUrl${i}`]);
  }

  if (mediaUrls.length > 0) {
    content += '\n' + mediaUrls.join('\n');
  }

  try {
    await discordChannel.send(content);
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
