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

/** keccak256("dojang.dojangattesterids.upbitkorea") - derivation pinned by the fork suite. */
export const UPBIT_KOREA_ID =
    "0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034" as const;

/** keccak256("dojang.dojangattesterids.testnetfaucet") */
export const TESTNET_FAUCET_ID =
    "0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678" as const;

/** bytes32(type(uint256).max) - marks a root delegation. */
export const ROOT_AUTHORITY =
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const;

/** Simple single call, default (revert-on-failure) semantics: the zero mode word. */
export const MODE_SIMPLE_SINGLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
