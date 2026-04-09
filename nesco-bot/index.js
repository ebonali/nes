const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cron = require('node-cron');
const mongoose = require('mongoose');
const express = require('express');

// ==================== INITIALIZE ====================
const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const jar = new CookieJar();
const client = wrapper(axios.create({
  jar,
  withCredentials: true,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Origin': 'https://customer.nesco.gov.bd',
    'Referer': 'https://customer.nesco.gov.bd/pre/panel'
  }
}));

const NESCO_URL = 'https://customer.nesco.gov.bd/pre/panel';
const LOG_FILE = path.join(__dirname, 'customer_logs.txt');
const AD_TEXT = `\n\n📢 *বিজ্ঞাপন:*\nআমরা আপনাদের প্রয়োজন অনুযায়ী যেকোনো ওয়েবসাইট প্রফেশনাল ভাবে বানিয়ে থাকি। যোগাযোগ করুন: @Devify\\_BD`;



// ==================== MONGODB SETUP ====================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch(err => console.error('MongoDB connection error:', err));

const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  chatId: { type: String, required: true },
  username: { type: String, default: '' },
  name: { type: String, default: '' },
  meters: { type: [String], default: [] }
});
const User = mongoose.model('User', UserSchema);

// ==================== LOGGING ====================
function saveToLog(user, cust_no, result) {
  const timestamp = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
  const userName = user ? `${user.first_name || ''} (@${user.username || 'N/A'}) [ID: ${user.id}]` : 'Auto Notification';
  const plain = result.replace(/\*/g, '').replace(/`/g, '');

  const entry = `
========================================
Time: ${timestamp}
User: ${userName}
Checked: ${cust_no}
----------------------------------------
${plain.trim()}
========================================
`;
  fs.appendFile(LOG_FILE, entry, (err) => {
    if (err) console.error('Log Error:', err);
  });
}

// ==================== NESCO FETCH ====================
async function fetchNescoData(cust_no) {
  try {
    const getRes = await client.get(NESCO_URL);
    const $ = cheerio.load(getRes.data);
    const token = $('input[name="_token"]').val();
    if (!token) throw new Error('Token not found');

    const postData = new URLSearchParams();
    postData.append('_token', token);
    postData.append('cust_no', cust_no);
    postData.append('submit', 'রিচার্জ হিস্ট্রি');

    const postRes = await client.post(NESCO_URL, postData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const $r = cheerio.load(postRes.data);

    const name = ($r('label:contains("গ্রাহকের নাম")').next().find('input').val() || 'N/A').trim();
    const balance = ($r('label:contains("অবশিষ্ট ব্যালেন্স (টাকা)")').next().find('input').val() || 'N/A').trim();
    const balanceTime = ($r('label:contains("অবশিষ্ট ব্যালেন্স (টাকা)")').find('span').text().trim() || '').replace(/\s+/g, ' ');
    const meterNo = ($r('label:contains("মিটার নম্বর")').next().find('input').val() || 'N/A').trim();

    if (name === 'N/A' && balance === 'N/A') return null;

    return { name, balance, balanceTime, meterNo, cust_no };
  } catch (e) {
    console.error(`Error fetching for ${cust_no}:`, e.message);
    throw e;
  }
}

function formatResult(data) {
  const safeName = (data.name || '').replace(/[_*`]/g, '');
  const safeTime = (data.balanceTime || '').replace(/[_*`]/g, '');
  
  let msg = '';
  msg += `👤 *গ্রাহক*: ${safeName}\n`;
  msg += `🆔 *কনজ্যুমার*: ${data.cust_no}\n`;
  msg += `📟 *মিটার*: ${data.meterNo}\n`;
  msg += `💰 *ব্যালেন্স*: ${data.balance} TK\n`;
  if (data.balanceTime) msg += `🕒 *সময়*: ${safeTime}\n`;
  return msg;
}


// ==================== COMMANDS ====================

bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `🔌 *নেস্কো প্রি-পেইড মিটার বট*

স্বাগতম! এই বটের মাধ্যমে আপনি আপনার প্রি-পেইড মিটারের ব্যালেন্স চেক ও অটো নোটিফিকেশন পেতে পারেন।

📌 *কমান্ড সমূহ:*
/add \\[নম্বর] — মিটার/গ্রাহক নম্বর সেভ করুন
/remove \\[নম্বর] — সেভ করা নম্বর মুছুন
/list — আপনার সেভ করা নম্বর দেখুন
/check — এখনই সব মিটারের ব্যালেন্স দেখুন
/help — সাহায্য

⏰ *অটো নোটিফিকেশন:*
সকাল ৮:০০ | দুপুর ১:০০ | সন্ধ্যা ৭:০০`
  );
});

bot.help((ctx) => {
  ctx.replyWithMarkdown(
    `📖 *সাহায্য*

🔹 /add 81034205 — এই নম্বরটি সেভ হবে
🔹 /add 81034205 81034206 — একসাথে একাধিক নম্বর সেভ
🔹 /remove 81034206 — নম্বর মুছে ফেলুন
🔹 /list — আপনার সেভ করা সব নম্বর
🔹 /check — এখনই ব্যালেন্স চেক করুন
🔹 সরাসরি নম্বর পাঠান — তাৎক্ষণিক চেক

⏰ সেভ করা নম্বর গুলোর ব্যালেন্স আপডেট দিনে ৩ বার স্বয়ংক্রিয়ভাবে আসবে।`
  );
});

// ===== /add command =====
bot.command('add', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length === 0) {
    return ctx.reply('❌ ব্যবহার: /add 81034205\nএকাধিক: /add 81034206 81034207');
  }

  const userId = String(ctx.from.id);
  let user = await User.findOne({ userId });
  if (!user) {
    user = new User({ userId, chatId: ctx.chat.id, username: ctx.from.username || '', name: ctx.from.first_name || '' });
  }

  let added = [];
  let invalid = [];
  let duplicate = [];

  for (const num of args) {
    if (!/^\d{8,11}$/.test(num)) {
      invalid.push(num);
    } else if (user.meters.includes(num)) {
      duplicate.push(num);
    } else {
      user.meters.push(num);
      added.push(num);
    }
  }

  await user.save();

  let msg = '';
  if (added.length) msg += `✅ সেভ হয়েছে: ${added.join(', ')}\n`;
  if (duplicate.length) msg += `⚠️ আগে থেকেই আছে: ${duplicate.join(', ')}\n`;
  if (invalid.length) msg += `❌ ভুল নম্বর: ${invalid.join(', ')}\n`;
  msg += `\n📋 মোট সেভ: ${user.meters.length} টি`;

  ctx.reply(msg);
});

// ===== /remove command =====
bot.command('remove', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length === 0) {
    return ctx.reply('❌ ব্যবহার: /remove 81034205');
  }

  const userId = String(ctx.from.id);
  const user = await User.findOne({ userId });
  if (!user || user.meters.length === 0) {
    return ctx.reply('আপনার কোনো সেভ করা নম্বর নেই।');
  }

  let removed = [];
  let notFound = [];

  for (const num of args) {
    const idx = user.meters.indexOf(num);
    if (idx > -1) {
      user.meters.splice(idx, 1);
      removed.push(num);
    } else {
      notFound.push(num);
    }
  }

  await user.save();

  let msg = '';
  if (removed.length) msg += `🗑️ মুছে ফেলা হয়েছে: ${removed.join(', ')}\n`;
  if (notFound.length) msg += `❓ পাওয়া যায়নি: ${notFound.join(', ')}\n`;
  msg += `\n📋 বাকি আছে: ${user.meters.length} টি`;

  ctx.reply(msg);
});

// ===== /list command =====
bot.command('list', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = await User.findOne({ userId });
  const meters = user?.meters || [];

  if (meters.length === 0) {
    return ctx.reply('আপনার কোনো সেভ করা নম্বর নেই।\n\n/add 81034205 দিয়ে যোগ করুন।');
  }

  let msg = `📋 *আপনার সেভ করা মিটার সমূহ:*\n\n`;
  meters.forEach((m, i) => {
    msg += `${i + 1}. \`${m}\`\n`;
  });
  msg += `\nমোট: ${meters.length} টি`;

  ctx.replyWithMarkdown(msg);
});

