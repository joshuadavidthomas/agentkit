#!/usr/bin/env bun
/**
 * Transform agent files from superset format to harness-specific format.
 *
 * Usage: ./transform-agent.ts <file> <target>
 *   target: "opencode" | "pi"
 */

import { parse, stringify } from "yaml";

const [file, target] = Bun.argv.slice(2);

if (!file || !target) {
  console.error("Usage: transform-agent.ts <file> <opencode|pi>");
  process.exit(1);
}

const content = await Bun.file(file).text();
const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

if (!match) {
  console.error(`Failed to parse frontmatter in ${file}`);
  process.exit(1);
}

const [, frontmatterRaw, body] = match;
const meta = parse(frontmatterRaw) as Record<string, unknown>;

// Extract harness-specific config
const harnessMeta = (meta[target] as Record<string, unknown>) || {};

// Remove all harness namespaces from common
delete meta.opencode;
delete meta.pi;

// Merge: common fields + harness-specific overrides
const output = { ...meta, ...harnessMeta };

// Output the transformed file
console.log(`---\n${stringify(output).trim()}\n---\n${body}`);
