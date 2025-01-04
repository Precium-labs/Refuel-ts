import axios from 'axios';
import { Markup, Telegraf } from 'telegraf';
import { MyContext } from '../index';
import { generateWalletMessage } from './start';
import setupProviders from '../helper_functions/providers';
import { generateReferralCode, getReferralInfo, processReferral } from '../helper_functions/refferal';
import { ReferralInfo } from '../helper_functions/interfaces';
import fetchBalances, { fetchPrices } from '../helper_functions/fetchBalances';


export function setupReferralSystem(bot: Telegraf<MyContext>) {
    bot.action('referral', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString() || '';
            const firstName = ctx.from?.username || 'User';
            const botUsername = ctx.botInfo.username;

            let referralInfo: ReferralInfo;
            try {
                referralInfo = await getReferralInfo(telegramId);
            } catch (error) {
                console.log('Referral info not found, generating new referral code...');
                const newReferralCode = await generateReferralCode(telegramId);
                referralInfo = {
                    referralCode: newReferralCode,
                    referralCount: 0,
                    rewardsEarned: 0
                };
            }

            const referralLink = `https://t.me/${botUsername}?start=${referralInfo.referralCode}`;

            const referralMessage = `
@${firstName}, here's your referral information:

📊 Your Referral Code: <code>${referralInfo.referralCode}</code>
🔗 Your Referral Link: ${referralLink}
👥 Total Referrals: ${referralInfo.referralCount}
💰 Rewards Earned: ${referralInfo.rewardsEarned} Points

Share your referral link with friends and earn rewards when they join!
`;

            const referralKeyboard = Markup.inlineKeyboard([
                [Markup.button.url('Share Referral Link', referralLink)],
                [Markup.button.callback('🔙 Back to Main Menu', 'back_to_main')],
            ]);

            await ctx.editMessageText(referralMessage, {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
                ...referralKeyboard
            });
        } catch (error) {
            console.error('Error in referral handler:', error);
            let errorMessage = 'An error occurred while fetching referral information. Please try again later.';
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            await ctx.answerCbQuery(errorMessage);
        }
    });

    // bot.command('start', async (ctx) => {
    //     const startPayload = ctx.message.text.split(' ')[1];
    //     if (startPayload) {
    //         // This is a referral link
    //         const telegramId = ctx.from.id.toString();
    //         try {
    //             const message = await processReferral(startPayload, telegramId);
    //             await ctx.reply(message);
    //         } catch (error) {
    //             console.error('Error processing referral:', error);
    //             await ctx.reply('Sorry, there was an error processing the referral. Please try again later.');
    //         }
    //     }
    // });

    bot.command('use_referral', async (ctx) => {
        const telegramId = ctx.from.id.toString();
        const referralCode = ctx.message.text.split(' ')[1];

        if (!referralCode) {
            await ctx.reply('Please provide a referral code. Usage: /use_referral CODE');
            return;
        }

        try {
            const message = await processReferral(referralCode, telegramId);
            await ctx.reply(message);
        } catch (error) {
            console.error('Error processing referral:', error);
            await ctx.reply('Sorry, there was an error processing the referral. Please check the code and try again.');
        }
    });

    bot.action('back_to_main', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString() || '';
            const firstName = ctx.from?.username || 'User';

            const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
            const userWalletData = response.data;

            const providers = setupProviders();
            const balances = await fetchBalances(providers, userWalletData.evm_wallet, userWalletData.solana_wallet);
            const prices = await fetchPrices();

            const message = generateWalletMessage(firstName, userWalletData.evm_wallet, userWalletData.solana_wallet, balances, prices);

            const homeKeyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(`⛽Refuel(Bridge)`, 'refuel'),
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

            await ctx.editMessageText(message, {
                parse_mode: 'HTML',
                ...homeKeyboard
            });
        } catch (error) {
            console.error('Error in back_to_main handler:', error);
            let errorMessage = 'An error occurred while returning to the main menu. Please try again later.';
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            await ctx.answerCbQuery(errorMessage);
        }
    });
}

export { processReferral };