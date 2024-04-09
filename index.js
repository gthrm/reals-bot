const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const { config } = require('dotenv');
const { logger } = require('./utils/logger.utils');
const { getAnswer } = require('./utils/chat.utils');

config();

let IS_ALIVE = process.env.IS_ALIVE === 'true';

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply('Hey there!'));

bot.command('oldschool', (ctx) => ctx.reply('Hello'));
bot.command('hipster', Telegraf.reply('λ'));
bot.command('stoptalking', async (ctx) => {
  IS_ALIVE = false;
  await ctx.reply('Okay! I will not talk anymore!');
});

bot.command('starttalking', async (ctx) => {
  IS_ALIVE = true;
  await ctx.reply('Okay! I am ready to talk!');
});

bot.help((ctx) => ctx.reply('Send me the Instagram reals link 😜'));

async function extractVideoUrlFromInstagramReals(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('video');
  const videoUrl = await page.$eval('video', (el) => el.src);
  await browser.close();
  return videoUrl;
}

bot.on('text', async (ctx) => {
  const { text, chat, from } = ctx.message;

  if (text.startsWith('https://www.instagram.com/reel/')) {
    try {
      logger.info(text);
      const waitMessage = await ctx.reply('Wait a second...');

      const videoUrl = await extractVideoUrlFromInstagramReals(text);
      logger.info(videoUrl);
      await ctx.replyWithVideo({ url: videoUrl });
      await ctx.deleteMessage(waitMessage.message_id);
    } catch (error) {
      logger.error(error);
      await ctx.reply('Something went wrong! Please try again!');
    }
  } else if (IS_ALIVE && process.env.LOCAL_CHAT_ID.includes(`${chat.id}`) && !from.is_bot) {
    try {
      const answerData = await getAnswer(text);
      if (answerData?.message?.content) {
        await ctx.reply(answerData.message.content);
      }
    } catch (error) {
      logger.error(error);
      await ctx.reply('Something went wrong! Please try again!');
    }
  }
});

bot.on('sticker', (ctx) => ctx.reply('👍'));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch();
