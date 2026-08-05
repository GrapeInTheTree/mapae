import {defineChain} from "viem";
import deployments from "../../../deployments/91342.json";

export const giwaSepolia = defineChain({
    id: 91_342,
    name: "GIWA Sepolia",
    nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: ["https://sepolia-rpc.giwa.io"]}},
    blockExplorers: {default: {name: "Blockscout", url: "https://sepolia-explorer.giwa.io"}},
    contracts: {multicall3: {address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 0}},
});

export const BLOCKSCOUT = "https://sepolia-explorer.giwa.io";

export const addresses = {
    manager: deployments.MapaeDelegationManager as `0x${string}`,
    factory: deployments.MapaeAccountFactory as `0x${string}`,
    dojangEnforcer: deployments.DojangVerifiedEnforcer as `0x${string}`,
    payeeEnforcer: deployments.AllowedPayeeEnforcer as `0x${string}`,
    periodEnforcer: deployments.ERC20PeriodTransferEnforcer as `0x${string}`,
    timestampEnforcer: deployments.TimestampEnforcer as `0x${string}`,
    perPaymentEnforcer: (deployments as Record<string, unknown>).PerPaymentLimitEnforcer as `0x${string}`,
    verifiedCodeEnforcer: (deployments as Record<string, unknown>).VerifiedCodeEnforcer as `0x${string}`,
    mockKRW: deployments.MockKRW as `0x${string}`,
    dojangScroll: deployments.DojangScroll as `0x${string}`,
    giwaFaucetExtension: deployments.GiwaFaucetExtension as `0x${string}`,
    eas: "0x4200000000000000000000000000000000000021" as `0x${string}`,
    attesterBook: "0xDA282E89244424E297Ce8e78089B54D043FB28B6" as `0x${string}`,
} as const;

export const DEPLOY_BLOCK = BigInt(deployments.deployBlock);

export const ISSUERS: Record<string, {name: string; nameKo: string; real: boolean}> = {
    "0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034": {
        name: "UPBIT KOREA",
        nameKo: "업비트 코리아",
        real: true,
    },
    "0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678": {
        name: "TESTNET FAUCET",
        nameKo: "테스트넷 셀프서비스 발급자",
        real: false,
    },
};

/** Known tokens for legible amounts. mKRW has zero decimals by design. */
export const TOKENS: Record<string, {symbol: string; decimals: number; won: boolean}> = {
    [addresses.mockKRW.toLowerCase()]: {symbol: "mKRW", decimals: 0, won: true},
};

export function fmtAmount(token: string, raw: bigint): string {
    const t = TOKENS[token.toLowerCase()];
    if (t?.won) return `₩${raw.toLocaleString("ko-KR")}`;
    if (t) return `${raw.toLocaleString()} ${t.symbol}`;
    return raw.toString();
}

export function short(hex: string, n = 6): string {
    return `${hex.slice(0, n + 2)}…${hex.slice(-4)}`;
}
