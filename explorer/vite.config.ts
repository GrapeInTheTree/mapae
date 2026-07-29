import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {fileURLToPath} from "node:url";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            // SDK modules reused verbatim: pure viem, no env, no JSON imports. The delegation
            // module is the reference encoder, pinned byte-for-byte against Solidity by
            // sdk/test/encoding.test.ts - the Composer signs with the same code the demo does.
            "@mapae/abi": fileURLToPath(new URL("../sdk/src/abi.ts", import.meta.url)),
            "@mapae/sdk": fileURLToPath(new URL("../sdk/src/delegation.ts", import.meta.url)),
            "@mapae/protocol": fileURLToPath(new URL("../sdk/src/protocol.ts", import.meta.url)),
            "@mapae/policy": fileURLToPath(new URL("../sdk/src/policy.ts", import.meta.url)),
        },
    },
    server: {
        fs: {allow: [fileURLToPath(new URL("..", import.meta.url))]},
    },
});
