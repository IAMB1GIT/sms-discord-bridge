require('dotenv').config();
const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_NUMBER = process.env.TWILIO_NUMBER;
const DISCORD_BOT_ID = process.env.DISCORD_BOT_ID || '1477458117921996901';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Track SMS senders so we know who to reply to
const smsSenders = new Map(); // phone -> { lastSeen }
let lastSender = null;

// Twilio -> Discord: post SMS via webhook, @mention bot
app.post('/sms', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0');

  lastSender = from;
  smsSenders.set(from, { lastSeen: Date.now() });
  console.log(`Inbound SMS from ${from}: ${body}`);

  let content = `${body}\n\n<@${DISCORD_BOT_ID}>`;

  const mediaUrls = [];
  for (let i = 0; i < numMedia; i++) {
    mediaUrls.push(req.body[`MediaUrl${i}`]);
  }
  if (mediaUrls.length > 0) {
    content += '\n' + mediaUrls.join('\n');
  }

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        username: `SMS ${from}`,
      }),
    });
    console.log('Posted SMS to Discord via webhook');
  } catch (e) {
    console.error('Discord webhook error:', e.message);
  }

  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// OpenClaw -> SMS: endpoint for OpenClaw to send replies back via SMS
// OpenClaw calls POST /reply with { to: "+1...", body: "message" }
app.post('/reply', async (req, res) => {
  const to = req.body.to || lastSender;
  const body = req.body.body || req.body.text || '';

  if (!to) {
    console.error('No recipient for SMS reply');
    return res.status(400).json({ error: 'No recipient' });
  }

  const msgParams = {
    from: TWILIO_NUMBER,
    to,
    body,
  };

  if (req.body.mediaUrl) {
    msgParams.mediaUrl = [req.body.mediaUrl];
  }

  try {
    await twilioClient.messages.create(msgParams);
    console.log(`Sent SMS to ${to}: ${body.substring(0, 80)}...`);
    res.json({ success: true });
  } catch (e) {
    console.error('Twilio send error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Status endpoint
app.get('/', (req, res) => res.json({
  status: 'running',
  lastSender,
  senders: Object.fromEntries(smsSenders),
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SMS bridge listening on port ${PORT} (no Discord login)`));
