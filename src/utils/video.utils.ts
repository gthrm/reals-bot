import { logger } from './logger.utils';
import { RedisClient } from './redis.utils';
import { Context } from 'telegraf';

const redisClient = new RedisClient();

const errorMessage = 'Sorry! I am unable to process this video 😔. Unfortunately, the video is in blob format which is not supported. Thank you for understanding.';

interface VideoQueueItem {
  url: string;
  message_id: number;
  reply_to_message_id: number;
  chatId: number;
}

function processUrl(url: string): string | null {
  if (!url) {
    return null;
  }

  if (url.includes('www.instagram')) {
    return url.replace('www.instagram.com', process.env.INSTAGRAM_DOMAIN || 'ddinstagram.com');
  }

  if (url.includes('tiktok')) {
    return url.replace('vt.tiktok', 'tfxktok');
  }

  if (url.includes('x.com')) {
    return url.replace('x.com', 'fxtwitter.com');
  }
  return url;
}

export default class RealsVideoProcessor {
  private static instance: RealsVideoProcessor;
  private queue: VideoQueueItem[] = [];
  private isProcessing: boolean = false;

  constructor(ctx: any) {
    if (RealsVideoProcessor.instance) {
      return RealsVideoProcessor.instance;
    }
    this.init(ctx);
    RealsVideoProcessor.instance = this;
  }

  async addVideoToQueue({ url, ctx }: { url: string; ctx: Context }): Promise<void> {
    const waitMessage = await ctx.reply('Wait a second...');

    this.queue.push({
      url,
      message_id: waitMessage.message_id,
      reply_to_message_id: ctx.message!.message_id,
      chatId: ctx.chat!.id,
    });

    await redisClient.set('queue', this.queue);

    logger.info(`Added video to queue: ${url}`);
    if (!this.isProcessing) {
      this.processVideoQueue(ctx);
    }
  }

  private async updateQueue(): Promise<void> {
    await redisClient.set('queue', this.queue);
  }

  private async processVideoQueue(ctx: any): Promise<void> {
    try {
      if (this.queue.length > 0 && !this.isProcessing) {
        logger.info('Processing video queue');

        this.isProcessing = true;
        const video = this.queue.shift()!;

        logger.info(`Processing video: ${video.url}`);
        const {
          url, message_id, reply_to_message_id, chatId,
        } = video;

        const videoUrl = processUrl(url);
        logger.info(`Video URL: ${videoUrl}`);
        
        if (videoUrl && !videoUrl.startsWith('blob')) {
          if (ctx.replyWithVideo) {
            await ctx.reply(videoUrl, { reply_to_message_id });
            try {
              await ctx.deleteMessage(message_id);
            } catch (error) {
              logger.error(error);
            }
          } else {
            await ctx.sendMessage(chatId, videoUrl);
            try {
              await ctx.deleteMessage(chatId, message_id);
            } catch (error) {
              logger.error(error);
            }
          }
        } else if (ctx.replyWithVideo) {
          await ctx.reply(errorMessage, { reply_to_message_id });
        } else {
          await ctx.sendMessage(chatId, errorMessage);
        }

        this.isProcessing = false;
        await this.updateQueue();
        return this.processVideoQueue(ctx);
      }
    } catch (error) {
      logger.error(error);
      return this.processVideoQueue(ctx);
    }
  }

  private async init(ctx: any): Promise<void> {
    this.queue = (await redisClient.get<VideoQueueItem[]>('queue')) || [];
    this.processVideoQueue(ctx);
  }
}
