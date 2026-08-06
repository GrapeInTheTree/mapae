/**
 * Drives mapae-mcp exactly the way an MCP client would, over stdio JSON-RPC.
 *
 * Phase 1 plays the HUMAN: the principal key signs a fresh authority for the agent - ₩5,000/day,
 * ₩1,000 per payment, TWO allowed payees - paying from the fleet's MapaeAccount (recovered from
 * live chain calldata, not from any file).
 * Phase 2 plays the AGENT'S CLIENT: spawn the built server with only the agent key and the
 * context, then call every tool - including real payments to both payees, a per-payment refusal
 * on-chain, and an off-policy payee rejected before any transaction.
 */
import "/Users/ahn_euijin/mapae/scripts/env.js";
import {spawn} from "node:child_process";
import {rmSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {createPublicClient, createWalletClient, decodeAbiParameters, decodeFunctionData, encodeFunctionData, http, keccak256, toHex, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {addresses, giwaSepolia, MODE_SIMPLE_SINGLE, TESTNET_FAUCET_ID} from "/Users/ahn_euijin/mapae/sdk/src/constants.js";
import {accountAbi, managerAbi} from "/Users/ahn_euijin/mapae/sdk/src/abi.js";
import {
    DELEGATION_TYPES,
    delegationDomain,
    dojangTerms,
    encodePermissionContext,
    payeeTerms,
    periodTerms,
    perPaymentTerms,
    timestampTerms,
    rootDelegation,
    encodeExecutionSingle,
    type Delegation,
} from "/Users/ahn_euijin/mapae/sdk/src/delegation.js";

const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);
const pub = createPublicClient({chain: giwaSepolia, transport: http()});

const DELEGATION_PARAMS = [
    {
        type: "tuple[]",
        components: [
            {name: "delegate", type: "address"},
            {name: "delegator", type: "address"},
            {name: "authority", type: "bytes32"},
            {name: "caveats", type: "tuple[]", components: [
                {name: "enforcer", type: "address"},
                {name: "terms", type: "bytes"},
                {name: "args", type: "bytes"},
            ]},
            {name: "salt", type: "uint256"},
            {name: "signature", type: "bytes"},
        ],
    },
] as const;

/** The fleet's paying account, recovered from the chain the way the explorer does it. */
async function fleetAccount(): Promise<Address> {
    const res = await fetch(
        `https://sepolia-explorer.giwa.io/api/v2/addresses/${addresses.manager}/transactions?filter=to`,
    );
    const data = (await res.json()) as {items?: {raw_input?: Hex}[]};
    for (const t of data.items ?? []) {
        if (!t.raw_input?.startsWith("0xcef6d209")) continue;
        const {args} = decodeFunctionData({abi: managerAbi, data: t.raw_input});
        const [contexts] = args as [Hex[], Hex[], Hex[]];
        const [chain] = decodeAbiParameters(DELEGATION_PARAMS, contexts[0]) as unknown as [Delegation[]];
        const root = chain[chain.length - 1];
        if (root.delegator.toLowerCase().startsWith("0x4b6b")) return root.delegator;
    }
    throw new Error("fleet account not found in recent manager txs");
}

/** Spawn the built server over stdio and complete the MCP handshake. Returns a client bound to
 *  it, so a run can raise a second server under a different environment and compare. */
async function connect(env: Record<string, string>) {
    const child = spawn("node", ["/Users/ahn_euijin/mapae/mcp/dist/index.js"], {
        env: {
            ...process.env,
            MAPAE_AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY,
            MAPAE_PERMISSION_CONTEXT: "",
            ...env,
        },
        stdio: ["pipe", "pipe", "inherit"],
    });

    const pending = new Map<number, (v: unknown) => void>();
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            if (msg.id !== undefined && pending.has(msg.id)) {
                pending.get(msg.id)!(msg);
                pending.delete(msg.id);
            }
        }
    });

    let seq = 0;
    const request = (method: string, params: unknown): Promise<any> =>
        new Promise((resolve, reject) => {
            const id = ++seq;
            pending.set(id, resolve);
            child.stdin.write(JSON.stringify({jsonrpc: "2.0", id, method, params}) + "\n");
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    reject(new Error(`timeout: ${method}`));
                }
            }, 120_000);
        });
    const notify = (method: string) => child.stdin.write(JSON.stringify({jsonrpc: "2.0", method}) + "\n");
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const r = await request("tools/call", {name, arguments: args});
        const body = r.result?.content?.[0]?.text ?? JSON.stringify(r);
        console.log(`\n=== ${name} ===\n${body}`);
        return body as string;
    };

    await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {name: "harness", version: "0.0.0"},
    });
    notify("notifications/initialized");
    return {child, call, request, notify};
}

