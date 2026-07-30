import {defineConfig} from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: "esm",
    clean: true,
    dts: false,
    /* The bin entry must be directly executable. */
    banner: {js: "#!/usr/bin/env node"},
});
