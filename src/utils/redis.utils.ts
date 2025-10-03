import { createClient, RedisClientType } from 'redis';
import { logger } from './logger.utils';

export class RedisClient {
  private static instance: RedisClient;
  private client: RedisClientType | null = null;

  constructor() {
    if (RedisClient.instance) {
      return RedisClient.instance;
    }
    RedisClient.instance = this;
  }

  async init(): Promise<void> {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL,
      });
      logger.info('Connecting to Redis client');
      this.client.on('error', (err) => logger.error('Redis Client Error', err));
      await this.client.connect();
      logger.info('Redis client connected');
    } catch (error) {
      logger.error('Error while connecting to Redis client', error);
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      if (this.client) {
        const value = await this.client.get(key);
        return value ? JSON.parse(value) : null;
      }
      return null;
    } catch (error) {
      logger.error('Error while getting value from Redis', error);
      return null;
    }
  }

  async set(key: string, value: any): Promise<string | null> {
    try {
      if (this.client) {
        return await this.client.set(key, JSON.stringify(value));
      }
      return null;
    } catch (error) {
      logger.error('Error while setting value to Redis', error);
      return null;
    }
  }
}
