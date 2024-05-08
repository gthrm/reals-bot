/* eslint-disable no-constructor-return */
/* eslint-disable max-len */
/* eslint-disable camelcase */
const puppeteer = require('puppeteer');
const { logger } = require('./logger.utils');
const { RedisClient } = require('./redis.utils');

const redisClient = new RedisClient();

const timeout = process.env.TIMEOUT || 240000;

async function extractVideoUrlFromInstagramReals(url) {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('video', { timeout });
    const videoUrl = await page.$eval('video', (el) => el.src);
    await page.close();
    return videoUrl;
  } finally {
    await browser.close();
    logger.info('browser closed');
  }
}

class RealsVideoProcessor {
  constructor(ctx) {
    if (RealsVideoProcessor.instance) {
      return RealsVideoProcessor.instance;
    }
    this.queue = [];
    this.isProcessing = false;
    this.init(ctx);
    RealsVideoProcessor.instance = this;
  }

  async addVideoToQueue({ url, ctx }) {
    const waitMessage = await ctx.reply('Wait a second...');

    this.queue.push({
      url, message_id: waitMessage.message_id, reply_to_message_id: ctx.message.message_id, chatId: ctx.chat.id,
    });

    redisClient.set('queue', this.queue);

    logger.info(`Added video to queue: ${url}`);
    if (!this.isProcessing) {
      this.processVideoQueue(ctx);
    }
  }

  updateQueue() {
    return redisClient.set('queue', this.queue);
  }

  async processVideoQueue(ctx) {
    try {
      if (this.queue.length > 0 && !this.isProcessing) {
        logger.info('Processing video queue');

        this.isProcessing = true;
        const video = this.queue.shift();

        logger.info(`Processing video: ${video.url}`);
        const {
          url, message_id, reply_to_message_id, chatId,
        } = video;

        const videoUrl = await extractVideoUrlFromInstagramReals(url);
        if (ctx.replyWithVideo) {
          await ctx.replyWithVideo({ url: videoUrl }, { reply_to_message_id });
          await ctx.deleteMessage(message_id);
        } else {
          await ctx.sendVideo(chatId, videoUrl);
          await ctx.deleteMessage(chatId, message_id);
        }

        this.isProcessing = false;
        await this.updateQueue();
        return this.processVideoQueue(ctx);
      }
      return null;
    } catch (error) {
      logger.error(error);
      return this.processVideoQueue(ctx);
    }
  }

  async init(ctx) {
    this.queue = await redisClient.get('queue') || [];
    this.processVideoQueue(ctx);
  }
}

module.exports = RealsVideoProcessor;