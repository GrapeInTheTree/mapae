import {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";
import type {ReactNode} from "react";
import {catalogs, en} from "./catalog";
import type {Lang} from "./catalog";

type Section = keyof typeof en;

interface Ctx {
    lang: Lang;
    setLang: (l: Lang) => void;
    /** `t("create", "title")`, with optional `{placeholder}` substitution. */
    t: (section: Section, key: string, vars?: Record<string, string | number>) => string;
    /** Picks the right member of an `{en, ko}` pair - for data that carries both. */
    pick: <T>(pair: {en: T; ko: T}) => T;
}

const LangContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "mapae.lang";

function detect(): Lang {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ko") return saved;
    return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function LangProvider({children}: {children: ReactNode}) {
    const [lang, setLangState] = useState<Lang>(detect);

    useEffect(() => {
        document.documentElement.lang = lang;
        localStorage.setItem(STORAGE_KEY, lang);
    }, [lang]);

    const setLang = useCallback((l: Lang) => setLangState(l), []);

    const t = useCallback(
        (section: Section, key: string, vars?: Record<string, string | number>) => {
            const table = catalogs[lang][section] as Record<string, unknown>;
            const fallback = en[section] as Record<string, unknown>;
            const raw = table?.[key] ?? fallback?.[key];
            // A nested object reached by a flat key is a caller error, not a translation gap;
            // surfacing the key beats rendering "[object Object]".
            if (typeof raw !== "string") return key;
            return interpolate(raw, vars);
        },
        [lang],
    );

    const pick = useCallback(<T,>(pair: {en: T; ko: T}) => pair[lang], [lang]);

    const value = useMemo(() => ({lang, setLang, t, pick}), [lang, setLang, t, pick]);
    return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
    const c = useContext(LangContext);
    if (!c) throw new Error("useLang outside LangProvider");
    return c;
}

/** Nested catalog entries (presets) that a flat key cannot reach. */
export function usePreset(id: "micro" | "burst" | "subscription" | "custom") {
    const {lang} = useLang();
    return catalogs[lang].presets[id] as {name: string; desc: string; long: string};
}

export type {Lang};
