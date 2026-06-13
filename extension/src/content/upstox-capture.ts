import { upstoxAdapter } from "../brokers/upstox";
import { runCapture } from "./run-capture";

/**
 * Content entry for Upstox (pro.upstox.com / upstox.com) — bundled standalone
 * as content-upstox.js (extension/vite.content-upstox.config.ts) and registered
 * dynamically when the user enables Upstox capture in the panel settings.
 */
runCapture(upstoxAdapter);
