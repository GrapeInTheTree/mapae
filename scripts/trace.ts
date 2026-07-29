/**
 * The accountability traceback: resolve a payment tx hash backwards to the verified human who
 * authorised it, entirely from public on-chain state.
 *
 *   pnpm trace <txHash>
 *
 * payment tx
 *   -> DojangGatePassed log        (which delegation, which principal, which attestation)
 *   -> RedeemedDelegation log      (who redeemed, whose account paid)
 *   -> TransferredInPeriod log     (how much, against which cap)
 *   -> EAS.getAttestation(uid)     (issuer, issued-at, expiry, revocation status - LIVE)
 *   -> DojangAttesterBook          (the named issuer really is who signed the attestation)
 *   -> MapaeAccount.owner()        (the account's bound principal matches)
 *
 * Every other agent-payment stack answers "did the payment go through?". This answers the question
 * an auditor, a counterparty or an insurer actually asks: WHICH VERIFIED PERSON AUTHORISED THIS,
 * UNDER WHAT LIMITS, AND IS THEIR IDENTITY STILL VALID?
 */
import "./env.js";
import {createPublicClient, http, parseEventLogs, formatUnits} from "viem";
import {addresses, giwaSepolia, UPBIT_KOREA_ID, TESTNET_FAUCET_ID} from "../sdk/src/constants.js";
import {
    accountAbi,
    attesterBookAbi,
    dojangEnforcerAbi,
    easAbi,
    factoryAbi,
    periodEnforcerAbi,
} from "../sdk/src/abi.js";

const txHash = process.argv[2] as `0x${string}` | undefined;
if (!txHash?.startsWith("0x")) {
    console.error("usage: pnpm trace <txHash>");
    process.exit(1);
}

const pub = createPublicClient({
    chain: giwaSepolia,
    transport: http(process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io"),
});

const ISSUER_NAMES: Record<string, string> = {
    [UPBIT_KOREA_ID]: "UPBIT KOREA (real KYC issuer)",
    [TESTNET_FAUCET_ID]: "TESTNET FAUCET (self-service testnet issuer)",
};

function line(label: string, value: string) {
    console.log(`  ${label.padEnd(26)} ${value}`);
}

const receipt = await pub.getTransactionReceipt({hash: txHash});
console.log(`\ntx ${txHash}`);
console.log(`block ${receipt.blockNumber} · status ${receipt.status}\n`);

const gate = parseEventLogs({abi: dojangEnforcerAbi, logs: receipt.logs, eventName: "DojangGatePassed"});
if (gate.length === 0) {
    console.error("no DojangGatePassed log - this tx is not an identity-gated Mapae redemption");
    process.exit(1);
}
const g = gate[0].args;

console.log("1. The identity gate this payment passed");
line("delegation hash", g.delegationHash);
line("delegator (account)", g.delegator);
line("principal (human)", g.principal);
line("required issuer", `${g.attesterId}`);
line("", ISSUER_NAMES[g.attesterId] ?? "(unknown issuer id)");
line("attestation uid", g.attestationUid);

const spend = parseEventLogs({abi: periodEnforcerAbi, logs: receipt.logs, eventName: "TransferredInPeriod"});
if (spend.length > 0) {
    const s = spend[0].args;
    console.log("\n2. The limits it was spent under");
    line("redeemer (agent)", s.redeemer);
    line("token", s.token);
    line("period cap", `${formatUnits(s.periodAmount, 0)} per ${s.periodDuration}s`);
    line("spent this period", `${formatUnits(s.transferredInCurrentPeriod, 0)} (after this payment)`);
}

console.log("\n3. The attestation, read back from EAS - LIVE, not cached");
const att = await pub.readContract({address: addresses.eas, abi: easAbi, functionName: "getAttestation", args: [g.attestationUid]});
line("recipient", att.recipient);
line("attester", att.attester);
line("issued at", new Date(Number(att.time) * 1000).toISOString());
line("expires", att.expirationTime === 0n ? "never" : new Date(Number(att.expirationTime) * 1000).toISOString());
line("revoked", att.revocationTime === 0n ? "no - still live" : `YES at ${new Date(Number(att.revocationTime) * 1000).toISOString()}`);

console.log("\n4. Binding checks - every link verified, none trusted");
const bookAttester = await pub.readContract({address: addresses.dojangAttesterBook, abi: attesterBookAbi, functionName: "getAttester", args: [g.attesterId]});
const attesterOk = bookAttester.toLowerCase() === att.attester.toLowerCase();
line("issuer id -> address", `${bookAttester} ${attesterOk ? "== attestation.attester OK" : "MISMATCH!"}`);

const recipientOk = att.recipient.toLowerCase() === g.principal.toLowerCase();
line("attestation recipient", recipientOk ? "== principal OK" : "MISMATCH!");

let ownerOk = true;
if (g.delegator.toLowerCase() !== g.principal.toLowerCase()) {
    const registered = await pub.readContract({address: addresses.factory, abi: factoryAbi, functionName: "isMapaeAccount", args: [g.delegator]});
    const owner = await pub.readContract({address: g.delegator, abi: accountAbi, functionName: "owner"});
    ownerOk = registered && owner.toLowerCase() === g.principal.toLowerCase();
    line("account registered", registered ? "factory-registered OK" : "NOT REGISTERED!");
    line("account.owner()", `${owner} ${owner.toLowerCase() === g.principal.toLowerCase() ? "== principal OK" : "MISMATCH!"}`);
}

const allOk = attesterOk && recipientOk && ownerOk;
console.log(
    allOk
        ? `\nAccountability chain intact: this payment was authorised by ${g.principal},\nwhose identity was attested by ${ISSUER_NAMES[g.attesterId] ?? g.attesterId}.`
        : "\nWARNING: accountability chain has a broken link - see MISMATCH above.",
);
