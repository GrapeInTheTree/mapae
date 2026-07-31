import {useCallback, useEffect, useState} from "react";
import {hashTypedData, type Address, type Hex} from "viem";
import {factoryAbi, dojangScrollAbi, erc20Abi, faucetExtensionAbi} from "@mapae/abi";
import {TESTNET_FAUCET_ID} from "@mapae/protocol";
import {addresses, giwaSepolia} from "./config";
import {client} from "./data";
import {useWallet} from "./wallet";

/** Mirrors `MapaeAccountFactory`'s `EIP712("MapaeAccountFactory", "1")` and CREATION_TYPEHASH.
 *  Checked against the contract's own `creationDigest` before every signature. */
export function accountCreationTypedData(owner: Address, salt: bigint) {
    return {
        domain: {
            name: "MapaeAccountFactory",
            version: "1",
            chainId: giwaSepolia.id,
            verifyingContract: addresses.factory,
        },
        types: {
            MapaeAccountCreation: [
                {name: "owner", type: "address"},
                {name: "salt", type: "uint256"},
            ],
        },
        primaryType: "MapaeAccountCreation" as const,
        message: {owner, salt},
    } as const;
}

/**
 * The identity/funds split, as the UI sees it.
 *
 * A Mapae account holds the money; the OWNER holds the identity. That is not an implementation
 * detail we can hide - it exists because an exchange attests a person's own wallet and would
 * never attest a contract deployed five seconds ago. So the account is deterministic and
 * disposable, and the Dojang attestation stays where it already is.
 *
 * Salt 0 is the account the Composer uses. Multiple accounts per owner are supported by the
 * factory and are a later feature; one is enough to grant authority from.
 */

const DEFAULT_SALT = 0n;

export interface AccountState {
    /** Where the account will live, known before it exists. */
    address: Address | null;
    deployed: boolean;
    loading: boolean;
    creating: boolean;
    error: string | null;
    refresh: () => void;
    create: () => Promise<void>;
}

