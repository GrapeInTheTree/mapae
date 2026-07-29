import {useCallback, useEffect, useState} from "react";
import {hashTypedData, type Address, type Hex} from "viem";
import {factoryAbi, dojangScrollAbi, erc20Abi} from "@mapae/abi";
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
    }, [principal, attesterId]);

    return {verified, loading};
}

export function useTokenBalance(token: Address | null, holder: Address | null) {
    const [balance, setBalance] = useState<bigint | null>(null);
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
    }, [token, holder]);
    return balance;
}

/** Wallet errors arrive as walls of JSON-RPC text; show the sentence a person can act on. */
export function readableError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|denied|4001/i.test(msg)) return "Rejected in wallet";
    if (/insufficient funds/i.test(msg)) return "Not enough ETH for gas";
    const first = msg.split("\n")[0] ?? msg;
    return first.length > 140 ? `${first.slice(0, 140)}…` : first;
}
