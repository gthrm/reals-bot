import { Telegraf, Context } from "telegraf";
import express, { Request, Response } from "express";
import { config } from "dotenv";
import { logger } from "./utils/logger.utils";
import { getAnswer, analyzeImage, transcribeAudio } from "./utils/chat.utils";
import { RedisClient } from "./utils/redis.utils";
import { DatabaseClient } from "./utils/database.utils";
import { UsageService } from "./utils/usage.utils";
import { PaymentService } from "./utils/payment.utils";
import RealsVideoProcessor from "./utils/video.utils";

config();

const redisClient = new RedisClient();
const dbClient = new DatabaseClient();
const usageService = new UsageService();
const paymentService = new PaymentService();

// Initialize connections and setup bot
async function initializeServices() {
  await redisClient.init();
  await dbClient.init();

  // Automatically setup bot commands on every start
  await setupBotCommands();
}

initializeServices().catch(console.error);

const IS_ALIVE = process.env.IS_ALIVE === "true";

const bot = new Telegraf(process.env.BOT_TOKEN!);
const app = express();

// Middleware для парсинга JSON и form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function isAvailableUrl(url: string): boolean {
  return (
    url.startsWith("https://www.instagram.com/reel/") ||
    url.startsWith("https://x.com/") ||
    url.startsWith("https://vt.tiktok.com/")
  );
}

// Настройка команд для меню бота
async function setupBotCommands() {
  try {
    logger.info("Setting up bot commands menu...");

    const commands = [
      { command: "start", description: "🚀 Запустить бота" },
      { command: "balance", description: "💰 Проверить баланс и лимиты" },
      {
        command: "stats",
        description: "📊 Детальная статистика использования",
      },
      { command: "topup", description: "💳 Пополнить баланс ФедорКоинами" },
      { command: "help", description: "❓ Помощь и инструкции" },
      { command: "stoptalking", description: "🔇 Отключить бота в чате" },
      { command: "starttalking", description: "🔊 Включить бота в чате" },
    ];

    await bot.telegram.setMyCommands(commands);
    logger.info("✅ Bot commands menu configured successfully", {
      commandsCount: commands.length,
    });
  } catch (error) {
    logger.error("❌ Error setting bot commands", error);
  }
}

bot.launch();

// Единый middleware для создания пользователей и фильтрации
bot.use(async (ctx: Context, next) => {
  // Создаем пользователя при любом взаимодействии
  if (ctx.from && !ctx.from.is_bot) {
    try {
      const userData = {
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      };
      await usageService.ensureUser(ctx.from.id, userData);
    } catch (error) {
      logger.error("Error ensuring user exists", error);
    }
  }

  // Пропускаем команды и callback_query без дополнительных проверок
  if (ctx.callbackQuery || (ctx.message as any)?.text?.startsWith('/')) {
    return next();
  }

  const message = ctx.message as any;
  if (!message) return;

  const { text, caption, chat, from, reply_to_message, photo, voice, audio } =
    message;

  if (!from?.is_bot) {
    // Check for URL in text
    if (text && isAvailableUrl(text)) {
      return next();
    }

    // Check for bot mention in text or caption
    const messageText = text || caption || "";
    if (messageText && messageText.includes(`@${process.env.BOT_USERNAME}`)) {
      return next();
    }

    // Check for reply to bot message
    if (
      reply_to_message &&
      reply_to_message.from?.username === process.env.BOT_USERNAME
    ) {
      return next();
    }

    // Allow private chats
    if (chat?.type === "private") {
      return next();
    }
  }

  return;
});

