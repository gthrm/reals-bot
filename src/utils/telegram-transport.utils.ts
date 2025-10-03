import { Telegraf } from 'telegraf';
import Transport from 'winston-transport';

interface TelegramTransportOptions extends Transport.TransportStreamOptions {
  telegramBotToken: string;
  chatId: string;
}

export default class TelegramTransport extends Transport {
  private telegramBot: Telegraf;
  private chatId: string;

  constructor(opts: TelegramTransportOptions) {
    super(opts);
    this.telegramBot = new Telegraf(opts.telegramBotToken);
    this.chatId = opts.chatId;
  }

  log(info: any, callback: () => void): void {
    setImmediate(() => {
      this.emit('logged', info);
    });

    if (info.level === 'error') {
      const message = `[${info.level.toUpperCase()}] - ${info.timestamp} - ${info.message}`;
      this.telegramBot.telegram.sendMessage(this.chatId, message)
        .then(() => callback())
        .catch((error) => console.error('Error sending message to Telegram:', error));
    } else {
      callback();
    }
  }
}
