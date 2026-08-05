import "./env.js";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

/**
 * Is every deployed contract source-verified, right now?
 *
 *   pnpm check-verified
 *
 * The README claims it. A claim about an explorer's state is only worth making if it can be
 * re-checked, and this one was wrong once already: MockKRW reported `is_verified: false` while
 * Blockscout happily displayed source for it, borrowed from a `verified_twin_address_hash` - a
 * DIFFERENT address with identical bytecode that someone else had verified. `forge verify-contract`
 * saw source and said "already verified. Skipping." So the contract looked verified in a browser,
 * looked verified to the toolchain, and was not verified.
 *
 * That is why this reads `is_verified` from the API rather than trusting either surface, and why
 * it reports the twin when it finds one.
 *
 * Partial vs full match is expected and is not a failure. A full match additionally requires the
 * metadata hash to be identical, which depends on absolute source paths at compile time; a
 * partial match means the executable bytecode agrees, which is the property that matters.
 */

const API = "https://sepolia-explorer.giwa.io/api/v2/smart-contracts";

const deployments = JSON.parse(
    readFileSync(fileURLToPath(new URL("../deployments/91342.json", import.meta.url)), "utf8"),
) as Record<string, string>;

/** Ours. External contracts (DojangScroll, the faucet extension) are GIWA's to verify. */
const OURS = [
    "MapaeDelegationManager",
    "MapaeAccountFactory",
    "DojangVerifiedEnforcer",
    "AllowedPayeeEnforcer",
    "ERC20PeriodTransferEnforcer",
    "TimestampEnforcer",
    "PerPaymentLimitEnforcer",
    "VerifiedCodeEnforcer",
    "MockKRW",
];

interface Row {
    name: string;
    address: string;
    verified: boolean;
    onChainName?: string;
    solc?: string;
    runs?: number;
    match?: string;
    twin?: string | null;
    error?: string;
}

const rows: Row[] = [];
for (const name of OURS) {
    const address = deployments[name];
    if (!address) {
        rows.push({name, address: "-", verified: false, error: "absent from deployments/91342.json"});
        continue;
    }
    try {
        const res = await fetch(`${API}/${address}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as Record<string, unknown>;
        rows.push({
            name,
            address,
            verified: Boolean(j.is_verified),
            onChainName: j.name as string,
            solc: String(j.compiler_version ?? "").replace("v", ""),
            runs: j.optimization_runs as number,
            match: j.is_fully_verified ? "full" : j.is_partially_verified ? "partial" : "-",
            twin: (j.verified_twin_address_hash as string) ?? null,
        });
    } catch (e) {
        rows.push({name, address, verified: false, error: e instanceof Error ? e.message : String(e)});
    }
}

const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n  Source verification — GIWA Sepolia, Blockscout\n  ${"─".repeat(84)}`);
for (const r of rows) {
    const mark = r.verified ? G("✓") : R("✗");
    const detail = r.error
        ? R(r.error)
        : D(`${r.solc}  runs=${r.runs}  ${r.match} match${r.twin ? R(`  twin=${r.twin}`) : ""}`);
    console.log(`  ${mark} ${r.name.padEnd(29)} ${D(r.address)}  ${detail}`);
    if (!r.error && r.onChainName !== r.name) {
        console.log(`    ${R(`on-chain name is "${r.onChainName}", expected "${r.name}"`)}`);
    }
}

const failed = rows.filter((r) => !r.verified);
console.log(`  ${"─".repeat(84)}`);
if (failed.length === 0) {
    console.log(`  ${G(`all ${rows.length} verified`)}\n`);
} else {
    console.log(`  ${R(`${failed.length} not verified`)} — re-run with:\n`);
    for (const r of failed) {
        console.log(
            D(
                `    forge verify-contract ${r.address} <path>:${r.name} \\\n` +
                    `      --chain-id 91342 --verifier blockscout \\\n` +
                    `      --verifier-url https://sepolia-explorer.giwa.io/api/ \\\n` +
                    `      --compiler-version 0.8.29 --num-of-optimizations 1000 \\\n` +
                    `      --skip-is-verified-check --watch\n`,
            ),
        );
    }
    // --skip-is-verified-check matters: without it forge sees a twin's source and skips.
    process.exit(1);
}
