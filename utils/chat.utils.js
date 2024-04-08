const OpenAI = require('openai');
const { config } = require('dotenv');

config();
const openai = new OpenAI();

async function getAnswer(text) {
  const prompt = 'You are a chatbot designed to engage in conversation with users. You should feel yourself like their friend! Your main function is to understand users\' questions and provide informative and engaging responses. You should not perform tasks outside of conversational engagement, such as writing code, generating URLs, or creating detailed technical content.';

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    // model: 'gpt-4-0125-preview',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
    max_tokens: 256, // Adjust based on your needs
    // Specify "stop" sequences if there are any indications that the bot is veering off course
    stop: ['\n', '```'], // Prevents the bot from generating code blocks or extensive content beyond a single message.
  });

  return completion.choices[0];
}

module.exports = { getAnswer };
