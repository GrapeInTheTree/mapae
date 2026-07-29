import {useEffect, useState} from "react";
import {BrowserRouter, Link, Route, Routes} from "react-router-dom";
import Home from "./pages/Home";
import Tx from "./pages/Tx";
import {Mark} from "./components/ui";
import {client} from "./lib/data";

function Header() {
    const [head, setHead] = useState<bigint | null>(null);
    useEffect(() => {
        const tick = () => client.getBlockNumber().then(setHead).catch(() => {});
        tick();
        const t = setInterval(tick, 5000);
        return () => clearInterval(t);
    }, []);

    return (
        <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur-md">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
                <Link to="/" className="flex items-center gap-3">
                    <Mark />
                    <div className="leading-tight">
                        <div className="text-[15.5px] font-semibold tracking-tight text-ink">
                            Mapae <span className="text-bronze-bright">Explorer</span>
                        </div>
                        <div className="text-[11.5px] text-mute">위임 결제의 책임 원장</div>
                    </div>
                </Link>
                <div className="flex items-center gap-3 text-[12.5px]">
                    <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-ink-2">
                        GIWA Sepolia
                    </span>
                    <span className="hidden items-center gap-1.5 font-mono text-mute sm:flex">
                        <span className="h-1.5 w-1.5 rounded-full bg-jade" />
                        {head !== null ? `#${head.toLocaleString()}` : "…"}
                    </span>
                </div>
            </div>
        </header>
    );
}

function Footer() {
    return (
        <footer className="border-t border-line">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-[12.5px] text-mute">
                <span>
                    마패 — 범위가 새겨진 위임. 조선의 마패는 위조할 수 있었지만, 이것은 위조할 수
                    없습니다.
                </span>
                <div className="flex items-center gap-4">
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
        <BrowserRouter>
            <div className="flex min-h-screen flex-col">
                <Header />
                <main className="flex-1">
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/tx/:hash" element={<Tx />} />
                    </Routes>
                </main>
                <Footer />
            </div>
        </BrowserRouter>
    );
}
