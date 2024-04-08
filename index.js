const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const { config } = require('dotenv');
const { logger } = require('./utils/logger.utils');

config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply('Привет! Я бот объебот!'));

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
  const { text } = ctx.message;
  if (text.startsWith('https://www.instagram.com/reel/')) {
    try {
      logger.info(text);
      await ctx.reply('Жди! Загружаю видео!');

      const videoUrl = await extractVideoUrlFromInstagramReals(text);
      logger.info(videoUrl);
      await ctx.replyWithVideo({ url: videoUrl });
    } catch (error) {
      logger.error(error);
      await ctx.reply('Не удалось загрузить видео из Reals');
    }
  }
});

bot.launch();