bot.start(async (ctx) => {
  const welcomeMessage = `🤖 **Добро пожаловать в FedoAI Bot!**

Я умею:
📝 Отвечать на текстовые вопросы
🖼 Анализировать изображения и GIF
🎵 Распознавать речь в аудио сообщениях
🎬 Обрабатывать видео из соцсетей

💰 **Тарифы:**
🆓 Бесплатно: 10 текстов, 3 картинки, 3 аудио
🪙 ФедорКоины: тексты 0.5 ФК, медиа от 1 ФК

📋 **Команды:**
/balance - проверить баланс
/stats - статистика использования  
/topup - пополнить баланс
/help - помощь

В приватном чате просто отправляйте сообщения, картинки или аудио!
В группах упоминайте меня: @${process.env.BOT_USERNAME}`;

  await ctx.reply(welcomeMessage, { parse_mode: "Markdown" });
});

bot.command("oldschool", (ctx) => ctx.reply("Hello"));
bot.command("hipster", (ctx) => ctx.reply("λ"));

// Balance and stats commands
bot.command("balance", async (ctx) => {
  try {
    const userId = ctx.from!.id;
    const userInfo = await usageService.getUserInfo(userId);

    if (userInfo) {
      const formattedInfo = usageService.formatUserInfo(userInfo);
      await ctx.reply(formattedInfo, { parse_mode: "Markdown" });
    } else {
      await ctx.reply("Произошла ошибка при получении баланса.");
    }
  } catch (error) {
    logger.error("Error in balance command", error);
    await ctx.reply("Произошла ошибка при получении баланса.");
  }
});

bot.command("stats", async (ctx) => {
  try {
    const userId = ctx.from!.id;
    const stats = await usageService.getUserStats(userId);

    if (stats) {
      let message = `📊 **Детальная статистика:**\n\n`;
      message += `👤 **Пользователь:** ${
        stats.user.firstName || "Неизвестно"
      }\n`;
      message += `🪙 **Баланс:** ${Number(stats.user.fedorcoins).toFixed(
        2
      )} ФК\n\n`;
      message += `💰 **Транзакции:**\n`;
      message += `📈 Всего: ${stats.transactions.total_transactions}\n`;
      message += `💵 Сумма: ${stats.transactions.total_amount.toFixed(
        2
      )} ФК\n\n`;
      message += `📋 **Использование по типам:**\n`;

      stats.usage.forEach((usage) => {
        const emoji =
          usage.request_type === "text"
            ? "📝"
            : usage.request_type === "image"
            ? "🖼"
            : "🎵";
        message += `${emoji} ${usage.request_type}: ${
          usage.count
        } раз (${usage.total_cost.toFixed(2)} ФК)\n`;
      });

      await ctx.reply(message, { parse_mode: "Markdown" });
    } else {
      await ctx.reply("Статистика не найдена.");
    }
  } catch (error) {
    logger.error("Error in stats command", error);
    await ctx.reply("Произошла ошибка при получении статистики.");
  }
});

