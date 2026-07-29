import {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";
import type {ReactNode} from "react";
import {createWalletClient, custom, type Address, type WalletClient} from "viem";
import {giwaSepolia} from "./config";

/**
 * Wallet access, deliberately thin.
 *
 * No connector library, no modal, no vendor list: an injected EIP-1193 provider is the only
 * thing GIWA users have today, and a dependency that renders a wallet grid would be more code
 * than the feature. If a provider is absent the UI says so and every signing path stays disabled
 * rather than failing at the moment of signature.
 *
 * The chain is checked on every render that matters. Signing an EIP-712 payload whose domain
 * names chain 91342 while the wallet sits on another chain produces a signature that verifies
 * nowhere - the wallet will happily produce it, and it will fail on first use, hours later.
 */

interface Eip1193 {
    request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
    on?: (event: string, handler: (...args: never[]) => void) => void;
    removeListener?: (event: string, handler: (...args: never[]) => void) => void;
}

declare global {
    interface Window {
        ethereum?: Eip1193;
    }
}

interface Ctx {
    available: boolean;
    address: Address | null;
    chainId: number | null;
    onGiwa: boolean;
    connecting: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
    switchToGiwa: () => Promise<void>;
    /** Null until connected. Callers must gate on `address` rather than assert. */
    walletClient: WalletClient | null;
}

const WalletContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "mapae.wallet.connected";

export function WalletProvider({children}: {children: ReactNode}) {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    const [address, setAddress] = useState<Address | null>(null);
    const [chainId, setChainId] = useState<number | null>(null);
    const [connecting, setConnecting] = useState(false);

    const readChain = useCallback(async () => {
        if (!provider) return;
        try {
            const id = (await provider.request({method: "eth_chainId"})) as string;
            setChainId(Number.parseInt(id, 16));
        } catch {
            setChainId(null);
        }
    }, [provider]);

    const connect = useCallback(async () => {
        if (!provider) return;
        setConnecting(true);
        try {
            const accounts = (await provider.request({method: "eth_requestAccounts"})) as Address[];
            if (accounts?.[0]) {
                setAddress(accounts[0]);
                localStorage.setItem(STORAGE_KEY, "1");
            }
            await readChain();
        } catch {
            // User rejected, or the provider is locked. Both are ordinary; stay disconnected.
        } finally {
            setConnecting(false);
        }
    }, [provider, readChain]);

    const disconnect = useCallback(() => {
        setAddress(null);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const switchToGiwa = useCallback(async () => {
        if (!provider) return;
        const hexId = `0x${giwaSepolia.id.toString(16)}`;
        try {
            await provider.request({method: "wallet_switchEthereumChain", params: [{chainId: hexId}]});
        } catch {
            // 4902 and friends: the wallet does not know GIWA yet, so offer to add it.
            await provider
                .request({
                    method: "wallet_addEthereumChain",
                    params: [
                        {
                            chainId: hexId,
                            chainName: giwaSepolia.name,
                            nativeCurrency: giwaSepolia.nativeCurrency,
                            rpcUrls: [...giwaSepolia.rpcUrls.default.http],
                            blockExplorerUrls: [giwaSepolia.blockExplorers.default.url],
                        },
                    ],
                })
                .catch(() => {});
        }
        await readChain();
    }, [provider, readChain]);

    // Reconnect silently if the user connected before and the provider still authorises us.
    useEffect(() => {
        if (!provider || localStorage.getItem(STORAGE_KEY) !== "1") return;
        provider
            .request({method: "eth_accounts"})
            .then((accts) => {
                const a = (accts as Address[])?.[0];
                if (a) setAddress(a);
            })
            .catch(() => {});
        void readChain();
    }, [provider, readChain]);

    useEffect(() => {
        if (!provider?.on) return;
        const onAccounts = (...args: never[]) => {
            const accts = args[0] as unknown as Address[];
            setAddress(accts?.[0] ?? null);
            if (!accts?.[0]) localStorage.removeItem(STORAGE_KEY);
        };
        const onChain = (...args: never[]) => {
            setChainId(Number.parseInt(args[0] as unknown as string, 16));
        };
        provider.on("accountsChanged", onAccounts);
        provider.on("chainChanged", onChain);
        return () => {
            provider.removeListener?.("accountsChanged", onAccounts);
            provider.removeListener?.("chainChanged", onChain);
        };
    }, [provider]);

    const walletClient = useMemo(() => {
        if (!provider || !address) return null;
        return createWalletClient({account: address, chain: giwaSepolia, transport: custom(provider)});
    }, [provider, address]);

    const value = useMemo<Ctx>(
        () => ({
            available: Boolean(provider),
            address,
            chainId,
            onGiwa: chainId === giwaSepolia.id,
            connecting,
            connect,
            disconnect,
            switchToGiwa,
            walletClient,
        }),
        [provider, address, chainId, connecting, connect, disconnect, switchToGiwa, walletClient],
    );

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Ctx {
    const c = useContext(WalletContext);
    if (!c) throw new Error("useWallet outside WalletProvider");
    return c;
}