export function useMapaeAccount(): AccountState {
    const {address: owner, walletClient, onGiwa} = useWallet();
    const [address, setAddress] = useState<Address | null>(null);
    const [deployed, setDeployed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    const refresh = useCallback(() => setNonce((n) => n + 1), []);

    useEffect(() => {
        if (!owner) {
            setAddress(null);
            setDeployed(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const predicted = (await client.readContract({
                    address: addresses.factory,
                    abi: factoryAbi,
                    functionName: "predict",
                    args: [owner, DEFAULT_SALT],
                })) as Address;
                const isAccount = (await client.readContract({
                    address: addresses.factory,
                    abi: factoryAbi,
                    functionName: "isMapaeAccount",
                    args: [predicted],
                })) as boolean;
                if (cancelled) return;
                setAddress(predicted);
                setDeployed(isAccount);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [owner, nonce]);

    const create = useCallback(async () => {
        if (!owner || !walletClient || !onGiwa) return;
        setCreating(true);
        setError(null);
        try {
            // The factory refuses to bind an owner who did not consent, which is what stops
            // anyone from pointing a fresh account at a stranger's verified address and
            // borrowing their identity.
            //
            // This is EIP-712, not a personal_sign: the factory checks the signature against the
            // raw typed-data digest. Signing with `signMessage` would add the EIP-191 prefix and
            // produce a signature that is valid, well-formed, and rejected on-chain.
            const typed = accountCreationTypedData(owner, DEFAULT_SALT);

            // The domain is reproduced client-side, so verify it against the contract's own
            // digest before asking anyone to sign. A drifted name, version or chainId would
            // otherwise surface as an opaque revert at the transaction, not here.
            const [onChainDigest, localDigest] = await Promise.all([
                client.readContract({
                    address: addresses.factory,
                    abi: factoryAbi,
                    functionName: "creationDigest",
                    args: [owner, DEFAULT_SALT],
                }) as Promise<Hex>,
                Promise.resolve(hashTypedData(typed)),
            ]);
            if (onChainDigest.toLowerCase() !== localDigest.toLowerCase()) {
                throw new Error("Account creation domain does not match the deployed factory");
            }

            const signature = await walletClient.signTypedData({account: owner, ...typed});

            const hash = await walletClient.writeContract({
                address: addresses.factory,
                abi: factoryAbi,
                functionName: "createAccount",
                args: [owner, DEFAULT_SALT, signature],
                account: owner,
                chain: null,
            });
            await client.waitForTransactionReceipt({hash});
            refresh();
        } catch (e) {
            setError(readableError(e));
        } finally {
            setCreating(false);
        }
    }, [owner, walletClient, onGiwa, refresh]);

    return {address, deployed, loading, creating, error, refresh, create};
}

/**
 * Whether an address holds a live attestation from one issuer, read the same way the enforcer
 * reads it: `isVerified`, which collapses absent, expired and revoked into a single false and
 * never reverts. Any other read would show a status the chain would not act on.
 */
export function useDojangStatus(principal: Address | null, attesterId: Hex | null) {
    const [verified, setVerified] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!principal || !attesterId) {
            setVerified(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        client
            .readContract({
                address: addresses.dojangScroll,
                abi: dojangScrollAbi,
                functionName: "isVerified",
                args: [principal, attesterId],
            })
            .then((v) => {
                if (!cancelled) setVerified(Boolean(v));
            })
            .catch(() => {
                if (!cancelled) setVerified(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [principal, attesterId, tick]);

    return {verified, loading, refresh: () => setTick((t) => t + 1)};
}

/**
 * Self-service Dojang issuance, in the page instead of a cast command.
 *
 * The first real user to walk the MCP flow hit this exact wall: a fresh wallet has no
 * attestation, and the only issuance path was a CLI call with a private key on the command
 * line. The connected wallet can simply make that call itself - the fee is read from the
 * contract at click time, never hardcoded, and the attestation lands on msg.sender, which is
 * exactly the signing principal the delegation's identity condition names.
 */
export function useIssueDojang() {
    const wallet = useWallet();
    const [issuing, setIssuing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const issue = async (): Promise<boolean> => {
        if (!wallet.walletClient || !wallet.address) return false;
        setIssuing(true);
        setError(null);
        try {
            const fee = await client.readContract({
                address: addresses.giwaFaucetExtension,
                abi: faucetExtensionAbi,
                functionName: "fee",
            });
            const hash = await wallet.walletClient.writeContract({
                address: addresses.giwaFaucetExtension,
                abi: faucetExtensionAbi,
                functionName: "payAndIssueEAS",
                value: fee,
                account: wallet.address,
                chain: null,
            });
            await client.waitForTransactionReceipt({hash, timeout: 90_000});
            // The load-balanced RPC can serve a stale read for a few blocks; poll until the
            // attestation is visible so the UI flips exactly once, to a true state.
            for (let i = 0; i < 10; i++) {
                const live = await client.readContract({
                    address: addresses.dojangScroll,
                    abi: dojangScrollAbi,
                    functionName: "isVerified",
                    args: [wallet.address, TESTNET_FAUCET_ID],
                });
                if (live) return true;
                await new Promise((r) => setTimeout(r, 1500));
            }
            return true;
        } catch (e) {
            setError(readableError(e));
            return false;
        } finally {
            setIssuing(false);
        }
    };

    return {issue, issuing, error};
}

export function useTokenBalance(token: Address | null, holder: Address | null) {
    const [balance, setBalance] = useState<bigint | null>(null);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!token || !holder) {
            setBalance(null);
            return;
        }
        let cancelled = false;
        client
            .readContract({address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder]})
            .then((b) => {
                if (!cancelled) setBalance(b as bigint);
            })
            .catch(() => {
                if (!cancelled) setBalance(null);
            });
        return () => {
            cancelled = true;
        };
    }, [token, holder, tick]);
    return {balance, refresh: () => setTick((t) => t + 1)};
}

/**
 * The mKRW faucet, as a button.
 *
 * Until now every account was funded by our own scripts - which meant a stranger walking the
 * product path arrived at a working account with an invisible hand behind it. MockKRW's mint is
 * deliberately permissionless (it is the asset-agnosticism placeholder, not a treasury), so the
 * connected wallet can pour test funds into its own MapaeAccount directly. ₩100,000 per press.
 */
export function useMintTestKRW() {
    const wallet = useWallet();
    const [minting, setMinting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mint = async (to: Address): Promise<boolean> => {
        if (!wallet.walletClient || !wallet.address) return false;
        setMinting(true);
        setError(null);
        try {
            const hash = await wallet.walletClient.writeContract({
                address: addresses.mockKRW,
                abi: erc20Abi,
                functionName: "mint",
                args: [to, 100_000n],
                account: wallet.address,
                chain: null,
            });
            await client.waitForTransactionReceipt({hash, timeout: 90_000});
            return true;
        } catch (e) {
            setError(readableError(e));
            return false;
        } finally {
            setMinting(false);
        }
    };

    return {mint, minting, error};
}

/** Wallet errors arrive as walls of JSON-RPC text; show the sentence a person can act on. */
export function readableError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|denied|4001/i.test(msg)) return "Rejected in wallet";
    if (/insufficient funds/i.test(msg)) return "Not enough ETH for gas";
    const first = msg.split("\n")[0] ?? msg;
    return first.length > 140 ? `${first.slice(0, 140)}…` : first;
}
