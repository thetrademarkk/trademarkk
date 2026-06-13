import { fyersAdapter } from "../brokers/fyers";
import { runCapture } from "./run-capture";

/**
 * Content entry for Fyers Web (login.fyers.in / app.fyers.in / fyers.in/web —
 * all under *.fyers.in) — bundled standalone as content-fyers.js
 * (extension/vite.content-fyers.config.ts) and registered dynamically when the
 * user enables Fyers capture in the panel settings.
 */
runCapture(fyersAdapter);