async function main() {
    /* -------------------------- phase 1: the human ------------------------- */
    const ACCOUNT = await fleetAccount();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const merchant = privateKeyToAccount(keccak256(toHex("mapae-mcp-merchant"))).address;
    const merchantB = privateKeyToAccount(keccak256(toHex("mapae-mcp-merchant-b"))).address;

    // The 0.6 policy shape: a period cap AND a per-payment ceiling AND two allowed payees.
    // ₩5,000/day keeps the period cap out of the way so the ₩1,000 ceiling is what refuses.
    const unsigned = rootDelegation({
        delegate: agent.address,
        delegator: ACCOUNT,
        caveats: [
            {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 5_000n, 86_400n, now - 60n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([merchant, merchantB]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now + 7n * 86_400n), args: "0x"},
            {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(1_000n), args: "0x"},
        ],
        salt: BigInt(Date.now()),
    });
    const signed: Delegation = {
        ...unsigned,
        signature: await principal.signTypedData({
            domain: delegationDomain(giwaSepolia.id, addresses.manager),
            types: DELEGATION_TYPES,
            primaryType: "Delegation",
            message: {
                delegate: unsigned.delegate,
                delegator: unsigned.delegator,
                authority: unsigned.authority,
                caveats: unsigned.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
                salt: unsigned.salt,
            },
        }),
    };
    const context = encodePermissionContext([signed]);
    console.log(`human issued: account ${ACCOUNT}, payees ${merchant} + ${merchantB}, cap 5000/day, 1000/payment`);

    /* -------------------------- phase 2: the client ------------------------- */
    // Deliberately NO context in the env: the harness hands it over mid-conversation via
    // load_context, the way a human pasting into a chat would. The run gets its own profile,
    // wiped first, so contexts persisted by real sessions (or previous runs) cannot leak in -
    // persistence is a feature everywhere except in a test that asserts an empty start.
    rmSync(join(homedir(), ".mapae", "harness"), {recursive: true, force: true});
    const server = await connect({MAPAE_PROFILE: "harness"});
    const {child, call, request, notify} = server;

    const tools = await request("tools/list", {});
    console.log(`tools: ${tools.result.tools.map((t: {name: string}) => t.name).join(", ")}`);

    const empty = await call("list_permissions");
    if (!empty.includes('"held": 0')) throw new Error("expected empty start");
    const loaded = await call("load_context", {context});
    if (!loaded.includes('"forThisAgent": true')) throw new Error("load_context failed");
    if (!loaded.includes("no single payment may exceed")) throw new Error("perPayment condition not decoded");
    await call("list_permissions");

    const budget = await call("check_budget");
    if (!budget.includes('"maxPerPayment": "₩1,000 mKRW"')) throw new Error("check_budget missing per-payment ceiling");
    if (!budget.includes('"largestSinglePaymentNow": "₩1,000 mKRW"')) throw new Error("ceiling should bound the largest payment");

    const status = await call("agent_status");
    if (!JSON.parse(status).authorities?.[0]?.maxPerPayment) throw new Error("agent_status missing per-Mapae headroom");

    const req = await call("request_permission", {
        agentName: "Harness Agent",
        amountPerPeriod: 30_000,
        period: "day",
        maxPerPayment: 5_000,
        merchants: [merchant, merchantB],
        merchantNames: ["Lunch counter", "Data API"],
        validDays: 14,
    });
    const link = JSON.parse(req).askTheHuman as string;
    if (!link.includes("perTx=5000")) throw new Error("request link missing perTx");
    if (!link.includes("merchantNames=")) throw new Error("request link missing merchantNames");
    const reqBad = await call("request_permission", {
        agentName: "Harness Agent",
        amountPerPeriod: 1_000,
        maxPerPayment: 2_000,
        merchants: [merchant],
    });
    if (!reqBad.includes("could never bind")) throw new Error("nonsensical per-payment request not rejected");

    // simulate_payment must agree with what pay then actually does - a dry run that disagreed
    // with the real thing would be worse than not having one.
    const dryOk = await call("simulate_payment", {amount: 700});
    if (!dryOk.includes('"wouldSettle": true')) throw new Error(`simulate said no to a payment that settles: ${dryOk}`);

    const dryOver = await call("simulate_payment", {amount: 1_500});
    if (!dryOver.includes('"wouldSettle": false') || !dryOver.includes('"refusedBy": "perPayment"'))
        throw new Error(`simulate did not name the per-payment ceiling: ${dryOver}`);
    if (!dryOver.includes("largestThatWouldSettleNow"))
        throw new Error("a refusal should tell the agent what would go through instead");

    const dryOutsider = await call("simulate_payment", {amount: 100, payee: agent.address});
    if (!dryOutsider.includes('"wouldSettle": false') || !dryOutsider.includes('"refusedBy": "payee"'))
        throw new Error(`simulate did not name the payee set: ${dryOutsider}`);

    const paid = await call("pay", {amount: 700});
    if (!paid.includes('"PAID"')) throw new Error("pay did not settle");
    if (!paid.toLowerCase().includes(merchant.toLowerCase())) throw new Error("default payee should be the first allowed");

    const paidB = await call("pay", {amount: 300, payee: merchantB});
    if (!paidB.includes('"PAID"') || !paidB.toLowerCase().includes(merchantB.toLowerCase()))
        throw new Error("pay to second allowed payee failed");

    // Both refusal modes, because the setting is a promise about what reaches a block. Dry must
    // answer with the same reason and no transaction; the default must still mine one.
    const dry = await connect({MAPAE_PROFILE: "harness", MAPAE_PERMISSION_CONTEXT: context, MAPAE_REFUSAL_MODE: "dry"});
    const dryRefusal = await dry.call("pay", {amount: 1_500});
    dry.child.kill();
    if (!dryRefusal.includes('"REFUSED"') || !dryRefusal.includes("PerPaymentCapExceeded"))
        throw new Error(`dry mode lost the reason: ${dryRefusal}`);
    if (!dryRefusal.includes('"tx": null')) throw new Error(`dry mode broadcast anyway: ${dryRefusal}`);

    const outsider = await call("pay", {amount: 100, payee: agent.address});
    if (!outsider.includes('"NOT_IN_POLICY"')) throw new Error("off-policy payee was not rejected");

    await call("check_budget");
    const over = await call("pay", {amount: 1_500});
    if (!over.includes('"REFUSED"')) throw new Error("over-ceiling pay was not refused");
    if (!over.includes("PerPaymentCapExceeded")) throw new Error(`expected PerPaymentCapExceeded, got: ${over}`);

    // A kill switch has to reach the dry run, not only the payment. The first version of
    // simulate_payment computed the largest settleable amount from the caps alone, so a disabled
    // delegation still advertised a four-figure headroom - and an agent reading that one line
    // would have paid gas for a certain revert, which is the failure the tool exists to prevent.
    //
    // The switch belongs to the delegator, which is the account, so the owner drives it through
    // `execute` - the same path a person takes from the permissions page.
    const principalWallet = createWalletClient({account: principal, chain: giwaSepolia, transport: http()});
    const killSwitch = async (fn: "disableDelegation" | "enableDelegation") => {
        const tx = await principalWallet.writeContract({
            address: ACCOUNT,
            abi: accountAbi,
            functionName: "execute",
            args: [
                MODE_SIMPLE_SINGLE,
                encodeExecutionSingle(addresses.manager, 0n,
                    encodeFunctionData({abi: managerAbi, functionName: fn, args: [signed]})),
            ],
        });
        const r = await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
        // A reverted kill switch would make every assertion below test the state it was already
        // in, and pass. waitForTransactionReceipt does not raise on a reverted status.
        if (r.status !== "success") throw new Error(`${fn} reverted: ${tx}`);
    };

    // GIWA's public RPC load-balances across backends at different heights, so a read taken right
    // after a receipt can still answer from before it - in BOTH directions. Poll for the state we
    // just wrote rather than asserting once.
    const settlesWhen = async (want: boolean): Promise<string> => {
        let last = "";
        for (let i = 0; i < 12; i++) {
            last = await call("simulate_payment", {amount: 100});
            if (last.includes(`"wouldSettle": ${want}`)) return last;
            await new Promise((r) => setTimeout(r, 3_000));
        }
        return last;
    };

    await killSwitch("disableDelegation");

    const dryDisabled = await settlesWhen(false);
    if (!dryDisabled.includes('"wouldSettle": false') || !dryDisabled.includes('"refusedBy": "disabled"'))
        throw new Error(`simulate did not see the delegation was switched off: ${dryDisabled}`);
    if (!dryDisabled.includes('"largestThatWouldSettleNow": "\u20a90') && !dryDisabled.includes('largestThatWouldSettleNow": "₩0'))
        throw new Error(`a disabled delegation must advertise no headroom: ${dryDisabled}`);
    const budgetDisabled = await call("check_budget");
    if (!budgetDisabled.includes('"disabled": true')) throw new Error("check_budget missed the disable");
    if (!budgetDisabled.includes('largestSinglePaymentNow": "₩0'))
        throw new Error(`check_budget still advertised headroom while disabled: ${budgetDisabled}`);

    await killSwitch("enableDelegation");
    const dryBack = await settlesWhen(true);
    if (!dryBack.includes('"wouldSettle": true')) throw new Error(`re-enabling did not restore the tier: ${dryBack}`);
    console.log(`\nkill switch reached the dry run: disabled -> ₩0 headroom, re-enabled -> settles again`);

    const redel = await call("redelegate", {to: merchant, capAmount: 500, maxPerPayment: 200});
    const ctx2 = JSON.parse(redel).permissionContext as Hex;
    const [chain2] = decodeAbiParameters(DELEGATION_PARAMS, ctx2) as unknown as [Delegation[]];
    if (chain2.length !== 2) throw new Error("child context is not 2 hops");
    if (chain2[0].caveats.length !== 2) throw new Error("child should carry period + per-payment caveats");
    if (chain2[0].caveats[1].enforcer.toLowerCase() !== addresses.perPaymentEnforcer.toLowerCase())
        throw new Error("child per-payment caveat missing");
    console.log(`\nredelegated context verified: ${chain2.length} hops, child delegate ${chain2[0].delegate}, ${chain2[0].caveats.length} narrowing caveats`);

    child.kill();
    console.log("\nALL GREEN");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
