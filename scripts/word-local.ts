/**
 * Local HTTPS mode for Word on the desktop: https://localhost:3444 with the Office add-in development certificate
 * (npx office-addin-dev-certs install), and a manifest pointing there for sideloading. Started by INDITAS.bat.
 */
// The keys come from the .env file next to package.json (INDITAS.bat creates it on the first run)
import "dotenv/config";
import fs from "fs";
import path from "path";
import { generateManifest } from "../src/manifest";
import { parseAuthConfig } from "../server/msAuth";

export const LOCAL_HTTPS_PORT = 3444;
const manifestPath = path.join(process.cwd(), "manifest.local.xml");

// With Microsoft sign-in (AUTH_MODE=microsoft or both) Word must know the app registration
const auth = parseAuthConfig(process.env);
const ssoClientId = auth.mode !== "key" && !auth.problem ? auth.clientId : undefined;
fs.writeFileSync(manifestPath, generateManifest(`https://localhost:${LOCAL_HTTPS_PORT}`, ssoClientId));
console.log(`Manifest written: ${manifestPath}${ssoClientId ? " (with Microsoft sign-in: re-sideload it if it was installed without)" : ""}`);

process.env.LOCAL_HTTPS_PORT = String(LOCAL_HTTPS_PORT);
// No hot reload: its websocket would be plain ws:// next to an https page
process.env.DISABLE_HMR = "true";
await import("../server");
