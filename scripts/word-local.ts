/**
 * Local HTTPS mode for Word on the desktop: https://localhost:3444 with the Office add-in development certificate
 * (npx office-addin-dev-certs install), and a manifest pointing there for sideloading. Started by INDITAS.bat.
 */
// The keys come from the .env file next to package.json (INDITAS.bat creates it on the first run)
import "dotenv/config";
import fs from "fs";
import path from "path";
import { generateManifest } from "../src/manifest";

export const LOCAL_HTTPS_PORT = 3444;
const manifestPath = path.join(process.cwd(), "manifest.local.xml");

fs.writeFileSync(manifestPath, generateManifest(`https://localhost:${LOCAL_HTTPS_PORT}`));
console.log(`Manifest written: ${manifestPath}`);

process.env.LOCAL_HTTPS_PORT = String(LOCAL_HTTPS_PORT);
// No hot reload: its websocket would be plain ws:// next to an https page
process.env.DISABLE_HMR = "true";
await import("../server");
