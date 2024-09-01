import axios from 'axios';
import { Markup, Telegraf } from 'telegraf';
import { Message } from 'telegraf/types';
import { MyContext } from '../index';

interface ReferralInfo {
    referralCode: string;
    referralCount: number;
    rewardsEarned: number;
}

async function getReferralInfo(telegramId: string): Promise<ReferralInfo> {
    try {
        const response = await axios.get(`https://refuel-database.onrender.com/api/refuel/referral/${telegramId}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching referral info:', error);
        throw new Error('Failed to retrieve referral information');
    }
}

async function processReferral(referralCode: string, telegramId: string): Promise<string> {
    try {
        const response = await axios.post(`https://refuel-database.onrender.com/api/refuel/wallet/referral/processReferral/${referralCode}/${telegramId}`);
        return response.data.message;
    } catch (error) {
        console.error('Error processing referral:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data.error || 'Failed to process referral');
        }
        throw new Error('Failed to process referral');
    }
}

function generateReferralMessage(username: string, referralInfo: ReferralInfo): string {
    return `Hey @${username}! Here's your referral information:

🔗 Your Referral Code: <code>${referralInfo.referralCode}</code>

👥 Total Referrals: ${referralInfo.referralCount}
💰 Rewards Earned: ${referralInfo.rewardsEarned} tokens

Share your referral code with friends and earn rewards when they join!`;
}



export function setupReferral(bot: Telegraf<MyContext>) {
    bot.action('referral', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString() || '';
            const username = ctx.from?.username || 'User';
            console.log("referral",username)
            const referralInfo = await getReferralInfo(telegramId);
            const message = generateReferralMessage(username, referralInfo);

            const referralKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('📢 Share Referral Code', 'share_referral')],
                [Markup.button.callback('🔄 Refresh Referral Info', 'refresh_referral')],
                [Markup.button.callback('🏠 Back to Main Menu', 'back_to_main')]
            ]);

            await ctx.reply(message, { parse_mode: 'HTML', ...referralKeyboard });
        } catch (error) {
            console.error('Error handling /referral command:', error);
            await ctx.reply('An error occurred while fetching your referral information. Please try again later.');
        }
    });

    bot.action('share_referral', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString() || '';
            const referralInfo = await getReferralInfo(telegramId);
            const shareMessage = `Join me on Refuel Bot! Use my referral code: ${referralInfo.referralCode}`;
            await ctx.answerCbQuery('Referral code copied! Share it with your friends.');
            await ctx.reply(shareMessage, { reply_markup: { inline_keyboard: [[Markup.button.callback('Done Sharing', 'back_to_referral')]] } });
        } catch (error) {
            console.error('Error sharing referral code:', error);
            await ctx.answerCbQuery('Failed to share referral code. Please try again.');
        }
    });

    bot.action('refresh_referral', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString() || '';
            const username = ctx.from?.username || 'User';

            const referralInfo = await getReferralInfo(telegramId);
            const message = generateReferralMessage(username, referralInfo);

            await ctx.answerCbQuery('Referral information refreshed');

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                const originalMessage = ctx.callbackQuery.message as Message.TextMessage;
                if (originalMessage && originalMessage.reply_markup) {
                    await ctx.editMessageText(message, {
                        parse_mode: 'HTML',
                        reply_markup: originalMessage.reply_markup
                    });
                } else {
                    await ctx.editMessageText(message, { parse_mode: 'HTML' });
                }
            }
        } catch (error) {
            console.error('Error refreshing referral info:', error);
            await ctx.answerCbQuery('Failed to refresh referral information. Please try again.');
        }
    });

    bot.action('back_to_referral', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString() || '';
            const username = ctx.from?.username || 'User';

            const referralInfo = await getReferralInfo(telegramId);
            const message = generateReferralMessage(username, referralInfo);

            const referralKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('📢 Share Referral Code', 'share_referral')],
                [Markup.button.callback('🔄 Refresh Referral Info', 'refresh_referral')],
                [Markup.button.callback('🏠 Back to Main Menu', 'back_to_main')]
            ]);

            await ctx.editMessageText(message, { parse_mode: 'HTML', ...referralKeyboard });
        } catch (error) {
            console.error('Error going back to referral menu:', error);
            await ctx.answerCbQuery('Failed to return to referral menu. Please try again.');
        }
    });

    bot.action('back_to_main', async (ctx) => {
        try {
            const mainMenuMessage = `Welcome to Refuel Bot ⛽️\n\nWhat would you like to do?`;

            const mainMenuKeyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(`⛽Refuel`, 'refuel'),
                    Markup.button.callback(`👜Wallet`, 'wallet'),
                    Markup.button.callback(`Transfer`, 'transfer'),
                ],
                [
                    Markup.button.callback(`🆘Help`, 'help'),
                    Markup.button.callback(`⚙️Settings`, 'settings'),
                ],
                [
                    Markup.button.callback(`👥Refer Friends`, 'referral'),
                ],
                [
                    Markup.button.callback(`♻️Refresh`, 'refresh'),
                ],
            ]);

            await ctx.answerCbQuery('Returning to main menu');
            await ctx.editMessageText(mainMenuMessage, { parse_mode: 'HTML', ...mainMenuKeyboard });
        } catch (error) {
            console.error('Error returning to main menu:', error);
            await ctx.answerCbQuery('Error returning to main menu. Please try again.');
        }
    });

    bot.on('text', async (ctx) => {
        const text = ctx.message.text;
        if (text.startsWith('/start ')) {
            const referralCode = text.split(' ')[1];
            const telegramId = ctx.from.id.toString();
            try {
                const message = await processReferral(referralCode, telegramId);
                await ctx.reply(message);
            } catch (error) {
                if (error instanceof Error) {
                    await ctx.reply(error.message);
                } else {
                    await ctx.reply('An error occurred while processing the referral.');
                }
            }
        }
    });
}