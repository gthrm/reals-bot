import { PrismaClient, User, Payment } from '@prisma/client';
import { logger } from './logger.utils';

export interface ServiceUsageResult {
  success: boolean;
  wasFree: boolean;
  cost: number;
}

export interface UserStats {
  user: User;
  transactions: {
    total_transactions: number;
    total_amount: number;
  };
  usage: Array<{
    request_type: string;
    count: number;
    total_cost: number;
  }>;
}

export type ServiceType = 'text' | 'image' | 'audio';
export type TransactionType = 'topup' | 'text_request' | 'image_request' | 'audio_request';

export class DatabaseClient {
  private static instance: DatabaseClient;
  private prisma!: PrismaClient;

  constructor() {
    if (DatabaseClient.instance) {
      return DatabaseClient.instance;
    }
    this.prisma = new PrismaClient();
    DatabaseClient.instance = this;
  }

  async init(): Promise<void> {
    try {
      logger.info('Connecting to PostgreSQL database with Prisma');
      
      // Test connection
      await this.prisma.$connect();
      
      logger.info('PostgreSQL database connected successfully');
    } catch (error) {
      logger.error('Error while connecting to PostgreSQL database', error);
      throw error;
    }
  }

  async getUser(userId: string | number): Promise<User | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: BigInt(userId) },
      });
      return user;
    } catch (error) {
      logger.error('Error getting user', error);
      return null;
    }
  }

  async createUser(userId: string | number, userData: {
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } = {}): Promise<User> {
    try {
      const {
        username = null,
        firstName = null,
        lastName = null,
      } = userData;

      const user = await this.prisma.user.upsert({
        where: { id: BigInt(userId) },
        update: {
          username,
          firstName,
          lastName,
        },
        create: {
          id: BigInt(userId),
          username,
          firstName,
          lastName,
        },
      });

      return user;
    } catch (error) {
      logger.error('Error creating/updating user', error);
      throw error;
    }
  }

  async updateUserBalance(
    userId: string | number, 
    amount: number, 
    transactionType: TransactionType, 
    description?: string
  ): Promise<boolean> {
    try {
      const result = await this.prisma.$transaction(async (prisma) => {
        // Update user balance
        await prisma.user.update({
          where: { id: BigInt(userId) },
          data: {
            fedorcoins: {
              increment: amount,
            },
          },
        });

        // Create transaction record
        await prisma.transaction.create({
          data: {
            userId: BigInt(userId),
            type: transactionType,
            amount,
            description,
            status: 'completed',
          },
        });

        return true;
      });

      return result;
    } catch (error) {
      logger.error('Error updating user balance', error);
      throw error;
    }
  }

  async canUseService(userId: string | number, serviceType: ServiceType): Promise<boolean> {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;

      switch (serviceType) {
        case 'text':
          return user.freeTextRequests > 0 || Number(user.fedorcoins) >= 0.5;
        case 'image':
          return user.freeImageRequests > 0 || Number(user.fedorcoins) >= 1.0;
        case 'audio':
          return user.freeAudioRequests > 0 || Number(user.fedorcoins) >= 1.0;
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error checking service availability', error);
      return false;
    }
  }

  async useService(
    userId: string | number, 
    serviceType: ServiceType, 
    cost: number = 0, 
    duration?: number, 
    fileSize?: number
  ): Promise<ServiceUsageResult> {
    try {
      const result = await this.prisma.$transaction(async (prisma) => {
        const user = await prisma.user.findUnique({
          where: { id: BigInt(userId) },
        });

        if (!user) throw new Error('User not found');

        let wasFree = false;
        let actualCost = cost;

        // Check if user can use free requests
        switch (serviceType) {
          case 'text':
            if (user.freeTextRequests > 0) {
              wasFree = true;
              actualCost = 0;
              await prisma.user.update({
                where: { id: BigInt(userId) },
                data: {
                  freeTextRequests: { decrement: 1 },
                  totalTextRequests: { increment: 1 },
                },
              });
            } else if (Number(user.fedorcoins) >= cost) {
              await prisma.user.update({
                where: { id: BigInt(userId) },
                data: {
                  fedorcoins: { decrement: cost },
                  totalTextRequests: { increment: 1 },
                },
              });
            } else {
              throw new Error('Insufficient balance');
            }
            break;

          case 'image':
            if (user.freeImageRequests > 0) {
              wasFree = true;
              actualCost = 0;
              await prisma.user.update({
                where: { id: BigInt(userId) },
                data: {
                  freeImageRequests: { decrement: 1 },
                  totalImageRequests: { increment: 1 },
                },
              });
            } else if (Number(user.fedorcoins) >= cost) {
              await prisma.user.update({
                where: { id: BigInt(userId) },
                data: {
                  fedorcoins: { decrement: cost },
                  totalImageRequests: { increment: 1 },
                },
              });
            } else {
              throw new Error('Insufficient balance');
            }
            break;

          case 'audio':
            if (user.freeAudioRequests > 0) {
              wasFree = true;
              actualCost = 0;
              await prisma.user.update({
                where: { id: BigInt(userId) },
                data: {
                  freeAudioRequests: { decrement: 1 },
                  totalAudioRequests: { increment: 1 },
                },
              });
            } else if (Number(user.fedorcoins) >= cost) {
              await prisma.user.update({
                where: { id: BigInt(userId) },
                data: {
                  fedorcoins: { decrement: cost },
                  totalAudioRequests: { increment: 1 },
                },
              });
            } else {
              throw new Error('Insufficient balance');
            }
            break;

          default:
            throw new Error('Invalid service type');
        }

        // Log usage
        await prisma.usageLog.create({
          data: {
            userId: BigInt(userId),
            requestType: serviceType,
            cost: actualCost,
            duration,
            fileSize,
            wasFree,
          },
        });

        // Create transaction if not free
        if (!wasFree) {
          await prisma.transaction.create({
            data: {
              userId: BigInt(userId),
              type: `${serviceType}_request` as TransactionType,
              amount: -actualCost,
              description: `${serviceType} request`,
              status: 'completed',
            },
          });
        }

        return { success: true, wasFree, cost: actualCost };
      });

      return result;
    } catch (error) {
      logger.error('Error using service', error);
      throw error;
    }
  }

  async createPayment(
    userId: string | number, 
    amount: number, 
    billId: string, 
    paymentUrl: string
  ): Promise<Payment> {
    try {
      const payment = await this.prisma.payment.create({
        data: {
          userId: BigInt(userId),
          billId,
          amount,
          paymentUrl,
        },
      });

      return payment;
    } catch (error) {
      logger.error('Error creating payment', error);
      throw error;
    }
  }

  async updatePaymentStatus(
    billId: string, 
    status: string, 
    completedAt?: Date
  ): Promise<Payment> {
    try {
      const payment = await this.prisma.payment.update({
        where: { billId },
        data: {
          status,
          completedAt: completedAt || new Date(),
        },
      });

      return payment;
    } catch (error) {
      logger.error('Error updating payment status', error);
      throw error;
    }
  }

  async getPaymentByBillId(billId: string): Promise<Payment | null> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { billId },
      });
      return payment;
    } catch (error) {
      logger.error('Error getting payment by bill ID', error);
      return null;
    }
  }

  async getUserStats(userId: string | number): Promise<UserStats | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: BigInt(userId) },
      });

      if (!user) return null;

      const transactions = await this.prisma.transaction.aggregate({
        where: {
          userId: BigInt(userId),
          status: 'completed',
        },
        _count: { id: true },
        _sum: {
          amount: true,
        },
      });

      const usage = await this.prisma.usageLog.groupBy({
        by: ['requestType'],
        where: {
          userId: BigInt(userId),
        },
        _count: { id: true },
        _sum: { cost: true },
      });

      return {
        user,
        transactions: {
          total_transactions: transactions._count.id,
          total_amount: Number(transactions._sum.amount) || 0,
        },
        usage: usage.map(u => ({
          request_type: u.requestType,
          count: u._count.id,
          total_cost: Number(u._sum.cost) || 0,
        })),
      };
    } catch (error) {
      logger.error('Error getting user stats', error);
      return null;
    }
  }

  async close(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection', error);
    }
  }
}
