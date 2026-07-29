import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {fileURLToPath} from "node:url";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            // The one SDK module reused verbatim: pure viem ABIs, no env, no JSON imports.
            "@mapae/abi": fileURLToPath(new URL("../sdk/src/abi.ts", import.meta.url)),
        },
    },
    server: {
        fs: {allow: [fileURLToPath(new URL("..", import.meta.url))]},
    },
});
