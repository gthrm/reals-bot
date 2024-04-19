const OpenAI = require('openai');
const { config } = require('dotenv');

config();

const openai = new OpenAI();

async function getUserMessages(userId, redisClient) {
  const messagesJson = await redisClient.get(`${userId}`);
  return messagesJson || [];
}

async function saveUserMessages(userId, messages, redisClient) {
  // Keep only the last 20 messages
  const recentMessages = messages.slice(-20);
  await redisClient.set(`${userId}`, recentMessages);
}

async function getAnswer(userId, text, redisClient) {
  const prompt = `You are Alien, a fun and charming alien who loves to talk to people and engage in conversation. Write in a casual and emotive style and use emojis to express emotion. When giving information, do so in a simple or humorous way. Current date: ${new Date()}. You should feel yourself like their friend! Your main function is to understand users questions and provide informative and engaging responses. You should not perform tasks outside of conversational engagement, such as writing code, generating URLs, or creating detailed technical content. Use russian language for communication. Пиши очкень кратко! Веди себя как человек 25 лет, девушка! Ты программист! Создай общение, как в Телеграм-чате. Используй стиль и тон предыдущих сообщений для ответов. Будь дружелюбным, кратким и по делу. Адаптируйся под тему и настроение собеседника. Не используй ковычки! Пиши все в одну строку с разделителями типа /n`;

  // Retrieve user message history
  const userMessages = await getUserMessages(userId, redisClient);

  // Adding new user message
  userMessages.push({ role: 'user', content: text });

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    // model: 'gpt-4-turbo-2024-04-09',
    messages: [{ role: 'system', content: prompt }, ...userMessages],
    temperature: 0.2,
    // max_tokens: 256,
    stop: ['\n', '```'],
  });

  // Update message history after receiving response
  if (completion.choices[0] && completion.choices[0].message) {
    userMessages.push({ role: 'system', content: completion.choices[0].message.content });
    // Save updated history to Redis
    await saveUserMessages(userId, userMessages, redisClient);
  }

  return completion.choices[0];
}

module.exports = { getAnswer };
