import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger.utils';
import { DatabaseClient } from './database.utils';

export interface CardlinkBillRequest {
  amount: number;
  order_id: string;
  description: string;
  type: 'normal';
  shop_id: string;
  currency_in: 'RUB';
  custom?: string;
  payer_pays_commission: 1;
  name: string;
}

export interface CardlinkBillResponse {
  success: string;
  link_url: string;
  link_page_url: string;
  bill_id: string;
}

export interface CardlinkPostback {
  Status: 'SUCCESS' | 'FAIL';
  InvId: string;
  Commission: string;
  CurrencyIn: string;
  OutSum: string;
  TrsId: string;
  custom?: string;
  SignatureValue: string;
}

export class PaymentService {
  private apiUrl = 'https://cardlink.link/api/v1';
  private apiToken: string;
  private shopId: string;
  private db: DatabaseClient;

  constructor() {
    this.apiToken = process.env.CARDLINK_API_TOKEN!;
    this.shopId = process.env.CARDLINK_SHOP_ID!;
    this.db = new DatabaseClient();

    if (!this.apiToken || !this.shopId) {
      throw new Error('CARDLINK_API_TOKEN and CARDLINK_SHOP_ID must be set in environment variables');
    }
  }

  // Создание счета на оплату
  async createBill(userId: string | number, amount: number, description: string = 'Пополнение ФедорКоинов'): Promise<CardlinkBillResponse> {
    try {
      // Минимальная сумма 100 рублей
      if (amount < 100) {
        throw new Error('Minimum amount is 100 RUB');
      }

      const orderId = `user_${userId}_${Date.now()}`;
      
      const billData: CardlinkBillRequest = {
        amount,
        order_id: orderId,
        description,
        type: 'normal',
        shop_id: this.shopId,
        currency_in: 'RUB',
        custom: userId.toString(),
        payer_pays_commission: 1,
        name: 'Пополнение ФедорКоинов',
      };

      const response = await axios.post<CardlinkBillResponse>(
        `${this.apiUrl}/bill/create`,
        billData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      if (response.data.success === 'true') {
        // Сохраняем платеж в базу данных
        await this.db.createPayment(
          userId,
          amount,
          response.data.bill_id,
          response.data.link_page_url
        );

        logger.info(`Payment created for user ${userId}: ${response.data.bill_id}`);
        return response.data;
      } else {
        throw new Error('Failed to create bill');
      }
    } catch (error) {
      logger.error('Error creating Cardlink bill', error);
      throw error;
    }
  }

  // Проверка подписи postback
  private verifySignature(postback: CardlinkPostback): boolean {
    try {
      const { OutSum, InvId, SignatureValue } = postback;
      const expectedSignature = crypto
        .createHash('md5')
        .update(`${OutSum}:${InvId}:${this.apiToken}`)
        .digest('hex')
        .toUpperCase();

      return SignatureValue === expectedSignature;
    } catch (error) {
      logger.error('Error verifying signature', error);
      return false;
    }
  }

  // Обработка postback уведомления
  async handlePostback(postback: CardlinkPostback): Promise<{ success: boolean; message: string }> {
    try {
      // Проверяем подпись
      if (!this.verifySignature(postback)) {
        logger.error('Invalid signature in postback', postback);
        return { success: false, message: 'Invalid signature' };
      }

      const { Status, InvId, OutSum, TrsId, custom } = postback;
      const userId = custom;
      const amount = parseFloat(OutSum);

      if (!userId) {
        logger.error('No user ID in postback custom field', postback);
        return { success: false, message: 'No user ID' };
      }

      // Получаем платеж из базы данных
      const payment = await this.db.getPaymentByBillId(TrsId);
      if (!payment) {
        logger.error(`Payment not found for bill_id: ${TrsId}`, postback);
        return { success: false, message: 'Payment not found' };
      }

      // Проверяем что платеж еще не обработан
      if (payment.status !== 'pending') {
        logger.info(`Payment already processed: ${TrsId}`, { status: payment.status });
        return { success: true, message: 'Already processed' };
      }

      if (Status === 'SUCCESS') {
        // Успешный платеж - зачисляем ФедорКоины
        await this.db.updatePaymentStatus(TrsId, 'success');
        
        // 1 рубль = 1 ФедорКоин
        const fedorcoinsToAdd = amount;
        await this.db.updateUserBalance(
          userId,
          fedorcoinsToAdd,
          'topup',
          `Пополнение через Cardlink. Платеж: ${TrsId}`
        );

        logger.info(`Successfully processed payment for user ${userId}: +${fedorcoinsToAdd} FC`, {
          billId: TrsId,
          amount,
          orderId: InvId,
        });

        return { success: true, message: 'Payment processed successfully' };
      } else {
        // Неуспешный платеж
        await this.db.updatePaymentStatus(TrsId, 'failed');
        
        logger.info(`Failed payment for user ${userId}`, {
          billId: TrsId,
          amount,
          orderId: InvId,
        });

        return { success: true, message: 'Payment failed' };
      }
    } catch (error) {
      logger.error('Error handling postback', error);
      return { success: false, message: 'Internal error' };
    }
  }

  // Получение статуса платежа
  async getPaymentStatus(billId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.apiUrl}/bill/status`, {
        params: { bill_id: billId },
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Error getting payment status', error);
      throw error;
    }
  }

  // Форматирование сообщения для пользователя
  formatPaymentMessage(billResponse: CardlinkBillResponse, amount: number): string {
    return `💳 **Пополнение баланса**

💰 Сумма: ${amount} руб = ${amount} ФК
🆔 Номер платежа: \`${billResponse.bill_id}\`

🔗 [Перейти к оплате](${billResponse.link_page_url})

⚠️ После оплаты ФедорКоины будут автоматически зачислены на ваш баланс.
Минимальная сумма пополнения: 100 рублей.`;
  }

  // Форматирование сообщения об успешной оплате
  formatSuccessMessage(amount: number, billId: string): string {
    return `✅ **Платеж успешно обработан!**

💰 Зачислено: ${amount} ФК
🆔 Платеж: \`${billId}\`

Спасибо за пополнение! Теперь вы можете использовать бота без ограничений.`;
  }
}
