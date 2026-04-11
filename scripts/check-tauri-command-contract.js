#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const COMMAND_REGISTRY_PATH = path.join(
  REPO_ROOT,
  "desktop",
  "src-tauri",
  "src",
  "command_registry.rs"
);
const FRONTEND_SRC_DIR = path.join(REPO_ROOT, "desktop", "src");

function getBackendCommandNames() {
  const source = fs.readFileSync(COMMAND_REGISTRY_PATH, "utf8");
  const marker = "tauri::generate_handler![";
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("Could not find tauri::generate_handler![ in command registry");
  }

  const bodyStart = markerIndex + marker.length;
  let depth = 1;
  let cursor = bodyStart;

  while (cursor < source.length && depth > 0) {
    const ch = source[cursor];
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
    }
    cursor += 1;
  }

  if (depth !== 0) {
    throw new Error("Could not parse tauri::generate_handler![...] block");
  }

  const body = source.slice(bodyStart, cursor - 1);
  const commands = new Set();
  const lines = body.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#[")) {
      continue;
    }

    const normalized = line.replace(/,$/, "").trim();
    if (!normalized) {
      continue;
    }

    const segments = normalized.split("::").map((segment) => segment.trim());
    const commandName = segments[segments.length - 1];

    if (commandName) {
      commands.add(commandName);
    }
  }

  return commands;
}

function collectFiles(dirPath) {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const resolved = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(resolved));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(resolved);
    }
  }

  return results;
}

function getFrontendInvokedCommandNames() {
  const files = collectFiles(FRONTEND_SRC_DIR);
  const invoked = new Set();
  const invokeRegex = /invoke\s*(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    let match;

    while ((match = invokeRegex.exec(source)) !== null) {
      invoked.add(match[1]);
    }
  }

  return invoked;
}

function main() {
  const backend = getBackendCommandNames();
  const frontend = getFrontendInvokedCommandNames();

  const missingInBackend = [...frontend]
    .filter((command) => !backend.has(command))
    .sort();

  if (missingInBackend.length > 0) {
    console.error("Found frontend invoke() calls without registered backend commands:");
    for (const command of missingInBackend) {
      console.error(`- ${command}`);
    }
    process.exit(1);
  }

  console.log(
    `Command contract check passed (${frontend.size} frontend invoke calls, ${backend.size} registered backend commands).`
  );
}

main();
