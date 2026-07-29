import {defineChain} from "viem";
import deployments from "../../deployments/91342.json" with {type: "json"};

/** GIWA Sepolia. viem core exports `giwaSepolia`, but pinning our own definition keeps the SDK's
 *  behaviour independent of viem's release cadence. Chain facts verified live 2026-07-29. */
export const giwaSepolia = defineChain({
    id: 91_342,
    name: "GIWA Sepolia",
    nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: [process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io"]}},
    blockExplorers: {default: {name: "Blockscout", url: "https://sepolia-explorer.giwa.io"}},
    contracts: {multicall3: {address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 0}},
});

export const addresses = {
    manager: deployments.MapaeDelegationManager as `0x${string}`,
    factory: deployments.MapaeAccountFactory as `0x${string}`,
    dojangEnforcer: deployments.DojangVerifiedEnforcer as `0x${string}`,
    payeeEnforcer: deployments.AllowedPayeeEnforcer as `0x${string}`,
    periodEnforcer: deployments.ERC20PeriodTransferEnforcer as `0x${string}`,
    timestampEnforcer: deployments.TimestampEnforcer as `0x${string}`,
    mockKRW: deployments.MockKRW as `0x${string}`,
    dojangScroll: deployments.DojangScroll as `0x${string}`,
    giwaFaucetExtension: deployments.GiwaFaucetExtension as `0x${string}`,
    eas: "0x4200000000000000000000000000000000000021" as `0x${string}`,
    dojangAttesterBook: "0xDA282E89244424E297Ce8e78089B54D043FB28B6" as `0x${string}`,
} as const;

export const deployBlock = BigInt(deployments.deployBlock);

/** Protocol constants are pure and live in `protocol.ts`; re-exported here so existing importers
 *  keep working. Import them from `protocol.js` directly in any code that must run in a browser -
 *  this module reaches for a deployment JSON and `process.env`, which that code should not. */
export {
    ANY_DELEGATE,
    MODE_SIMPLE_SINGLE,
    ROOT_AUTHORITY,
    TESTNET_FAUCET_ID,
    UPBIT_KOREA_ID,
} from "./protocol.js";
