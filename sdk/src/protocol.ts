/**
 * Protocol constants: values fixed by the specification and the contracts, with no dependency on
 * a deployment, an environment variable, or a network.
 *
 * Kept separate from `constants.ts` so that code which only needs to ENCODE a delegation - the
 * browser Composer, a test, a third party's tooling - does not transitively pull in a deployment
 * JSON and `process.env`. Encoding is pure; only addressing is deployment-specific.
 */

/** `bytes32(type(uint256).max)` - marks a delegation as a root rather than a re-delegation. */
export const ROOT_AUTHORITY =
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const;

/** `address(0xa11)` - the sentinel delegate that makes a delegation bearer. */
export const ANY_DELEGATE = "0x0000000000000000000000000000000000000a11" as const;

/** Simple single call, revert-on-failure semantics: the zero mode word. */
export const MODE_SIMPLE_SINGLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/** keccak256("dojang.dojangattesterids.upbitkorea") - derivation pinned by the fork suite. */
export const UPBIT_KOREA_ID =
    "0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034" as const;

/** keccak256("dojang.dojangattesterids.testnetfaucet") */
export const TESTNET_FAUCET_ID =
    "0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678" as const;

/** GIWA Sepolia. No mainnet exists yet. */
export const GIWA_SEPOLIA_CHAIN_ID = 91_342 as const;
