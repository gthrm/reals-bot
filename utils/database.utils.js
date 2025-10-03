const { PrismaClient } = require('@prisma/client');
const { logger } = require('./logger.utils');

class DatabaseClient {
  constructor() {
    if (DatabaseClient.instance) {
      return DatabaseClient.instance;
    }
    this.prisma = new PrismaClient();
    DatabaseClient.instance = this;
  }

  async init() {
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

  async getUser(userId) {
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

  async createUser(userId, userData = {}) {
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

  async updateUserBalance(userId, amount, transactionType, description = null) {
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

  async canUseService(userId, serviceType) {
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

  async useService(userId, serviceType, cost = 0, duration = null, fileSize = null) {
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
              type: `${serviceType}_request`,
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

  async createPayment(userId, amount, billId, paymentUrl) {
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

  async updatePaymentStatus(billId, status, completedAt = null) {
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

  async getPaymentByBillId(billId) {
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

  async getUserStats(userId) {
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
          total_amount: transactions._sum.amount || 0,
        },
        usage: usage.map(u => ({
          request_type: u.requestType,
          count: u._count.id,
          total_cost: u._sum.cost || 0,
        })),
      };
    } catch (error) {
      logger.error('Error getting user stats', error);
      return null;
    }
  }

  async close() {
    try {
      await this.prisma.$disconnect();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection', error);
    }
  }
}

module.exports = { DatabaseClient };