// ===== /check command =====
bot.command('check', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = await User.findOne({ userId });
  const meters = user?.meters || [];

  if (meters.length === 0) {
    return ctx.reply('আপনার কোনো সেভ করা নম্বর নেই। /add দিয়ে যোগ করুন।');
  }

  const statusMsg = await ctx.reply(`⏳ ${meters.length} টি মিটার চেক হচ্ছে...`);

  let fullMsg = `📊 *ব্যালেন্স আপডেট*\n\n`;
  for (const meter of meters) {
    try {
      const data = await fetchNescoData(meter);
      if (data) {
        fullMsg += formatResult(data);
        fullMsg += `────────────────────\n`;
        saveToLog(ctx.from, meter, formatResult(data));
      } else {
        fullMsg += `❌ ${meter} — ডাটা পাওয়া যায়নি\n────────────────────\n`;
      }
    } catch (e) {
      fullMsg += `❌ ${meter} — সার্ভারে সমস্যা\n────────────────────\n`;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  fullMsg += AD_TEXT;

  try {

    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, fullMsg, { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.reply(fullMsg, { parse_mode: 'Markdown' });
  }
});

// ===== Direct number input =====
bot.on('text', async (ctx) => {
  const cust_no = ctx.message.text.trim();
  if (!/^\d{8,11}$/.test(cust_no)) return;

  const statusMsg = await ctx.reply('অপেক্ষা করুন...');

  try {
    const data = await fetchNescoData(cust_no);
    if (data) {
      const msg = formatResult(data) + AD_TEXT;
      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, msg, { parse_mode: 'Markdown' });

      saveToLog(ctx.from, cust_no, msg);
    } else {
      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, 'কোন ডাটা পাওয়া যায়নি। নম্বরটি সঠিক কিনা দেখুন।');
    }
  } catch (err) {
    console.error(err);
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, 'সার্ভারে সমস্যা হচ্ছে।');
  }
});

