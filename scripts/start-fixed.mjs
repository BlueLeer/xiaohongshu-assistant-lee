#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = "52880";
const url = `http://${host}:${port}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const useDevServer = process.argv.includes("--dev");
const npmScript = useDevServer ? "dev:fixed" : "deploy:local";

function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: projectDir,
    stdio: options.stdio ?? "inherit",
    env: process.env,
    shell: false,
  });
}

function installDependenciesIfNeeded() {
  if (existsSync(resolve(projectDir, "node_modules"))) return;

  console.log("node_modules was not found. Installing dependencies...");
  const result = spawnSync(npmCommand, ["install"], {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function openBrowser() {
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function waitForServer() {
  const startedAt = Date.now();
  const timeoutMs = 30_000;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return true;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  return false;
}

installDependenciesIfNeeded();

console.log("Starting Mint Atelier");
console.log(`Project: ${projectDir}`);
console.log(`Fixed URL: ${url}`);
console.log(`Mode: ${useDevServer ? "development server" : "build and local preview"}`);
console.log("Keep this window open while using the app.");
console.log("Press Ctrl+C to stop the local server.");
console.log("");

const server = run(npmCommand, ["run", npmScript], {
  stdio: ["inherit", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

server.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

let opened = false;
waitForServer().then((ready) => {
  if (!ready || opened || server.exitCode !== null) return;
  opened = true;
  console.log(`Opening ${url}`);
  openBrowser();
});

function stopServer(signal) {
  if (server.exitCode === null) {
    server.kill(signal);
  }
}

process.on("SIGINT", () => stopServer("SIGINT"));
process.on("SIGTERM", () => stopServer("SIGTERM"));

server.on("exit", (code, signal) => {
  if (!opened && !signal && code !== 0) {
    console.log("");
    console.log(`Could not start the fixed server at ${url}.`);
    console.log(`Check whether port ${port} is already in use.`);
  }
  if (signal === "SIGINT") process.exit(130);
  if (signal === "SIGTERM") process.exit(143);
  process.exit(code ?? 0);
});
