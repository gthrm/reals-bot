import { DatabaseClient, ServiceType, ServiceUsageResult } from './database.utils';
import { logger } from './logger.utils';
import { User } from '@prisma/client';

export interface UserInfo {
  fedorcoins: number;
  freeRequests: {
    text: number;
    image: number;
    audio: number;
  };
  totalRequests: {
    text: number;
    image: number;
    audio: number;
  };
}

export interface ServiceAvailability {
  canUse: boolean;
  cost: number;
  error?: string;
}

export class UsageService {
  private db: DatabaseClient;

  constructor() {
    this.db = new DatabaseClient();
  }

  // Calculate cost for audio/video based on duration
  calculateAudioCost(durationSeconds: number): number {
    // Base cost: 0.1 FedorCoin per 10 seconds
    // Minimum cost: 0.5 FedorCoin
    const baseCost = Math.ceil(durationSeconds / 10) * 0.1;
    return Math.max(baseCost, 0.5);
  }

  // Calculate cost for image analysis
  calculateImageCost(fileSize: number = 0): number {
    // Base cost: 1 FedorCoin per image
    // Additional cost for large images (>5MB): +0.5 FedorCoin
    let cost = 1.0;
    if (fileSize > 5 * 1024 * 1024) { // 5MB
      cost += 0.5;
    }
    return cost;
  }

  // Calculate cost for text requests
  calculateTextCost(): number {
    return 0.5; // Fixed cost for text requests
  }

  // Check if user is VIP (from LOCAL_CHAT_ID)
  private isVipUser(userId: string | number): boolean {
    return process.env.LOCAL_CHAT_ID?.includes(`${userId}`) || false;
  }

  // Check if user can use a service
  async canUseService(
    userId: string | number, 
    serviceType: ServiceType, 
    duration?: number, 
    fileSize?: number
  ): Promise<ServiceAvailability> {
    try {
      // Ensure user exists
      await this.ensureUser(userId);
      
      // VIP users from LOCAL_CHAT_ID have unlimited access
      if (this.isVipUser(userId)) {
        return { canUse: true, cost: 0 }; // Free for VIP users
      }
      
      let cost = 0;
      switch (serviceType) {
        case 'text':
          cost = this.calculateTextCost();
          break;
        case 'image':
          cost = this.calculateImageCost(fileSize);
          break;
        case 'audio':
          cost = this.calculateAudioCost(duration || 30); // Default 30 seconds if not provided
          break;
        default:
          return { canUse: false, cost: 0, error: 'Invalid service type' };
      }

      const canUse = await this.db.canUseService(userId, serviceType);
      return { canUse, cost };
    } catch (error) {
      logger.error('Error checking service availability', error);
      return { canUse: false, cost: 0, error: (error as Error).message };
    }
  }

  // Use a service and deduct from balance/free requests
  async useService(
    userId: string | number, 
    serviceType: ServiceType, 
    duration?: number, 
    fileSize?: number
  ): Promise<ServiceUsageResult> {
    try {
      // Ensure user exists
      await this.ensureUser(userId);

      // VIP users from LOCAL_CHAT_ID get free unlimited access
      if (this.isVipUser(userId)) {
        // Log usage but don't charge
        await this.db.logUsage(userId, serviceType, 0, duration, fileSize, true);
        
        return { success: true, wasFree: true, cost: 0 };
      }

      let cost = 0;
      switch (serviceType) {
        case 'text':
          cost = this.calculateTextCost();
          break;
        case 'image':
          cost = this.calculateImageCost(fileSize);
          break;
        case 'audio':
          cost = this.calculateAudioCost(duration || 30);
          break;
        default:
          throw new Error('Invalid service type');
      }

      const result = await this.db.useService(userId, serviceType, cost, duration, fileSize);
      return result;
    } catch (error) {
      logger.error('Error using service', error);
      throw error;
    }
  }

  // Ensure user exists in database
  async ensureUser(userId: string | number, userData: {
    username?: string;
    firstName?: string;
    lastName?: string;
  } = {}): Promise<User> {
    try {
      let user = await this.db.getUser(userId);
      if (!user) {
        user = await this.db.createUser(userId, userData);
      }
      return user;
    } catch (error) {
      logger.error('Error ensuring user exists', error);
      throw error;
    }
  }

  // Get user balance and stats
  async getUserInfo(userId: string | number): Promise<UserInfo | null> {
    try {
      const user = await this.db.getUser(userId);
      if (!user) {
        return null;
      }

      return {
        fedorcoins: Number(user.fedorcoins),
        freeRequests: {
          text: user.freeTextRequests,
          image: user.freeImageRequests,
          audio: user.freeAudioRequests,
        },
        totalRequests: {
          text: user.totalTextRequests,
          image: user.totalImageRequests,
          audio: user.totalAudioRequests,
        },
      };
    } catch (error) {
      logger.error('Error getting user info', error);
      return null;
    }
  }

  // Add FedorCoins to user balance
  async addFedorCoins(userId: string | number, amount: number, description: string = 'Balance top-up'): Promise<boolean> {
    try {
      await this.ensureUser(userId);
      await this.db.updateUserBalance(userId, amount, 'topup', description);
      return true;
    } catch (error) {
      logger.error('Error adding FedorCoins', error);
      throw error;
    }
  }

  // Get detailed user statistics
  async getUserStats(userId: string | number) {
    try {
      return await this.db.getUserStats(userId);
    } catch (error) {
      logger.error('Error getting user stats', error);
      return null;
    }
  }

  // Format user info for display
  formatUserInfo(userInfo: UserInfo): string {
    if (!userInfo) return 'Пользователь не найден';

    const { fedorcoins, freeRequests, totalRequests } = userInfo;

    return `💰 **Ваш баланс:**
🪙 ФедорКоины: ${fedorcoins.toFixed(2)}

🆓 **Бесплатные запросы:**
📝 Текстовые: ${freeRequests.text}
🖼 Картинки: ${freeRequests.image}  
🎵 Аудио: ${freeRequests.audio}

📊 **Всего использовано:**
📝 Текстовые: ${totalRequests.text}
🖼 Картинки: ${totalRequests.image}
🎵 Аудио: ${totalRequests.audio}`;
  }

  // Format insufficient balance message
  formatInsufficientBalanceMessage(serviceType: ServiceType, cost: number, userInfo: UserInfo): string {
    const serviceName = {
      text: 'текстовый запрос',
      image: 'анализ картинки',
      audio: 'распознавание аудио',
    }[serviceType] || serviceType;

    let message = `❌ **Недостаточно средств для ${serviceName}**\n\n`;
    message += `💸 Стоимость: ${cost.toFixed(2)} ФК\n`;
    message += `💰 Ваш баланс: ${userInfo.fedorcoins.toFixed(2)} ФК\n\n`;
    message += `💡 Пополните баланс командой /topup или используйте бесплатные запросы:\n`;
    message += `📝 Текстовые: ${userInfo.freeRequests.text}\n`;
    message += `🖼 Картинки: ${userInfo.freeRequests.image}\n`;
    message += `🎵 Аудио: ${userInfo.freeRequests.audio}`;

    return message;
  }
}
