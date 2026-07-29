import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";

/**
 * Load `.env`, if there is one.
 *
 * None of these scripts did this, so every one of them only worked for someone who had already
 * exported the variables into their shell - which meant `pnpm demo` and `pnpm verify-signing`
 * failed with "must be set in .env" while sitting next to a perfectly good .env file. A confusing
 * enough error that it reads as a missing file rather than a missing loader.
 *
 * Node has read .env natively since 20.6, so this needs no dependency. Import it first:
 *
 *     import "./env.js";
 *
 * Values already present in the environment win, which is what lets a one-off run override a
 * committed default without editing anything.
 */
const path = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(path)) {
    try {
        process.loadEnvFile(path);
    } catch {
        // A malformed .env should not stop a script that may not even need it; the missing
        // variable will report itself far more clearly than a parse error here would.
    }
}
