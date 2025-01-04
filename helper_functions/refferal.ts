import axios from "axios";
import { ReferralInfo } from "./interfaces";

export async function generateReferralCode(telegramId: string): Promise<string> {
  try {
    const response = await axios.post(`https://refuel-gux8.onrender.com/api/refuel/wallet/generateRefferal/${telegramId}`);
    return response.data.referral_code;
  } catch (error) {
    console.error('Error generating referral code:', error);
    throw new Error('Failed to generate referral code');
  }
}

export async function processReferral(referralCode: string, telegramId: string) {
  try {
    const response = await axios.post(`https://refuel-gux8.onrender.com/api/refuel/wallet/referral/processReferral/${referralCode}/${telegramId}`);
    console.log('Referral processed:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error processing referral:', error);
    throw error;
  }
}

export async function getReferralInfo(telegramId: string): Promise<ReferralInfo> {
    try {
        const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/referral/${telegramId}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching referral info:', error);
        throw new Error('Failed to fetch referral info');
    }
}