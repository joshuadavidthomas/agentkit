/**
 * peon-ping — Sound notifications for pi
 *
 * Plays themed audio clips on lifecycle events (session start, task ack,
 * task complete, permission needed). Uses peon-ping / OpenPeon sound packs.
 *
 * Commands:
 *   /peon toggle          — pause/resume sounds
 *   /peon status          — show current state
 *   /peon pack list       — list installed packs
 *   /peon pack use <name> — switch active pack
 *   /peon pack next       — cycle to next pack
 *   /peon volume <0-100>  — set volume (0-100)
 *   /peon preview [cat]   — preview sounds from a category
 *   /peon install         — download default packs from registry
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir, platform as osPlatform } from "node:os";

// Types

interface SoundEntry {
  file: string;
  label?: string;
}

interface PackManifest {
  name: string;
  display_name?: string;
  categories: Record<string, { sounds: SoundEntry[] }>;
}

interface PeonConfig {
  active_pack: string;
  volume: number;
  enabled: boolean;
  categories: Record<string, boolean>;
  annoyed_threshold: number;
  annoyed_window_seconds: number;
}

interface PeonState {
  paused: boolean;
  last_played: Record<string, string>;
  prompt_timestamps: number[];
  last_stop_time: number;
  session_start_time: number;
}

// Paths

const DATA_DIR = join(homedir(), ".config", "peon-ping");
const PACKS_DIR = join(DATA_DIR, "packs");
const CONFIG_PATH = join(DATA_DIR, "config.json");
const STATE_PATH = join(DATA_DIR, "state.json");

// Also check legacy peon-ping location
const LEGACY_PACKS = join(homedir(), ".claude", "hooks", "peon-ping", "packs");

// Defaults

const DEFAULT_CONFIG: PeonConfig = {
  active_pack: "peon",
  volume: 0.5,
  enabled: true,
  categories: {
    "session.start": true,
    "task.acknowledge": true,
    "task.complete": true,
    "task.error": true,
    "input.required": true,
    "resource.limit": true,
    "user.spam": true,
  },
  annoyed_threshold: 3,
  annoyed_window_seconds: 10,
};

const DEFAULT_STATE: PeonState = {
  paused: false,
  last_played: {},
  prompt_timestamps: [],
  last_stop_time: 0,
  session_start_time: 0,
};

// Registry

const REGISTRY_URL = "https://peonping.github.io/registry/index.json";
const DEFAULT_PACK_NAMES = [
  "peon",
  "peasant",
  "glados",
  "sc_kerrigan",
  "sc_battlecruiser",
  "ra2_kirov",
  "dota2_axe",
  "duke_nukem",
  "tf2_engineer",
  "hd2_helldiver",
];
const FALLBACK_REPO = "PeonPing/og-packs";
const FALLBACK_REF = "v1.1.0";

// Platform detection

type Platform = "mac" | "linux" | "wsl" | "unknown";

function detectPlatform(): Platform {
  const p = osPlatform();
  if (p === "darwin") return "mac";
  if (p === "linux") {
    try {
      const version = readFileSync("/proc/version", "utf8");
      if (/microsoft/i.test(version)) return "wsl";
    } catch {}
    return "linux";
  }
  return "unknown";
}

let cachedLinuxPlayer: string | null | undefined;

function detectLinuxPlayer(): string | null {
  if (cachedLinuxPlayer !== undefined) return cachedLinuxPlayer;
  for (const cmd of ["pw-play", "paplay", "ffplay", "mpv", "play", "aplay"]) {
    try {
      execSync(`command -v ${cmd}`, { stdio: "pipe" });
      cachedLinuxPlayer = cmd;
      return cmd;
    } catch {}
  }
  cachedLinuxPlayer = null;
  return null;
}

const PLATFORM = detectPlatform();

// Config & State

function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(PACKS_DIR, { recursive: true });
}

function loadConfig(): PeonConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULT_CONFIG, ...raw, categories: { ...DEFAULT_CONFIG.categories, ...raw.categories } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: PeonConfig): void {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function loadState(): PeonState {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return { ...DEFAULT_STATE, ...raw };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state: PeonState): void {
  ensureDirs();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// Packs

function getPacksDir(): string {
  if (existsSync(PACKS_DIR) && readdirSync(PACKS_DIR).length > 0) return PACKS_DIR;
  if (existsSync(LEGACY_PACKS) && readdirSync(LEGACY_PACKS).length > 0) return LEGACY_PACKS;
  return PACKS_DIR;
}

function listPacks(): { name: string; displayName: string; path: string }[] {
  const packsDir = getPacksDir();
  if (!existsSync(packsDir)) return [];

  const packs: { name: string; displayName: string; path: string }[] = [];
  for (const dir of readdirSync(packsDir)) {
    const packPath = join(packsDir, dir);
    const manifest = loadManifest(packPath);
    if (manifest) {
      packs.push({
        name: manifest.name || dir,
        displayName: manifest.display_name || manifest.name || dir,
        path: packPath,
      });
    }
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

function loadManifest(packPath: string): PackManifest | null {
  for (const name of ["openpeon.json", "manifest.json"]) {
    const p = join(packPath, name);
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8"));
      } catch {}
    }
  }
  return null;
}

// Sound selection

function pickSound(
  category: string,
  config: PeonConfig,
  state: PeonState
): { file: string; label: string } | null {
  if (!config.categories[category]) return null;

  const packsDir = getPacksDir();
  const packPath = join(packsDir, config.active_pack);
  const manifest = loadManifest(packPath);
  if (!manifest) return null;

  const catData = manifest.categories[category];
  if (!catData?.sounds?.length) return null;

  const sounds = catData.sounds;
  const lastFile = state.last_played[category];

  let candidates = sounds.length > 1 ? sounds.filter((s) => s.file !== lastFile) : sounds;
  if (candidates.length === 0) candidates = sounds;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  const file = pick.file.includes("/")
    ? join(packPath, pick.file)
    : join(packPath, "sounds", pick.file);

  if (!existsSync(file)) return null;

  state.last_played[category] = pick.file;
  return { file, label: pick.label || basename(pick.file) };
}

// Audio playback

let currentSoundPid: number | null = null;

function killPreviousSound(): void {
  if (currentSoundPid !== null) {
    try {
      process.kill(currentSoundPid);
    } catch {}
    currentSoundPid = null;
  }
}

function playSound(file: string, volume: number): void {
  killPreviousSound();

  let child;

  switch (PLATFORM) {
    case "mac":
      child = spawn("afplay", ["-v", String(volume), file], {
        stdio: "ignore",
        detached: true,
      });
      break;

    case "wsl": {
      const cmd = `
        Add-Type -AssemblyName PresentationCore
        $p = New-Object System.Windows.Media.MediaPlayer
        $p.Open([Uri]::new('file:///${file.replace(/\//g, "\\")}'))
        $p.Volume = ${volume}
        Start-Sleep -Milliseconds 200
        $p.Play()
        Start-Sleep -Seconds 3
        $p.Close()
      `;
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
        stdio: "ignore",
        detached: true,
      });
      break;
    }

    case "linux": {
      const player = detectLinuxPlayer();
      if (!player) return;

      switch (player) {
        case "pw-play":
          child = spawn("pw-play", ["--volume", String(volume), file], {
            stdio: "ignore",
            detached: true,
          });
          break;
        case "paplay": {
          const paVol = Math.max(0, Math.min(65536, Math.round(volume * 65536)));
          child = spawn("paplay", [`--volume=${paVol}`, file], {
            stdio: "ignore",
            detached: true,
          });
          break;
        }
        case "ffplay": {
          const ffVol = Math.max(0, Math.min(100, Math.round(volume * 100)));
          child = spawn("ffplay", ["-nodisp", "-autoexit", "-volume", String(ffVol), file], {
            stdio: "ignore",
            detached: true,
          });
          break;
        }
        case "mpv": {
          const mpvVol = Math.max(0, Math.min(100, Math.round(volume * 100)));
          child = spawn("mpv", ["--no-video", `--volume=${mpvVol}`, file], {
            stdio: "ignore",
            detached: true,
          });
          break;
        }
        case "play":
          child = spawn("play", ["-v", String(volume), file], {
            stdio: "ignore",
            detached: true,
          });
          break;
        case "aplay":
          child = spawn("aplay", ["-q", file], {
            stdio: "ignore",
            detached: true,
          });
          break;
      }
      break;
    }
  }

  if (child) {
    child.unref();
    currentSoundPid = child.pid ?? null;
    child.on("exit", () => {
      if (currentSoundPid === child.pid) currentSoundPid = null;
    });
  }
}

// Desktop notification via OSC 777

function sendNotification(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

// Core: play a category sound

function playCategorySound(category: string, config: PeonConfig, state: PeonState): void {
  if (!config.enabled || state.paused) return;

  const sound = pickSound(category, config, state);
  if (sound) {
    playSound(sound.file, config.volume);
    saveState(state);
  }
}

// Async pack installation (non-blocking)

interface RegistryPack {
  name: string;
  source_repo?: string;
  source_ref?: string;
  source_path?: string;
}

interface Registry {
  packs: RegistryPack[];
}

async function fetchRegistry(): Promise<Registry | null> {
  try {
    const resp = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    return (await resp.json()) as Registry;
  } catch {
    return null;
  }
}

async function downloadFile(url: string, destPath: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return false;
    const buf = Buffer.from(await resp.arrayBuffer());
    await writeFile(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

async function downloadPack(
  packName: string,
  registry: Registry | null,
  onProgress?: (msg: string) => void
): Promise<boolean> {
  const packDir = join(PACKS_DIR, packName);
  const soundsDir = join(packDir, "sounds");
  await mkdir(soundsDir, { recursive: true });

  let sourceRepo = FALLBACK_REPO;
  let sourceRef = FALLBACK_REF;
  let sourcePath = packName;

  if (registry) {
    const entry = registry.packs.find((p) => p.name === packName);
    if (entry) {
      sourceRepo = entry.source_repo || FALLBACK_REPO;
      sourceRef = entry.source_ref || FALLBACK_REF;
      sourcePath = entry.source_path || packName;
    }
  }

  const baseUrl = `https://raw.githubusercontent.com/${sourceRepo}/${sourceRef}/${sourcePath}`;

  onProgress?.(`${packName}: manifest...`);
  const manifestPath = join(packDir, "openpeon.json");
  if (!(await downloadFile(`${baseUrl}/openpeon.json`, manifestPath))) {
    onProgress?.(`${packName}: ✗ manifest failed`);
    return false;
  }

  let manifestData: PackManifest;
  try {
    manifestData = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    onProgress?.(`${packName}: ✗ bad manifest`);
    return false;
  }

  const seenFiles = new Set<string>();
  for (const cat of Object.values(manifestData.categories)) {
    for (const sound of cat.sounds) {
      seenFiles.add(basename(sound.file));
    }
  }

  const filenames = Array.from(seenFiles);
  let downloaded = 0;

  // Download in batches of 5 to avoid hammering
  for (let i = 0; i < filenames.length; i += 5) {
    const batch = filenames.slice(i, i + 5);
    const results = await Promise.all(
      batch.map((f) => downloadFile(`${baseUrl}/sounds/${f}`, join(soundsDir, f)))
    );
    downloaded += results.filter(Boolean).length;
  }

  onProgress?.(`${packName}: ${downloaded}/${filenames.length} sounds`);
  return downloaded > 0;
}

// Extension

export default function (pi: ExtensionAPI) {
  ensureDirs();
  let config = loadConfig();
  let state = loadState();
  let installing = false;

  const hasPacks = () => listPacks().length > 0;

  // Guard: only play sounds in interactive sessions, not subagents
  const shouldPlaySounds = (ctx: { hasUI: boolean }) =>
    ctx.hasUI && !installing && hasPacks();

  // Session start → session.start
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    if (!hasPacks()) {
      ctx.ui.notify(
        "peon-ping: no sound packs. Run /peon install",
        "warning"
      );
      return;
    }

    config = loadConfig();
    state = loadState();
    state.session_start_time = Date.now();
    state.prompt_timestamps = [];
    saveState(state);

    playCategorySound("session.start", config, state);
  });

  // Agent start → task.acknowledge + spam detection
  pi.on("agent_start", async (_event, ctx) => {
    if (!shouldPlaySounds(ctx)) return;

    config = loadConfig();
    state = loadState();

    const now = Date.now();
    const window = config.annoyed_window_seconds * 1000;
    state.prompt_timestamps = state.prompt_timestamps.filter((t) => now - t < window);
    state.prompt_timestamps.push(now);
    saveState(state);

    if (state.prompt_timestamps.length >= config.annoyed_threshold) {
      playCategorySound("user.spam", config, state);
    } else {
      playCategorySound("task.acknowledge", config, state);
    }
  });

  // Agent end → task.complete + notification
  pi.on("agent_end", async (_event, ctx) => {
    if (!shouldPlaySounds(ctx)) return;

    config = loadConfig();
    state = loadState();

    const now = Date.now();
    if (now - state.last_stop_time < 5000) return;
    state.last_stop_time = now;

    if (now - state.session_start_time < 3000) return;

    saveState(state);
    playCategorySound("task.complete", config, state);

    if (config.enabled && !state.paused) {
      const project = basename(ctx.cwd);
      sendNotification(`pi · ${project}`, "Task complete");
    }
  });

  // /peon command
  pi.registerCommand("peon", {
    description: "Sound controls: toggle, status, pack, volume, preview, install",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/);
      const sub = parts[0] || "status";

      switch (sub) {
        case "toggle": {
          state = loadState();
          state.paused = !state.paused;
          saveState(state);
          ctx.ui.notify(
            `peon-ping: sounds ${state.paused ? "paused ⏸" : "resumed ▶"}`,
            "info"
          );
          break;
        }

        case "status": {
          config = loadConfig();
          state = loadState();
          const packs = listPacks();
          const activePack = packs.find((p) => p.name === config.active_pack);
          const lines = [
            `Sounds: ${state.paused ? "paused ⏸" : "active ▶"}`,
            `Pack: ${activePack?.displayName || config.active_pack} (${packs.length} installed)`,
            `Volume: ${Math.round(config.volume * 100)}%`,
            `Platform: ${PLATFORM}`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          break;
        }

        case "pack": {
          const packSub = parts[1] || "list";

          if (packSub === "list") {
            config = loadConfig();
            const packs = listPacks();
            if (packs.length === 0) {
              ctx.ui.notify("No packs installed. Run /peon install", "warning");
              break;
            }
            const lines = packs.map(
              (p) => `${p.name === config.active_pack ? "▶ " : "  "}${p.name} — ${p.displayName}`
            );
            ctx.ui.notify(lines.join("\n"), "info");
          } else if (packSub === "use") {
            const packName = parts[2];
            if (!packName) {
              ctx.ui.notify("Usage: /peon pack use <name>", "warning");
              break;
            }
            const packs = listPacks();
            const pack = packs.find((p) => p.name === packName);
            if (!pack) {
              ctx.ui.notify(`Pack "${packName}" not found`, "error");
              break;
            }
            config = loadConfig();
            config.active_pack = packName;
            saveConfig(config);
            ctx.ui.notify(`Switched to ${pack.displayName}`, "info");
          } else if (packSub === "next") {
            config = loadConfig();
            const packs = listPacks();
            if (packs.length === 0) {
              ctx.ui.notify("No packs installed", "warning");
              break;
            }
            const idx = packs.findIndex((p) => p.name === config.active_pack);
            const next = packs[(idx + 1) % packs.length];
            config.active_pack = next.name;
            saveConfig(config);
            ctx.ui.notify(`Switched to ${next.displayName}`, "info");
          } else {
            ctx.ui.notify("Usage: /peon pack <list|use|next>", "warning");
          }
          break;
        }

        case "volume": {
          const val = parseInt(parts[1], 10);
          if (isNaN(val) || val < 0 || val > 100) {
            config = loadConfig();
            ctx.ui.notify(`Volume: ${Math.round(config.volume * 100)}%. Usage: /peon volume <0-100>`, "info");
            break;
          }
          config = loadConfig();
          config.volume = val / 100;
          saveConfig(config);
          ctx.ui.notify(`Volume set to ${val}%`, "info");
          break;
        }

        case "preview": {
          const category = parts[1] || "session.start";
          config = loadConfig();
          state = loadState();
          const sound = pickSound(category, config, state);
          if (sound) {
            playSound(sound.file, config.volume);
            saveState(state);
            ctx.ui.notify(`▶ ${sound.label} [${category}]`, "info");
          } else {
            ctx.ui.notify(`No sounds for category "${category}"`, "warning");
          }
          break;
        }

        case "install": {
          const packsToInstall = parts.slice(1);

          installing = true;
          ctx.ui.setWorkingMessage("Fetching pack registry...");

          try {
            const registry = await fetchRegistry();
            const names = packsToInstall.length > 0 ? packsToInstall : DEFAULT_PACK_NAMES;

            let installed = 0;
            for (let i = 0; i < names.length; i++) {
              const name = names[i];
              ctx.ui.setWorkingMessage(`Downloading pack ${i + 1}/${names.length}: ${name}...`);
              const ok = await downloadPack(name, registry, (msg) =>
                ctx.ui.setWorkingMessage(`[${i + 1}/${names.length}] ${msg}`)
              );
              if (ok) installed++;
            }

            if (installed > 0) {
              config = loadConfig();
              if (!listPacks().find((p) => p.name === config.active_pack)) {
                config.active_pack = names[0];
                saveConfig(config);
              }
            }

            ctx.ui.notify(
              `peon-ping: installed ${installed}/${names.length} packs`,
              installed > 0 ? "info" : "error"
            );
          } finally {
            installing = false;
            ctx.ui.setWorkingMessage();
          }
          break;
        }

        default:
          ctx.ui.notify(
            [
              "Usage: /peon <command>",
              "",
              "  toggle          — pause/resume sounds",
              "  status          — show current state",
              "  pack list       — list installed packs",
              "  pack use <name> — switch active pack",
              "  pack next       — cycle to next pack",
              "  volume <0-100>  — set volume",
              "  preview [cat]   — preview a sound category",
              "  install [packs] — download packs from registry",
            ].join("\n"),
            "info"
          );
      }
    },
  });
}
