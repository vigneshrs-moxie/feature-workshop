#!/usr/bin/env node
// ground-control: Starbase's old command name (G36), kept for one release. It says the new name
// once, on stderr (so a script reading the output still gets only the command's own), and then runs
// the very same command with the same arguments: bin/starbase.js.
import { main } from './starbase.js';

export const RENAMED = 'ground-control is now called starbase. This ran the same command; next time, type starbase.';

process.stderr.write(`${RENAMED}\n`);
process.exitCode = await main(process.argv.slice(2));
