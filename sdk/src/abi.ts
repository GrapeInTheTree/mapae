import {parseAbi} from "viem";

/** ABI fragment for the Delegation tuple, reused by every manager call that takes one. */
const DELEGATION_TUPLE = {
    type: "tuple",
    components: [
        {name: "delegate", type: "address"},
        {name: "delegator", type: "address"},
        {name: "authority", type: "bytes32"},
        {
            name: "caveats",
            type: "tuple[]",
            components: [
                {name: "enforcer", type: "address"},
                {name: "terms", type: "bytes"},
                {name: "args", type: "bytes"},
            ],
        },
        {name: "salt", type: "uint256"},
        {name: "signature", type: "bytes"},
    ],
} as const;

export const managerAbi = [
    {
        type: "function",
        name: "redeemDelegations",
        stateMutability: "nonpayable",
        inputs: [
            {name: "_permissionContexts", type: "bytes[]"},
            {name: "_modes", type: "bytes32[]"},
            {name: "_executionCallDatas", type: "bytes[]"},
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "disableDelegation",
        stateMutability: "nonpayable",
        inputs: [{...DELEGATION_TUPLE, name: "_delegation"}],
        outputs: [],
    },
    {
        type: "function",
        name: "enableDelegation",
        stateMutability: "nonpayable",
        inputs: [{...DELEGATION_TUPLE, name: "_delegation"}],
        outputs: [],
    },
    {
        type: "function",
        name: "getDelegationHash",
        stateMutability: "pure",
        inputs: [{...DELEGATION_TUPLE, name: "_delegation"}],
        outputs: [{type: "bytes32"}],
    },
    {type: "function", name: "getDomainHash", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
    {
        type: "function",
        name: "disabledDelegations",
        stateMutability: "view",
        inputs: [{type: "bytes32"}],
        outputs: [{type: "bool"}],
    },
    {type: "error", name: "BatchDataLengthMismatch", inputs: []},
    {type: "error", name: "EmptyDelegationChain", inputs: []},
    {type: "error", name: "CannotUseADisabledDelegation", inputs: []},
    {type: "error", name: "InvalidDelegate", inputs: []},
    {type: "error", name: "InvalidAuthority", inputs: []},
    {type: "error", name: "InvalidEOASignature", inputs: []},
    {type: "error", name: "InvalidERC1271Signature", inputs: []},
    {type: "error", name: "NotDelegator", inputs: []},
    {type: "error", name: "AlreadyDisabled", inputs: []},
    {type: "error", name: "AlreadyEnabled", inputs: []},
] as const;

export const enforcerErrorsAbi = parseAbi([
    // DojangVerifiedEnforcer
    "error InvalidTermsLength(uint256 length)",
    "error UnknownAccount(address delegator)",
    "error PrincipalMismatch(address delegator, address expectedPrincipal, address actualOwner)",
    "error NotDojangVerified(address principal, bytes32 attesterId)",
    // AllowedPayeeEnforcer
    "error InvalidExecutionLength(uint256 length)",
    "error InvalidMethod(bytes4 selector)",
    "error DirtyRecipientWord(bytes32 word)",
    "error PayeeNotAllowed(address payee)",
    // MapaeAccount
    "error NotDelegationManager(address caller)",
    "error NotOwner(address caller)",
    "error ExecutionFailed()",
]);

export const factoryAbi = parseAbi([
    "function createAccount(address _owner, uint256 _salt, bytes _ownerSignature) returns (address)",
    "function predict(address _owner, uint256 _salt) view returns (address)",
    "function creationDigest(address _owner, uint256 _salt) view returns (bytes32)",
    "function isMapaeAccount(address) view returns (bool)",
    "error InvalidOwnerSignature()",
    "event MapaeAccountCreated(address indexed account, address indexed owner, uint256 salt)",
]);

export const accountAbi = parseAbi([
    "function execute(bytes32 _mode, bytes _executionCalldata) payable returns (bytes[])",
    "function owner() view returns (address)",
]);

export const erc20Abi = parseAbi([
    "function mint(address to, uint256 amount)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function symbol() view returns (string)",
]);

export const dojangScrollAbi = parseAbi([
    "function isVerified(address addr, bytes32 attesterId) view returns (bool)",
    "function getVerifiedAddressAttestationUid(address addr, bytes32 attesterId) view returns (bytes32)",
]);

export const faucetExtensionAbi = parseAbi([
    "function payAndIssueEAS() payable returns (bytes32)",
    "function revokeEAS()",
    "function fee() view returns (uint256)",
]);

export const easAbi = parseAbi([
    "function getAttestation(bytes32 uid) view returns ((bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))",
]);

export const attesterBookAbi = parseAbi([
    "function getAttester(bytes32 attesterId) view returns (address)",
]);

export const dojangEnforcerAbi = parseAbi([
    "event DojangGatePassed(address indexed manager, bytes32 indexed delegationHash, address indexed principal, address delegator, bytes32 attesterId, bytes32 attestationUid)",
]);

export const periodEnforcerAbi = parseAbi([
    "event TransferredInPeriod(address indexed sender, address indexed redeemer, bytes32 indexed delegationHash, address token, uint256 periodAmount, uint256 periodDuration, uint256 startDate, uint256 transferredInCurrentPeriod, uint256 transferTimestamp)",
    "function getAvailableAmount(bytes32 _delegationHash, address _delegationManager, bytes _terms) view returns (uint256 availableAmount, bool isNewPeriod, uint256 currentPeriod)",
]);
