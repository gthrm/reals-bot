const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const { config } = require('dotenv');
const { logger } = require('./utils/logger.utils');
const { getAnswer } = require('./utils/chat.utils');

config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply('Hey there!'));

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
      await ctx.reply('Wait a second...');

      const videoUrl = await extractVideoUrlFromInstagramReals(text);
      logger.info(videoUrl);
      await ctx.replyWithVideo({ url: videoUrl });
    } catch (error) {
      logger.error(error);
      await ctx.reply('Something went wrong! Please try again!');
    }
  } else if (process.env.LOCAL_CHAT_ID.includes(`${chat.id}`) && !from.is_bot) {
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

bot.launch();
