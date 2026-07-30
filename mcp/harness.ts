/**
 * Drives mapae-mcp exactly the way an MCP client would, over stdio JSON-RPC.
 *
 * Phase 1 plays the HUMAN: the principal key signs a fresh ₩2,000/day authority for the agent,
 * paying from the fleet's MapaeAccount (recovered from live chain calldata, not from any file).
 * Phase 2 plays the AGENT'S CLIENT: spawn the built server with only the agent key and the
 * context, then call every tool - including a real payment - and print what a model would see.
 */
import "/Users/ahn_euijin/mapae/scripts/env.js";
import {spawn} from "node:child_process";
import {createPublicClient, decodeAbiParameters, decodeFunctionData, http, keccak256, toHex, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {addresses, giwaSepolia, TESTNET_FAUCET_ID} from "/Users/ahn_euijin/mapae/sdk/src/constants.js";
import {managerAbi} from "/Users/ahn_euijin/mapae/sdk/src/abi.js";
import {
    DELEGATION_TYPES,
    delegationDomain,
    dojangTerms,
    encodePermissionContext,
    payeeTerms,
    periodTerms,
    timestampTerms,
    rootDelegation,
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

async function main() {
    /* -------------------------- phase 1: the human ------------------------- */
    const ACCOUNT = await fleetAccount();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const merchant = privateKeyToAccount(keccak256(toHex("mapae-mcp-merchant"))).address;

    const unsigned = rootDelegation({
        delegate: agent.address,
        delegator: ACCOUNT,
        caveats: [
            {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 2_000n, 86_400n, now - 60n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([merchant]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now + 7n * 86_400n), args: "0x"},
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
    console.log(`human issued: account ${ACCOUNT}, merchant ${merchant}, cap 2000/day`);

    /* -------------------------- phase 2: the client ------------------------- */
    const child = spawn("node", ["/Users/ahn_euijin/mapae/mcp/dist/index.js"], {
        env: {
            ...process.env,
            MAPAE_AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY,
            MAPAE_PERMISSION_CONTEXT: context,
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
    const notify = (method: string) =>
        child.stdin.write(JSON.stringify({jsonrpc: "2.0", method}) + "\n");
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

    const tools = await request("tools/list", {});
    console.log(`tools: ${tools.result.tools.map((t: {name: string}) => t.name).join(", ")}`);

    await call("list_permissions");
    await call("check_budget");
    await call("request_permission", {
        agentName: "Harness Agent",
        amountPerPeriod: 30_000,
        period: "day",
        merchant,
        validDays: 14,
    });
    const paid = await call("pay", {amount: 700});
    if (!paid.includes('"PAID"')) throw new Error("pay did not settle");
    await call("check_budget");
    const over = await call("pay", {amount: 1_500});
    if (!over.includes('"REFUSED"')) throw new Error("over-cap pay was not refused");

    const redel = await call("redelegate", {to: merchant, capAmount: 500});
    const ctx2 = JSON.parse(redel).permissionContext as Hex;
    const [chain2] = decodeAbiParameters(DELEGATION_PARAMS, ctx2) as unknown as [Delegation[]];
    if (chain2.length !== 2) throw new Error("child context is not 2 hops");
    console.log(`\nredelegated context verified: ${chain2.length} hops, child delegate ${chain2[0].delegate}`);

    child.kill();
    console.log("\nALL GREEN");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
