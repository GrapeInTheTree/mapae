import {defineChain} from "viem";

/**
 * GIWA Sepolia and this deployment's addresses.
 *
 * Inlined rather than imported from ../../deployments/91342.json: this package is published to
 * npm on its own, and a JSON import attribute is the one thing in the SDK sources the bundler
 * cannot carry across that boundary. The values are the same 9 verified contracts the explorer
 * and every script use; if a redeploy ever changes them, deployments/91342.json is the source
 * this file is regenerated from.
 */

export const giwaSepolia = defineChain({
    id: 91_342,
    name: "GIWA Sepolia",
    nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: [process.env.MAPAE_RPC_URL ?? "https://sepolia-rpc.giwa.io"]}},
    blockExplorers: {default: {name: "Blockscout", url: "https://sepolia-explorer.giwa.io"}},
    contracts: {
        multicall3: {address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 0},
    },
});

export const addresses = {
    manager: "0xfd0fCCCcF8071852783b5133b3CC47461f33e6Cd",
    dojangEnforcer: "0xb2906a5079702B82C2973423d8cf91e8B41e6371",
    payeeEnforcer: "0x7eF0f193B721B1749d890F1e231C8074670f1bD1",
    periodEnforcer: "0xE33ba891fa502A075D3E422258723eF4cB6AC892",
    timestampEnforcer: "0x2911cB5D4aeBCa3e42FAaa5488b6e04df3C9cc02",
    verifiedCodeEnforcer: "0x1C640E0A70b1E18B120bB20952e81Df8F6b8650e",
    perPaymentEnforcer: "0x8900b56d714b902b7AfdbeC4722a9b098C8993d8",
    dojangScroll: "0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9",
    mockKRW: "0x8bd74916E3427B4eF8Bed3D2F49241056E5e4F2B",
} as const;

/** Where a human reviews and signs a requested permission, and where a payment's authority
 *  trace lives. A different frontend deployment can override it. */
export const APP_URL = process.env.MAPAE_APP_URL ?? "https://mapae.pages.dev";