// ==================== AUTO NOTIFICATIONS ====================
async function sendAutoNotifications(period) {
  const users = await User.find();
  const periodName = period === 'morning' ? '🌅 সকাল' : period === 'noon' ? '☀️ দুপুর' : '🌙 সন্ধ্যা';

  for (const user of users) {
    if (!user.meters || user.meters.length === 0) continue;

    let msg = `${periodName} *ব্যালেন্স আপডেট*\n\n`;

    for (const meter of user.meters) {
      try {
        const data = await fetchNescoData(meter);
        if (data) {
          msg += formatResult(data);
          msg += `────────────────────\n`;
          saveToLog({ first_name: user.name, username: user.username, id: user.userId }, meter, formatResult(data));
        } else {
          msg += `❌ ${meter} — ডাটা পাওয়া যায়নি\n────────────────────\n`;
        }
      } catch (e) {
        msg += `❌ ${meter} — সার্ভারে সমস্যা\n────────────────────\n`;
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    msg += AD_TEXT;

    try {

      await bot.telegram.sendMessage(user.chatId, msg, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(`Failed to notify user ${user.userId}:`, e.message);
    }
  }
  console.log(`[${new Date().toLocaleString()}] Notifications sent (${period})`);
}

cron.schedule('0 8 * * *', () => sendAutoNotifications('morning'), { timezone: 'Asia/Dhaka' });
cron.schedule('0 13 * * *', () => sendAutoNotifications('noon'), { timezone: 'Asia/Dhaka' });
cron.schedule('0 19 * * *', () => sendAutoNotifications('evening'), { timezone: 'Asia/Dhaka' });

// ==================== START BOT ====================
app.get('/', (req, res) => res.send('Bot is running alive!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ==================== ERROR HANDLING ====================
bot.catch((err, ctx) => {
  console.error(`[Bot Error] Update type: ${ctx.updateType}`, err.message);
});

bot.launch().then(() => {
  console.log('Bot is running with MongoDB & Express...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
