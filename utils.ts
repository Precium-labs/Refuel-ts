import {
    Chain,
    ChainAddress,
    ChainContext,
    Network,
    Signer,
    Wormhole,
} from "@wormhole-foundation/sdk-connect";

// Importing from src so we dont have to rebuild to see debug stuff in signer
import { getEvmSignerForKey } from "@wormhole-foundation/sdk-evm";
import { getSolanaSigner } from "@wormhole-foundation/sdk-solana";

require("dotenv").config();

export interface TransferStuff<N extends Network, C extends Chain> {
    chain: ChainContext<N, C>;
    signer: Signer<N, C>;
    address: ChainAddress<C>;
}

export async function getStuff<N extends Network, C extends Chain>(
    chain: ChainContext<N, C>,
    privateKey: string
): Promise<TransferStuff<N, C>> {
    let signer: Signer;
    const platform = chain.platform.utils()._platform;
    switch (platform) {
        case "Solana":
            signer = await getSolanaSigner(
                await chain.getRpc(),
                privateKey
            );
            break;
        case "Evm":
            signer = await getEvmSignerForKey(
                await chain.getRpc(),
                privateKey
            );
            break;
        default:
            throw new Error("Unrecognized platform: " + platform);
    }

    return {
        chain,
        signer: signer as Signer<N, C>,
        address: Wormhole.chainAddress(chain.chain, signer.address()),
    };
}