bot.command("topup", async (ctx) => {
  try {
    const userId = ctx.from!.id;
    const args = ctx.message!.text.split(" ");

    // Проверяем указана ли сумма
    if (args.length < 2) {
      await ctx.reply(
        `💳 **Пополнение баланса**

💰 Курс: 1 рубль = 1 ФедорКоин
💸 Минимальная сумма: 100 рублей
🔄 Комиссию платит плательщик

Выберите сумму для пополнения:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "💰 100 руб", callback_data: "topup_100" },
                { text: "💰 200 руб", callback_data: "topup_200" },
              ],
              [
                { text: "💰 500 руб", callback_data: "topup_500" },
                { text: "💰 1000 руб", callback_data: "topup_1000" },
              ],
              [
                { text: "💰 2000 руб", callback_data: "topup_2000" },
                { text: "💰 5000 руб", callback_data: "topup_5000" },
              ],
              [{ text: "✏️ Другая сумма", callback_data: "topup_custom" }],
            ],
          },
        }
      );
      return;
    }

    const amount = parseInt(args[1]);

    // Валидация суммы
    if (isNaN(amount) || amount < 100) {
      await ctx.reply(
        "❌ Некорректная сумма. Минимальная сумма пополнения: 100 рублей."
      );
      return;
    }

    if (amount > 50000) {
      await ctx.reply("❌ Максимальная сумма пополнения: 50,000 рублей.");
      return;
    }

    // Создаем счет на оплату
    const billResponse = await paymentService.createBill(userId, amount);
    const message = paymentService.formatPaymentMessage(billResponse, amount);

    await ctx.reply(message, {
      parse_mode: "Markdown",
    });

    logger.info(`Payment bill created for user ${userId}: ${amount} RUB`);
  } catch (error) {
    logger.error("Error in topup command", error);
    await ctx.reply(
      "❌ Произошла ошибка при создании счета. Попробуйте позже или обратитесь в поддержку."
    );
  }
});

bot.command("stoptalking", async (ctx) => {
  await redisClient.set(`IS_MUTED_${ctx.chat!.id}`, true);
  return ctx.reply("Okay! I will not talk anymore!", {
    reply_parameters: { message_id: ctx.message!.message_id },
  });
});

bot.command("starttalking", async (ctx) => {
  await redisClient.set(`IS_MUTED_${ctx.chat!.id}`, false);
  return ctx.reply("Okay! I am ready to talk!", {
    reply_parameters: { message_id: ctx.message!.message_id },
  });
});

// Команда для принудительной установки меню команд
bot.command("setupmenu", async (ctx) => {
  try {
    await setupBotCommands();
    await ctx.reply(
      "✅ Меню команд обновлено! Перезапустите Telegram для применения изменений."
    );
  } catch (error) {
    logger.error("Error in setupmenu command", error);
    await ctx.reply("❌ Ошибка при установке меню команд.");
  }
});

bot.help(async (ctx) => {
  const helpMessage = `❓ **Помощь FedoAI Bot**

🤖 **Что я умею:**
• Отвечать на любые вопросы
• Анализировать изображения и GIF
• Распознавать речь в голосовых сообщениях
• Скачивать видео из Instagram, TikTok, X

💰 **Система оплаты:**
🆓 **Бесплатные лимиты:**
• 10 текстовых запросов
• 3 анализа картинок/GIF
• 3 распознавания аудио

🪙 **ФедорКоины (1 руб = 1 ФК):**
• Текстовые запросы: 0.5 ФК
• Анализ изображений: от 1 ФК
• Распознавание аудио: от 0.5 ФК (зависит от длительности)

📋 **Команды:**
/balance - баланс и лимиты
/stats - детальная статистика
/topup <сумма> - пополнить баланс (мин. 100 руб)

🔧 **Как использовать:**
• **В приватном чате:** просто пишите/отправляйте медиа
• **В группах:** упоминайте @${process.env.BOT_USERNAME}

💡 **Поддержка:** @your_support_username`;

  await ctx.reply(helpMessage, { parse_mode: "Markdown" });
});

const realsVideoProcessor = new RealsVideoProcessor(bot.telegram);

// Обработка inline кнопок для пополнения
bot.action(/^topup_(\d+)$/, async (ctx) => {
  try {
    logger.info("Topup button clicked", { data: (ctx.callbackQuery as any)?.data });

    const amount = parseInt(ctx.match![1]);
    const userId = ctx.from!.id;

    // Проверяем есть ли переменные окружения для Cardlink
    if (!process.env.CARDLINK_API_TOKEN || !process.env.CARDLINK_SHOP_ID) {
      await ctx.answerCbQuery("❌ Платежная система не настроена");
      await ctx.editMessageText(
        `❌ **Платежная система временно недоступна**
        
Администратор должен настроить переменные окружения:
- CARDLINK_API_TOKEN
- CARDLINK_SHOP_ID

Обратитесь в поддержку.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await ctx.answerCbQuery("💳 Создаю счет на оплату...");

    // Создаем счет на оплату
    const billResponse = await paymentService.createBill(userId, amount);
    const message = paymentService.formatPaymentMessage(billResponse, amount);

    await ctx.editMessageText(message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔗 Перейти к оплате", url: billResponse.link_page_url }],
          [{ text: "🔙 Назад", callback_data: "topup_back" }],
        ],
      },
    });

    logger.info(
      `Payment bill created via button for user ${userId}: ${amount} RUB`
    );
  } catch (error) {
    logger.error("Error in topup button", error);
    await ctx.answerCbQuery("❌ Ошибка создания счета");
    await ctx.editMessageText(
      `❌ **Ошибка создания счета**
      
Попробуйте позже или обратитесь в поддержку.
Ошибка: ${error instanceof Error ? error.message : "Unknown error"}`,
      { parse_mode: "Markdown" }
    );
  }
});

