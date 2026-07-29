import {useEffect, useState} from "react";
import {BrowserRouter, Link, NavLink, Route, Routes} from "react-router-dom";
import Home from "./pages/Home";
import Tx from "./pages/Tx";
import Create from "./pages/Create";
import Permissions from "./pages/Permissions";
import {Logo} from "./components/ui";
import {ConnectButton, ConnectDialog} from "./components/Connect";
import {client} from "./lib/data";
import {LangProvider, useLang} from "./i18n";
import {WalletProvider} from "./lib/wallet";

function LangToggle() {
    const {lang, setLang} = useLang();
    return (
        <div className="flex items-center rounded-lg border border-line p-0.5 text-[12px]">
            {(["en", "ko"] as const).map((l) => (
                <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`rounded-md px-2 py-1 font-medium transition-colors ${
                        lang === l ? "bg-surface-2 text-ink" : "text-mute hover:text-ink-2"
                    }`}
                >
                    {l === "en" ? "EN" : "한국어"}
                </button>
            ))}
        </div>
    );
}

function Header() {
    const {t} = useLang();
    const [head, setHead] = useState<bigint | null>(null);

    useEffect(() => {
        const tick = () => client.getBlockNumber().then(setHead).catch(() => {});
        tick();
        const id = setInterval(tick, 6000);
        return () => clearInterval(id);
    }, []);

    const link = ({isActive}: {isActive: boolean}) =>
        `relative py-1 text-[13.5px] transition-colors ${
            isActive
                ? "text-ink after:absolute after:-bottom-[14px] after:left-0 after:h-px after:w-full after:bg-bronze"
                : "text-mute hover:text-ink-2"
        }`;

    return (
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3.5">
                <Link to="/" className="shrink-0">
                    <Logo px={22} />
                </Link>

                <nav className="flex items-center gap-6">
                    <NavLink to="/" end className={link}>
                        {t("nav", "explorer")}
                    </NavLink>
                    <NavLink to="/create" className={link}>
                        {t("nav", "create")}
                    </NavLink>
                    <NavLink to="/permissions" className={link}>
                        {t("nav", "permissions")}
                    </NavLink>
                </nav>

                <div className="ml-auto flex items-center gap-3">
                    <span className="hidden items-center gap-1.5 font-mono text-[12px] text-mute lg:flex">
                        <span className="h-1.5 w-1.5 rounded-full bg-jade" />
                        GIWA Sepolia {head !== null ? `#${head.toLocaleString()}` : "…"}
                    </span>
                    <LangToggle />
                    <ConnectButton compact />
                </div>
            </div>
        </header>
    );
}

function Footer() {
    const {t, lang} = useLang();
    return (
        <footer className="mt-20 border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[12.5px] text-mute">
                <span className="max-w-md leading-relaxed">
                    {lang === "ko"
                        ? "조선의 마패는 위조할 수 있었습니다. 이것은 쓰일 때마다 중심을 다시 얻어야 합니다."
                        : "A real mapae could be forged, because it was only an object. This one has to earn its centre every time it is used."}
                </span>
                <div className="flex items-center gap-5">
                    <span className="hidden md:inline">{t("brand", "pitch")}</span>
                    <a
                        href="https://github.com/GrapeInTheTree/mapae"
                        target="_blank"
                        rel="noreferrer"
                        className="transition-colors hover:text-ink-2"
                    >
                        GitHub
                    </a>
                    <a
                        href="https://sepolia-explorer.giwa.io"
                        target="_blank"
                        rel="noreferrer"
                        className="transition-colors hover:text-ink-2"
                    >
                        Blockscout
                    </a>
                </div>
            </div>
        </footer>
    );
}

export default function App() {
    return (
        <LangProvider>
            <WalletProvider>
                <BrowserRouter>
                    <div className="flex min-h-screen flex-col">
                        <Header />
                        <main className="flex-1">
                            <Routes>
                                <Route path="/" element={<Home />} />
                                <Route path="/create" element={<Create />} />
                                <Route path="/permissions" element={<Permissions />} />
                                <Route path="/tx/:hash" element={<Tx />} />
                            </Routes>
                        </main>
                        <Footer />
                        {/* One dialog for the whole app, raised from anywhere. */}
                        <ConnectDialog />
                    </div>
                </BrowserRouter>
            </WalletProvider>
        </LangProvider>
    );
}
