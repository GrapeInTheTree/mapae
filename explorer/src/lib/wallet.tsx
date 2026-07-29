import {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";
import type {ReactNode} from "react";
import {createWalletClient, custom, type Address, type WalletClient} from "viem";
import {giwaSepolia} from "./config";

/**
 * Wallet access.
 *
 * Discovery is EIP-6963 first, `window.ethereum` second. That order matters: once a user has more
 * than one wallet extension installed they race to own `window.ethereum`, and whoever loses is
 * invisible to any app that only looks there. EIP-6963 is how a wallet announces itself without
 * that fight, and every current wallet implements it. Reading only the legacy global is why an
 * installed wallet can look absent.
 *
 * The chain is checked on every render that matters. Signing an EIP-712 payload whose domain
 * names chain 91342 while the wallet sits elsewhere produces a signature that verifies nowhere -
 * the wallet will happily produce it, and it fails on first use, hours later.
 */

interface Eip1193 {
    request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
    on?: (event: string, handler: (...args: never[]) => void) => void;
    removeListener?: (event: string, handler: (...args: never[]) => void) => void;
}

export interface WalletInfo {
    /** EIP-6963 rdns, or "injected" for the legacy global. */
    id: string;
    name: string;
    /** data: URI from the announcement. Absent for the legacy provider. */
    icon?: string;
    provider: Eip1193;
}

interface Eip6963Detail {
    info: {uuid: string; name: string; icon: string; rdns: string};
    provider: Eip1193;
}

declare global {
    interface Window {
        ethereum?: Eip1193;
    }
}

interface Ctx {
    /** Wallets that announced themselves, plus the legacy global if it is the only one. */
    wallets: WalletInfo[];
    available: boolean;
    connected: WalletInfo | null;
    address: Address | null;
    chainId: number | null;
    onGiwa: boolean;
    connecting: boolean;
    /** Connect to a specific wallet, or the only one if there is exactly one. */
    connect: (id?: string) => Promise<void>;
    disconnect: () => void;
    switchToGiwa: () => Promise<void>;
    /** The last connection failure, in a form worth showing. */
    error: string | null;
    walletClient: WalletClient | null;

    /* The connect dialog is app-global rather than owned by a button. Several buttons can offer
       to connect on one page, and a dialog per button means two of them can be open at once -
       which is exactly what happened. One piece of state, one dialog. */
    connectPromptOpen: boolean;
    promptConnect: () => void;
    dismissConnect: () => void;
}

const WalletContext = createContext<Ctx | null>(null);
const LAST_USED = "mapae.wallet.rdns";

export function WalletProvider({children}: {children: ReactNode}) {
    const [wallets, setWallets] = useState<WalletInfo[]>([]);
    const [connectedId, setConnectedId] = useState<string | null>(null);
    const [address, setAddress] = useState<Address | null>(null);
    const [chainId, setChainId] = useState<number | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [connectPromptOpen, setConnectPromptOpen] = useState(false);

    /* ----------------------------- discovery ------------------------------ */

    useEffect(() => {
        const found = new Map<string, WalletInfo>();

        const onAnnounce = (e: Event) => {
            const {info, provider} = (e as CustomEvent<Eip6963Detail>).detail;
            found.set(info.rdns, {
                id: info.rdns,
                name: info.name,
                icon: info.icon,
                provider,
            });
            setWallets([...found.values()]);
        };

        window.addEventListener("eip6963:announceProvider", onAnnounce);
        window.dispatchEvent(new Event("eip6963:requestProvider"));

        // A wallet that predates EIP-6963 only ever sets the global. Include it, but only if
        // nothing announced - otherwise it is a duplicate of a wallet already in the list.
        const legacyCheck = setTimeout(() => {
            if (found.size === 0 && window.ethereum) {
                found.set("injected", {
                    id: "injected",
                    name: "Injected wallet",
                    provider: window.ethereum,
                });
                setWallets([...found.values()]);
            }
        }, 300);

        return () => {
            window.removeEventListener("eip6963:announceProvider", onAnnounce);
            clearTimeout(legacyCheck);
        };
    }, []);

    const connected = useMemo(
        () => wallets.find((w) => w.id === connectedId) ?? null,
        [wallets, connectedId],
    );
    const provider = connected?.provider;

    /* ------------------------------ actions ------------------------------- */

    const readChain = useCallback(async (p: Eip1193) => {
        try {
            const id = (await p.request({method: "eth_chainId"})) as string;
            setChainId(Number.parseInt(id, 16));
        } catch {
            setChainId(null);
        }
    }, []);

    const connect = useCallback(
        async (id?: string) => {
            const target = id ? wallets.find((w) => w.id === id) : wallets.length === 1 ? wallets[0] : undefined;
            if (!target) return;
            setConnecting(true);
            setError(null);
            try {
                const accounts = (await target.provider.request({
                    method: "eth_requestAccounts",
                })) as Address[];
                if (accounts?.[0]) {
                    setAddress(accounts[0]);
                    setConnectedId(target.id);
                    localStorage.setItem(LAST_USED, target.id);
                    await readChain(target.provider);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setError(/reject|denied|4001/i.test(msg) ? null : msg.split("\n")[0]);
            } finally {
                setConnecting(false);
            }
        },
        [wallets, readChain],
    );

    const disconnect = useCallback(() => {
        setAddress(null);
        setConnectedId(null);
        setChainId(null);
        localStorage.removeItem(LAST_USED);
    }, []);

    const switchToGiwa = useCallback(async () => {
        if (!provider) return;
        const hexId = `0x${giwaSepolia.id.toString(16)}`;
        try {
            await provider.request({
                method: "wallet_switchEthereumChain",
                params: [{chainId: hexId}],
            });
        } catch {
            // 4902 and friends: the wallet has never heard of GIWA, so offer to add it.
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
        await readChain(provider);
    }, [provider, readChain]);

    /* --------------------------- reconnect, events ------------------------ */

    useEffect(() => {
        const last = localStorage.getItem(LAST_USED);
        if (!last || address) return;
        const w = wallets.find((x) => x.id === last);
        if (!w) return;
        // Silent: `eth_accounts` returns the already-authorised account without a prompt.
        w.provider
            .request({method: "eth_accounts"})
            .then((accts) => {
                const a = (accts as Address[])?.[0];
                if (a) {
                    setAddress(a);
                    setConnectedId(w.id);
                    void readChain(w.provider);
                }
            })
            .catch(() => {});
    }, [wallets, address, readChain]);

    useEffect(() => {
        if (!provider?.on) return;
        const onAccounts = (...args: never[]) => {
            const accts = args[0] as unknown as Address[];
            setAddress(accts?.[0] ?? null);
            if (!accts?.[0]) {
                setConnectedId(null);
                localStorage.removeItem(LAST_USED);
            }
        };
        const onChain = (...args: never[]) =>
            setChainId(Number.parseInt(args[0] as unknown as string, 16));
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
            wallets,
            available: wallets.length > 0,
            connected,
            address,
            chainId,
            onGiwa: chainId === giwaSepolia.id,
            connecting,
            connect,
            disconnect,
            switchToGiwa,
            error,
            walletClient,
            connectPromptOpen,
            promptConnect: () => {
                setError(null);
                setConnectPromptOpen(true);
            },
            dismissConnect: () => setConnectPromptOpen(false),
        }),
        [
            connectPromptOpen,
            wallets,
            connected,
            address,
            chainId,
            connecting,
            connect,
            disconnect,
            switchToGiwa,
            error,
            walletClient,
        ],
    );

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Ctx {
    const c = useContext(WalletContext);
    if (!c) throw new Error("useWallet outside WalletProvider");
    return c;
}
