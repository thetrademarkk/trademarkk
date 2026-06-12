import { kiteAdapter } from "../brokers/kite";
import { runCapture } from "./run-capture";

/**
 * Content entry for kite.zerodha.com — bundled standalone as content-kite.js
 * (extension/vite.content.config.ts) and registered dynamically when the user
 * enables Kite capture in the panel settings.
 */
runCapture(kiteAdapter);
