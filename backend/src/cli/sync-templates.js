// backend/src/cli/sync-templates.js

import { Command } from "commander";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const program = new Command();

program
  .name("sync-templates")
  .description("Sync Playground templates from a remote source to a local directory")
  .option("-s, --source <url>", "Remote URL to fetch template JSON index")
  .option("-d, --dest <directory>", "Local directory to store synced templates", "templates")
  .action(async (options) => {
    const { source, dest } = options;
    if (!source) {
      console.error("Error: source URL is required");
      process.exit(1);
    }
    try {
      const response = await fetch(source);
      if (!response.ok) {
        console.error(`Failed to fetch ${source}: ${response.status} ${response.statusText}`);
        process.exit(1);
      }
      const index = await response.json();
      // Expect index to be an array of { name: string, url: string }
      if (!Array.isArray(index)) {
        console.error("Invalid template index format; expected an array");
        process.exit(1);
      }
      // Ensure destination exists
      const destPath = path.resolve(process.cwd(), dest);
      fs.mkdirSync(destPath, { recursive: true });
      for (const tmpl of index) {
        if (!tmpl.name || !tmpl.url) continue;
        const tmplRes = await fetch(tmpl.url);
        if (!tmplRes.ok) {
          console.warn(`Skipping ${tmpl.name}: unable to fetch ${tmpl.url}`);
          continue;
        }
        const content = await tmplRes.text();
        const filePath = path.join(destPath, tmpl.name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        console.log(`✅ Synced ${tmpl.name}`);
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
