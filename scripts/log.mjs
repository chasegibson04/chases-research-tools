#!/usr/bin/env node
// Appends a timestamped entry to CHANGELOG.agent.log. Never edits existing lines.
// Usage: npm run log -- "<scope>" "<message>"   (AGENT_NAME env var sets the agent label; default "human")
import { appendFileSync } from 'node:fs';
const [scope, ...rest] = process.argv.slice(2);
const message = rest.join(' ');
if (!scope || !message) { console.error('Usage: npm run log -- "<scope>" "<message>"'); process.exit(1); }
const agent = process.env.AGENT_NAME || 'human';
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const off = -d.getTimezoneOffset();
const tz = `UTC${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${tz}`;
appendFileSync('CHANGELOG.agent.log', `[${stamp}] [${agent}] [${scope}] ${message}\n`);
console.log('logged.');
