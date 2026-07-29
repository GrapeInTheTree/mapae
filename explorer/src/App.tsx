import {useEffect, useState} from "react";
import {BrowserRouter, Link, NavLink, Route, Routes} from "react-router-dom";
import Home from "./pages/Home";
import Tx from "./pages/Tx";
import Create from "./pages/Create";
import Permissions from "./pages/Permissions";
import Delegations from "./pages/Delegations";
import {Logo} from "./components/ui";
import {ConnectButton, ConnectDialog} from "./components/Connect";
import {client} from "./lib/data";
import {LangProvider, useLang} from "./i18n";
import {WalletProvider} from "./lib/wallet";

/** Both labels are two Latin characters, so the control is the same width in either state and
 *  the header never reflows when the language changes. */
function LangToggle() {
    const {lang, setLang} = useLang();
    return (
        <div className="flex items-center rounded-lg border border-line p-0.5 text-[11.5px]">
            {(["en", "ko"] as const).map((l) => (
                <button
                    key={l}
                    onClick={() => setLang(l)}
                    aria-pressed={lang === l}
                    className={`w-7 rounded-md py-1 text-center font-semibold tracking-wider transition-colors ${
                        lang === l ? "bg-surface-2 text-ink" : "text-mute hover:text-ink-2"
                    }`}
                >
                    {l === "en" ? "EN" : "KO"}
                </button>
            ))}
        </div>
    );
}

function Header() {
    const [head, setHead] = useState<bigint | null>(null);

    useEffect(() => {
        const tick = () => client.getBlockNumber().then(setHead).catch(() => {});
        tick();
        const id = setInterval(tick, 6000);
        return () => clearInterval(id);
    }, []);

    /** Every header item is a full-height flex cell centred on the same axis, so nothing can sit
     *  higher than its neighbours - the earlier py-based layout let the logo and the nav compute
     *  different line boxes and drift ~2px apart. The active underline hugs the header's bottom
     *  edge for the same reason: one shared baseline for the whole strip. */
    const link = ({isActive}: {isActive: boolean}) =>
        `relative flex h-full items-center text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors ${
            isActive
                ? "text-ink after:absolute after:bottom-0 after:left-0 after:h-px after:w-full after:bg-bronze"
                : "text-mute hover:text-ink-2"
        }`;

    return (
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-6xl items-stretch gap-8 px-6">
                <Link to="/" className="flex shrink-0 items-center">
                    <Logo px={21} />
                </Link>

                {/* Navigation stays in English in both languages. These are three proper nouns for
                    places in this app, and translating them changes every label's width, so the
                    whole header reflows the moment someone switches - the chrome moving is a worse
                    cost than the labels being English. It is also the convention GIWA's own site
                    follows. Everything below the header is fully localised. */}
                <nav className="flex items-stretch gap-7">
                    <NavLink to="/" end className={link}>
                        Explorer
                    </NavLink>
                    <NavLink to="/create" className={link}>
                        Create
                    </NavLink>
                    <NavLink to="/permissions" className={link}>
                        Permissions
                    </NavLink>
                </nav>

                <div className="ml-auto flex items-center gap-3">
                    {/* Tabular figures, so a rising block number does not jitter its neighbours. */}
                    <span className="tnum hidden items-center gap-1.5 font-mono text-[11.5px] text-mute lg:flex">
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
                                <Route path="/delegations" element={<Delegations />} />
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
