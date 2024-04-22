/* eslint-disable camelcase */
const { Telegraf } = require('telegraf');
const { config } = require('dotenv');
const { logger } = require('./utils/logger.utils');
const { getAnswer } = require('./utils/chat.utils');
const { RedisClient } = require('./utils/redis.utils');
const RealsVideoProcessor = require('./utils/video.utils');

config();

const redisClient = new RedisClient();
redisClient.init();

const IS_ALIVE = process.env.IS_ALIVE === 'true';

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.launch();

bot.use((ctx, next) => {
  const {
    text, chat, from, reply_to_message,
  } = ctx?.message || {};

  if (!from?.is_bot) {
    if (text && text.startsWith('https://www.instagram.com/reel/')) {
      return next();
    }

    if (text && text.includes(`@${process.env.BOT_USERNAME}`)) {
      return next();
    }

    if (reply_to_message && reply_to_message.from?.username === process.env.BOT_USERNAME) {
      return next();
    }

    if (chat?.type === 'private') {
      return next();
    }
  }

  return null;
});

bot.start((ctx) => ctx.reply('Hey there!'));

bot.command('oldschool', (ctx) => ctx.reply('Hello'));
bot.command('hipster', Telegraf.reply('λ'));

bot.command('stoptalking', async (ctx) => {
  await redisClient.set(`IS_MUTED_${ctx.chat.id}`, true);
  return ctx.reply('Okay! I will not talk anymore!', { reply_to_message_id: ctx.message.message_id });
});

bot.command('starttalking', async (ctx) => {
  await redisClient.set(`IS_MUTED_${ctx.chat.id}`, false);
  return ctx.reply('Okay! I am ready to talk!', { reply_to_message_id: ctx.message.message_id });
});

bot.help((ctx) => ctx.reply('Send me the Instagram reals link 😜'));

const realsVideoProcessor = new RealsVideoProcessor(bot.telegram);

bot.on('text', async (ctx) => {
  const {
    text, chat, message_id,
  } = ctx.message;
  try {
    const isMuted = await redisClient.get(`IS_MUTED_${chat.id}`);

    if (text.startsWith('https://www.instagram.com/reel/')) {
      try {
        realsVideoProcessor.addVideoToQueue({ url: text, ctx });
      } catch (error) {
        logger.error(error);
        await ctx.reply('Something went wrong! Please try again!');
      }
    } else if (IS_ALIVE && !isMuted && process.env.LOCAL_CHAT_ID.includes(`${chat.id}`)) {
      try {
        const answerData = await getAnswer(chat.id, text);
        if (answerData?.message?.content) {
          await ctx.reply(answerData.message.content, { reply_to_message_id: message_id });
        }
      } catch (error) {
        logger.error(error);
        await ctx.reply('Something went wrong! Please try again!');
      }
    }
  } catch (error) {
    logger.error(error);
    await ctx.reply('Something went wrong! Please try again!');
  }
});

bot.on('sticker', (ctx) => ctx.reply('👍'));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