// Кнопка "Другая сумма"
bot.action("topup_custom", async (ctx) => {
  logger.info("Topup custom button clicked");
  await ctx.answerCbQuery("✏️ Введите свою сумму");
  await ctx.editMessageText(
    `💳 **Пополнение баланса**

Введите команду: \`/topup <сумма>\`
Пример: \`/topup 750\`

💰 Курс: 1 рубль = 1 ФедорКоин
💸 Минимальная сумма: 100 рублей
💸 Максимальная сумма: 50,000 рублей`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: "topup_back" }]],
      },
    }
  );
});

// Кнопка "Назад"
bot.action("topup_back", async (ctx) => {
  logger.info("Topup back button clicked");
  await ctx.answerCbQuery("🔙 Возврат к выбору суммы");
  await ctx.editMessageText(
    `💳 **Пополнение баланса**

💰 Курс: 1 рубль = 1 ФедорКоин
💸 Минимальная сумма: 100 рублей
🔄 Комиссию платит плательщик

Выберите сумму для пополнения:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💰 100 руб", callback_data: "topup_100" },
            { text: "💰 200 руб", callback_data: "topup_200" },
          ],
          [
            { text: "💰 500 руб", callback_data: "topup_500" },
            { text: "💰 1000 руб", callback_data: "topup_1000" },
          ],
          [
            { text: "💰 2000 руб", callback_data: "topup_2000" },
            { text: "💰 5000 руб", callback_data: "topup_5000" },
          ],
          [{ text: "✏️ Другая сумма", callback_data: "topup_custom" }],
        ],
      },
    }
  );
});

bot.on("text", async (ctx) => {
  const message = ctx.message as any;
  const { text, chat, message_id, reply_to_message } = message;

  try {
    const isMuted = await redisClient.get<boolean>(`IS_MUTED_${chat.id}`);

    if (isAvailableUrl(text)) {
      try {
        realsVideoProcessor.addVideoToQueue({ url: text, ctx });
      } catch (error) {
        logger.error(error);
        await ctx.reply("Something went wrong! Please try again!");
      }
    } else if (
      IS_ALIVE &&
      !isMuted &&
      process.env.LOCAL_CHAT_ID?.includes(`${chat.id}`)
    ) {
      try {
        // Check if user can use text service
        const userId = ctx.from!.id;
        const availability = await usageService.canUseService(userId, "text");

        if (!availability.canUse) {
          const userInfo = await usageService.getUserInfo(userId);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "text",
              availability.cost,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
            return;
          }
        }

        // Use the service
        const usageResult = await usageService.useService(userId, "text");

        const answerData = await getAnswer(
          chat.id,
          text,
          reply_to_message,
          bot
        );
        if (answerData?.message?.content) {
          let replyText = answerData.message.content;

          // Add cost info if not free
          if (!usageResult.wasFree) {
            replyText += `\n\n💸 _Стоимость: ${usageResult.cost.toFixed(
              2
            )} ФК_`;
          }

          // В приватных чатах не отвечаем на сообщения, просто отправляем
          if (chat.type === "private") {
            await ctx.reply(replyText, { parse_mode: "Markdown" });
          } else {
            // В группах отвечаем на сообщение
            await ctx.reply(replyText, {
              reply_parameters: { message_id },
              parse_mode: "Markdown",
            });
          }
        }
      } catch (error) {
        logger.error(error);
        if (
          error instanceof Error &&
          error.message === "Insufficient balance"
        ) {
          const userInfo = await usageService.getUserInfo(ctx.from!.id);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "text",
              0.5,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
          }
        } else {
          await ctx.reply("Something went wrong! Please try again!");
        }
      }
    }
  } catch (error) {
    logger.error(error);
    await ctx.reply("Something went wrong! Please try again!");
  }
});

// Handle photo messages
bot.on("photo", async (ctx) => {
  const message = ctx.message as any;
  const { caption, chat, message_id, photo } = message;

  try {
    const isMuted = await redisClient.get<boolean>(`IS_MUTED_${chat.id}`);

    // Check conditions for photo analysis
    const isPrivateChat = chat.type === "private";
    const isMentionedInGroup =
      caption && caption.includes(`@${process.env.BOT_USERNAME}`);
    const shouldAnalyze =
      IS_ALIVE &&
      !isMuted &&
      process.env.LOCAL_CHAT_ID?.includes(`${chat.id}`) &&
      (isPrivateChat || isMentionedInGroup);

    if (shouldAnalyze) {
      try {
        // Check if user can use image service
        const userId = ctx.from!.id;
        const photoFileId = photo[photo.length - 1].file_id;
        const file = await bot.telegram.getFile(photoFileId);
        const fileSize = file.file_size || 0;

        const availability = await usageService.canUseService(
          userId,
          "image",
          undefined,
          fileSize
        );

        if (!availability.canUse) {
          const userInfo = await usageService.getUserInfo(userId);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "image",
              availability.cost,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
            return;
          }
        }

        // Use the service
        const usageResult = await usageService.useService(
          userId,
          "image",
          undefined,
          fileSize
        );

        // Analyze the photo
        const imageAnalysis = await analyzeImage(bot, photoFileId);

        // Prepare message with photo analysis
        const messageText = caption
          ? `${caption}\n\n[Photo analysis: ${imageAnalysis}]`
          : `[Photo analysis: ${imageAnalysis}]`;

        const answerData = await getAnswer(chat.id, messageText, null, bot);
        if (answerData?.message?.content) {
          let replyText = answerData.message.content;

          // Add cost info if not free
          if (!usageResult.wasFree) {
            replyText += `\n\n💸 _Стоимость: ${usageResult.cost.toFixed(
              2
            )} ФК_`;
          }

          // В приватных чатах не отвечаем на сообщения, просто отправляем
          if (chat.type === "private") {
            await ctx.reply(replyText, { parse_mode: "Markdown" });
          } else {
            // В группах отвечаем на сообщение
            await ctx.reply(replyText, {
              reply_parameters: { message_id },
              parse_mode: "Markdown",
            });
          }
        }
      } catch (error) {
        logger.error(error);
        if (
          error instanceof Error &&
          error.message === "Insufficient balance"
        ) {
          const userInfo = await usageService.getUserInfo(ctx.from!.id);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "image",
              1.0,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
          }
        } else {
          await ctx.reply("Something went wrong analyzing the photo!");
        }
      }
    }
  } catch (error) {
    logger.error(error);
    await ctx.reply("Something went wrong! Please try again!");
  }
});

// Handle voice messages
bot.on("voice", async (ctx) => {
  const message = ctx.message as any;
  const { chat, message_id, voice } = message;

  try {
    const isMuted = await redisClient.get<boolean>(`IS_MUTED_${chat.id}`);

    // Check conditions for voice analysis
    const isPrivateChat = chat.type === "private";
    const shouldAnalyze =
      IS_ALIVE &&
      !isMuted &&
      process.env.LOCAL_CHAT_ID?.includes(`${chat.id}`) &&
      isPrivateChat;

    if (shouldAnalyze) {
      try {
        // Check if user can use audio service
        const userId = ctx.from!.id;
        const duration = voice.duration || 30; // Default 30 seconds

        const availability = await usageService.canUseService(
          userId,
          "audio",
          duration
        );

        if (!availability.canUse) {
          const userInfo = await usageService.getUserInfo(userId);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "audio",
              availability.cost,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
            return;
          }
        }

        // Use the service
        const usageResult = await usageService.useService(
          userId,
          "audio",
          duration,
          voice.file_size
        );

        // Transcribe the voice message
        const transcription = await transcribeAudio(bot, voice.file_id);

        // Prepare message with transcription
        const messageText = `[Voice message transcription: "${transcription}"]`;

        const answerData = await getAnswer(chat.id, messageText, null, bot);
        if (answerData?.message?.content) {
          let replyText = answerData.message.content;

          // Add cost info if not free
          if (!usageResult.wasFree) {
            replyText += `\n\n💸 _Стоимость: ${usageResult.cost.toFixed(
              2
            )} ФК_`;
          }

          // В приватных чатах не отвечаем на сообщения, просто отправляем
          if (chat.type === "private") {
            await ctx.reply(replyText, { parse_mode: "Markdown" });
          } else {
            // В группах отвечаем на сообщение
            await ctx.reply(replyText, {
              reply_parameters: { message_id },
              parse_mode: "Markdown",
            });
          }
        }
      } catch (error) {
        logger.error(error);
        if (
          error instanceof Error &&
          error.message === "Insufficient balance"
        ) {
          const userInfo = await usageService.getUserInfo(ctx.from!.id);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "audio",
              0.5,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
          }
        } else {
          await ctx.reply(
            "Something went wrong transcribing the voice message!"
          );
        }
      }
    }
  } catch (error) {
    logger.error(error);
    await ctx.reply("Something went wrong! Please try again!");
  }
});

// Handle audio messages
bot.on("audio", async (ctx) => {
  const message = ctx.message as any;
  const { chat, message_id, audio } = message;

  try {
    const isMuted = await redisClient.get<boolean>(`IS_MUTED_${chat.id}`);

    // Check conditions for audio analysis
    const isPrivateChat = chat.type === "private";
    const shouldAnalyze =
      IS_ALIVE &&
      !isMuted &&
      process.env.LOCAL_CHAT_ID?.includes(`${chat.id}`) &&
      isPrivateChat;

    if (shouldAnalyze) {
      try {
        // Check if user can use audio service
        const userId = ctx.from!.id;
        const duration = audio.duration || 30; // Default 30 seconds

        const availability = await usageService.canUseService(
          userId,
          "audio",
          duration
        );

        if (!availability.canUse) {
          const userInfo = await usageService.getUserInfo(userId);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "audio",
              availability.cost,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
            return;
          }
        }

        // Use the service
        const usageResult = await usageService.useService(
          userId,
          "audio",
          duration,
          audio.file_size
        );

        // Transcribe the audio message
        const transcription = await transcribeAudio(bot, audio.file_id);

        // Prepare message with transcription
        const messageText = `[Audio message transcription: "${transcription}"]`;

        const answerData = await getAnswer(chat.id, messageText, null, bot);
        if (answerData?.message?.content) {
          let replyText = answerData.message.content;

          // Add cost info if not free
          if (!usageResult.wasFree) {
            replyText += `\n\n💸 _Стоимость: ${usageResult.cost.toFixed(
              2
            )} ФК_`;
          }

          // В приватных чатах не отвечаем на сообщения, просто отправляем
          if (chat.type === "private") {
            await ctx.reply(replyText, { parse_mode: "Markdown" });
          } else {
            // В группах отвечаем на сообщение
            await ctx.reply(replyText, {
              reply_parameters: { message_id },
              parse_mode: "Markdown",
            });
          }
        }
      } catch (error) {
        logger.error(error);
        if (
          error instanceof Error &&
          error.message === "Insufficient balance"
        ) {
          const userInfo = await usageService.getUserInfo(ctx.from!.id);
          if (userInfo) {
            const errorMessage = usageService.formatInsufficientBalanceMessage(
              "audio",
              0.5,
              userInfo
            );
            await ctx.reply(errorMessage, { parse_mode: "Markdown" });
          }
        } else {
          await ctx.reply(
            "Something went wrong transcribing the audio message!"
          );
        }
      }
    }
  } catch (error) {
    logger.error(error);
    await ctx.reply("Something went wrong! Please try again!");
  }
});

// Handle animation/GIF messages
bot.on("animation", async (ctx) => {
  const message = ctx.message as any;
  const { caption, chat, message_id, animation } = message;

  try {
    const isMuted = await redisClient.get<boolean>(`IS_MUTED_${chat.id}`);

    // Check conditions for animation analysis
    const isPrivateChat = chat.type === "private";
    const isMentionedInGroup =
      caption && caption.includes(`@${process.env.BOT_USERNAME}`);
    const shouldAnalyze =
      IS_ALIVE &&
      !isMuted &&
      process.env.LOCAL_CHAT_ID?.includes(`${chat.id}`) &&
      (isPrivateChat || isMentionedInGroup);

    if (shouldAnalyze) {
      try {
        // For animated GIFs, we don't charge - just respond
        const messageText = caption
          ? `${caption}\n\n[Я вижу что вы отправили анимированную GIF, но не могу анализировать анимированный контент. Могу только работать со статичными изображениями.]`
          : `[Я вижу что вы отправили анимированную GIF, но не могу анализировать анимированный контент. Могу только работать со статичными изображениями.]`;

        const answerData = await getAnswer(chat.id, messageText, null, bot);
        if (answerData?.message?.content) {
          // В приватных чатах не отвечаем на сообщения, просто отправляем
          if (chat.type === "private") {
            await ctx.reply(answerData.message.content, {
              parse_mode: "Markdown",
            });
          } else {
            // В группах отвечаем на сообщение
            await ctx.reply(answerData.message.content, {
              reply_parameters: { message_id },
              parse_mode: "Markdown",
            });
          }
        }
      } catch (error) {
        logger.error(error);
        await ctx.reply("Something went wrong responding to the GIF!");
      }
    }
  } catch (error) {
    logger.error(error);
    await ctx.reply("Something went wrong! Please try again!");
  }
});

// Handle video messages
bot.on("video", async (ctx) => {
  const message = ctx.message as any;
  const { caption, chat, message_id } = message;

  try {
    const isMuted = await redisClient.get<boolean>(`IS_MUTED_${chat.id}`);

    // Check conditions for video response
    const isPrivateChat = chat.type === "private";
    const isMentionedInGroup =
      caption && caption.includes(`@${process.env.BOT_USERNAME}`);
    const shouldRespond =
      IS_ALIVE &&
      !isMuted &&
      process.env.LOCAL_CHAT_ID?.includes(`${chat.id}`) &&
      (isPrivateChat || isMentionedInGroup);

    if (shouldRespond) {
      const messageText = caption
        ? `${caption}\n\n[Я вижу что вы отправили видео, но не могу анализировать видео контент. Могу только работать с текстом, статичными изображениями и аудио.]`
        : `[Я вижу что вы отправили видео, но не могу анализировать видео контент. Могу только работать с текстом, статичными изображениями и аудио.]`;

      const answerData = await getAnswer(chat.id, messageText, null, bot);
      if (answerData?.message?.content) {
        // В приватных чатах не отвечаем на сообщения, просто отправляем
        if (chat.type === "private") {
          await ctx.reply(answerData.message.content, {
            parse_mode: "Markdown",
          });
        } else {
          // В группах отвечаем на сообщение
          await ctx.reply(answerData.message.content, {
            reply_parameters: { message_id },
            parse_mode: "Markdown",
          });
        }
      }
    }
  } catch (error) {
    logger.error(error);
    await ctx.reply("Something went wrong! Please try again!");
  }
});

bot.on("sticker", (ctx) => ctx.reply("👍"));

// Postback endpoint для Cardlink
app.post("/webhook/cardlink", async (req: Request, res: Response) => {
  try {
    logger.info("Received Cardlink postback", req.body);

    const result = await paymentService.handlePostback(req.body);

    if (result.success) {
      // Если платеж успешен, отправим уведомление пользователю
      if (req.body.Status === "SUCCESS" && req.body.custom) {
        const userId = req.body.custom;
        const amount = parseFloat(req.body.OutSum);
        const message = paymentService.formatSuccessMessage(
          amount,
          req.body.TrsId
        );

        try {
          await bot.telegram.sendMessage(userId, message, {
            parse_mode: "Markdown",
          });
        } catch (error) {
          logger.error("Error sending payment notification to user", error);
        }
      }

      res.status(200).send("OK");
    } else {
      res.status(400).send(result.message);
    }
  } catch (error) {
    logger.error("Error processing Cardlink postback", error);
    res.status(500).send("Internal Server Error");
  }
});

// Success page - куда перенаправляется пользователь после успешной оплаты
app.post("/payment/success", async (req: Request, res: Response) => {
  try {
    const { InvId, OutSum, CurrencyIn } = req.body;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Платеж успешен</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f8ff; }
          .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
          .info { color: #333; margin: 10px 0; }
          .button { background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="success">✅ Платеж успешно обработан!</div>
        <div class="info">Заказ: ${InvId}</div>
        <div class="info">Сумма: ${OutSum} ${CurrencyIn}</div>
        <div class="info">ФедорКоины зачислены на ваш баланс</div>
        <a href="https://t.me/fedoai_bot" class="button">Вернуться к боту</a>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error("Error in success page", error);
    res.status(500).send("Ошибка обработки");
  }
});

// Fail page - куда перенаправляется пользователь после неуспешной оплаты
app.post("/payment/fail", async (req: Request, res: Response) => {
  try {
    const { InvId, OutSum, CurrencyIn } = req.body;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Ошибка платежа</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #fff5f5; }
          .error { color: #dc3545; font-size: 24px; margin-bottom: 20px; }
          .info { color: #333; margin: 10px 0; }
          .button { background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px; }
          .retry { background: #28a745; }
        </style>
      </head>
      <body>
        <div class="error">❌ Ошибка при обработке платежа</div>
        <div class="info">Заказ: ${InvId}</div>
        <div class="info">Сумма: ${OutSum} ${CurrencyIn}</div>
        <div class="info">Попробуйте еще раз или обратитесь в поддержку</div>
        <a href="https://t.me/fedoai_bot" class="button">Вернуться к боту</a>
        <a href="https://t.me/fedoai_bot" class="button retry">Попробовать снова</a>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error("Error in fail page", error);
    res.status(500).send("Ошибка обработки");
  }
});

// Refund webhook - обработка возвратов
app.post("/webhook/refund", async (req: Request, res: Response) => {
  try {
    logger.info("Received refund webhook", req.body);

    const { Id, Amount, Currency, Status, InvId, BillId, PaymentId } = req.body;

    if (Status === "SUCCESS") {
      // Обработка успешного возврата
      // Можно списать ФедорКоины у пользователя или заблокировать аккаунт
      logger.info(
        `Refund processed: ${Id}, Amount: ${Amount} ${Currency}, Payment: ${PaymentId}`
      );
    }

    res.status(200).send("OK");
  } catch (error) {
    logger.error("Error processing refund webhook", error);
    res.status(500).send("Internal Server Error");
  }
});

// Chargeback webhook - обработка чарджбэков
app.post("/webhook/chargeback", async (req: Request, res: Response) => {
  try {
    logger.info("Received chargeback webhook", req.body);

    const { Id, Status, InvId, BillId, PaymentId } = req.body;

    if (Status === "SUCCESS") {
      // Обработка чарджбэка - списать ФедорКоины, заблокировать пользователя
      logger.warn(`Chargeback processed: ${Id}, Payment: ${PaymentId}`);
    }

    res.status(200).send("OK");
  } catch (error) {
    logger.error("Error processing chargeback webhook", error);
    res.status(500).send("Internal Server Error");
  }
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Запуск HTTP сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`HTTP server started on port ${PORT}`);
});

// Enable graceful stop
process.once("SIGINT", () => {
  bot.stop("SIGINT");
  process.exit(0);
});
process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
  process.exit(0);
});
