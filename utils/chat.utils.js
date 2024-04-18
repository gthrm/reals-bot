const OpenAI = require('openai');
const { config } = require('dotenv');
const { createClient } = require('redis');
const { logger } = require('./logger.utils');

config();
const openai = new OpenAI();

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

async function init() {
// Creating a Redis client
  logger.info('Connecting to Redis client');
  redisClient.on('error', (err) => logger.error('Redis Client Error', err));
  await redisClient.connect();
  logger.info('Redis client connected');
}

async function getUserMessages(userId) {
  const messagesJson = await redisClient.get(`${userId}`);
  return messagesJson ? JSON.parse(messagesJson) : [];
}

async function saveUserMessages(userId, messages) {
  // Keep only the last 20 messages
  const recentMessages = messages.slice(-20);
  await redisClient.set(`${userId}`, JSON.stringify(recentMessages));
}

async function getAnswer(userId, text) {
  const prompt = 'You are a chatbot designed to engage in conversation with users. You should feel yourself like their friend! Your main function is to understand users\' questions and provide informative and engaging responses. You should not perform tasks outside of conversational engagement, such as writing code, generating URLs, or creating detailed technical content. Use russian language for communication.';

  // Retrieve user message history
  const userMessages = await getUserMessages(userId);

  // Adding new user message
  userMessages.push({ role: 'user', content: text });

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'system', content: prompt }, ...userMessages],
    temperature: 0.2,
    max_tokens: 256,
    stop: ['\n', '```'],
  });

  // Update message history after receiving response
  if (completion.choices[0] && completion.choices[0].message) {
    userMessages.push({ role: 'system', content: completion.choices[0].message.content });
    // Save updated history to Redis
    await saveUserMessages(userId, userMessages);
  }

  return completion.choices[0];
}

module.exports = { getAnswer, init };
