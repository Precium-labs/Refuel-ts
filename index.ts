import { Telegraf, session, Context } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { setupReferralSystem } from './commands/referral'; // Import the setupReferralSystem function

dotenv.config();

// Extend the Context type to include custom properties
export interface MyContext extends Context {
  apiData?: any;  // Add custom properties here
}

// Create the bot instance with the extended context type
const bot = new Telegraf<MyContext>(process.env.BOT_TOKEN as string);

// Use session middleware
bot.use(session());

// Load all command files dynamically
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

commandFiles.forEach((file) => {
  const command = require(path.join(__dirname, 'commands', file));
  if (typeof command === 'function') {
    command(bot);
  }
});

// Set up the referral system
setupReferralSystem(bot);

// Error handling middleware
bot.catch((err: any, ctx: MyContext) => {
  console.error(`Error while handling update ${ctx.update.update_id}:`, err);
  ctx.reply('An error occurred while processing your request. Please try again later.');
});

// Function to make API request and store the result in context
async function makeApiRequest() {
  try {
    const response = await axios.get('https://refuel-database.onrender.com/api/refuel/wallet/123456');
    bot.context.apiData = response.data;
  } catch (error) {
    console.error('Error making API request:', error);
  }
}

// Make initial API request and repeat every 30 seconds
makeApiRequest();
setInterval(makeApiRequest, 30000);

// Start the bot
bot.launch()
  .then(() => {
    console.log('Bot is running');
  })
  .catch((error) => {
    console.error('Error starting bot:', error);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));