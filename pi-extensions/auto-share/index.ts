/**
 * Auto-Share Extension
 *
 * Automatically exports pi sessions to GitHub gists and keeps them
 * updated as the conversation progresses. Produces stable, shareable
 * URLs that always reflect the latest session state.
 *
 * Requires: gh CLI installed and authenticated (gh auth login)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getShareViewerUrl } from "@mariozechner/pi-coding-agent/dist/config.js";
import { exportFromFile } from "@mariozechner/pi-coding-agent/dist/core/export-html/index.js";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CUSTOM_TYPE = "auto-share";
const COOLDOWN_MS = 10_000;
const MANIFEST_FILENAME = "shares.json";
const GIST_FILENAME = "session.html";

interface ShareData {
	gistId: string;
}

interface ManifestEntry {
	gistId: string;
	viewerUrl: string;
	name?: string;
	sessionFile: string;
	created: string;
	updated: string;
}

type Manifest = Record<string, ManifestEntry>;

// In-memory state
let gistId: string | null = null;
let lastExportTime = 0;
let ghAvailable: boolean | null = null;
let ghWarningShown = false;
let enabled = true;
let exporting = false;

function checkGh(): boolean {
	if (ghAvailable !== null) return ghAvailable;

	try {
		const result = spawnSync("gh", ["auth", "status"], {
			encoding: "utf-8",
			timeout: 5000,
		});
		ghAvailable = result.status === 0;
	} catch {
		ghAvailable = false;
	}

	return ghAvailable;
}


function getSessionDir(ctx: ExtensionContext): string | null {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return null;
	// Session files live directly inside the session dir
	const parts = sessionFile.split("/");
	parts.pop();
	return parts.join("/");
}

function readManifest(manifestPath: string): Manifest {
	try {
		if (existsSync(manifestPath)) {
			return JSON.parse(readFileSync(manifestPath, "utf-8"));
		}
	} catch {
		// Corrupted file, start fresh
	}
	return {};
}

function writeManifest(manifestPath: string, manifest: Manifest): void {
	const dir = manifestPath.split("/").slice(0, -1).join("/");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

function updateManifest(ctx: ExtensionContext, gistId: string, isNew: boolean): void {
	const sessionDir = getSessionDir(ctx);
	if (!sessionDir) return;

	const manifestPath = join(sessionDir, MANIFEST_FILENAME);
	const manifest = readManifest(manifestPath);
	const sessionId = ctx.sessionManager.getSessionId();
	const sessionFile = ctx.sessionManager.getSessionFile();
	const now = new Date().toISOString();

	const existing = manifest[sessionId];
	manifest[sessionId] = {
		gistId,
		viewerUrl: getShareViewerUrl(gistId),
		name: ctx.sessionManager.getSessionName(),
		sessionFile: sessionFile ? sessionFile.split("/").pop()! : "",
		created: isNew ? now : existing?.created ?? now,
		updated: now,
	};

	writeManifest(manifestPath, manifest);
}

function createGist(tmpFile: string): Promise<string | null> {
	return new Promise((resolve) => {
		const proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
		let stdout = "";
		let stderr = "";
		proc.stdout?.on("data", (data) => { stdout += data.toString(); });
		proc.stderr?.on("data", (data) => { stderr += data.toString(); });
		proc.on("close", (code) => {
			if (code !== 0) {
				debugLog(`gist create failed: ${stderr.trim()}`);
				resolve(null);
				return;
			}
			const url = stdout.trim();
			const id = url.split("/").pop();
			resolve(id || null);
		});
		proc.on("error", (err) => {
			debugLog(`gist create error: ${err.message}`);
			resolve(null);
		});
	});
}

function updateGist(gistId: string, tmpFile: string): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("gh", [
			"gist", "edit", gistId,
			"--filename", GIST_FILENAME,
			tmpFile,
		]);
		let stderr = "";
		proc.stderr?.on("data", (data) => { stderr += data.toString(); });
		proc.on("close", (code) => {
			if (code !== 0) {
				debugLog(`gist edit failed: ${stderr.trim()}`);
			}
			resolve(code === 0);
		});
		proc.on("error", (err) => {
			debugLog(`gist edit error: ${err.message}`);
			resolve(false);
		});
	});
}


function debugLog(message: string): void {
	try {
		const timestamp = new Date().toISOString();
		const { appendFileSync } = require("node:fs");
		appendFileSync("/tmp/pi-auto-share-debug.log", `[${timestamp}] ${message}\n`);
	} catch {
		// ignore
	}
}


async function doExport(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	skipCooldown: boolean,
): Promise<void> {
	if (!enabled) return;
	if (exporting) return;
	if (!skipCooldown && Date.now() - lastExportTime < COOLDOWN_MS) return;

	if (!checkGh()) {
		if (!ghWarningShown) {
			ghWarningShown = true;
			try {
				spawnSync("gh", ["--version"], { encoding: "utf-8", timeout: 2000 });
				ctx.ui.notify("auto-share: gh is not logged in. Run 'gh auth login'.", "warning");
			} catch {
				ctx.ui.notify("auto-share: gh CLI not found. Install from https://cli.github.com/", "warning");
			}
		}
		return;
	}

	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile || !existsSync(sessionFile)) return;

	exporting = true;
	// Use a subdirectory so the gist file is named consistently
	const tmpDir = join(tmpdir(), `pi-auto-share-${Date.now()}`);
	mkdirSync(tmpDir, { recursive: true });
	const tmpFile = join(tmpDir, GIST_FILENAME);

	try {
		await exportFromFile(sessionFile, tmpFile);

		if (gistId) {
			const ok = await updateGist(gistId, tmpFile);
			if (ok) {
				updateManifest(ctx, gistId, false);
				lastExportTime = Date.now();
			}
		} else {
			const newGistId = await createGist(tmpFile);
			if (newGistId) {
				gistId = newGistId;
				pi.appendEntry(CUSTOM_TYPE, { gistId } satisfies ShareData);
				updateManifest(ctx, gistId, true);
				lastExportTime = Date.now();
				debugLog(`Created gist ${gistId} for session ${ctx.sessionManager.getSessionId()}`);
			}
		}
	} catch (err) {
		debugLog(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		try { unlinkSync(tmpFile); } catch {}
		try { rmdirSync(tmpDir); } catch {}
		exporting = false;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		gistId = null;
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
				const data = entry.data as ShareData | undefined;
				if (data?.gistId) {
					gistId = data.gistId;
					break;
				}
			}
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		doExport(pi, ctx, false);
	});

	pi.on("session_compact", async (_event, ctx) => {
		doExport(pi, ctx, false);
	});

	pi.on("session_tree", async (_event, ctx) => {
		doExport(pi, ctx, false);
	});

	pi.on("session_before_switch", async (_event, ctx) => {
		// Final export of the outgoing session before switching away
		await doExport(pi, ctx, true);
		gistId = null;
		lastExportTime = 0;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await doExport(pi, ctx, true);
	});

	pi.registerCommand("auto-share", {
		description: "Toggle auto-sharing or show status",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "status", label: "status" },
				{ value: "on", label: "on" },
				{ value: "off", label: "off" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "status") {
				const ghStatus = ghAvailable === null ? "unchecked" : ghAvailable ? "available" : "unavailable";
				const lines = [
					`Auto-share: ${enabled ? "enabled" : "disabled"}`,
					`GitHub CLI: ${ghStatus}`,
				];
				if (gistId) {
					lines.push(`Gist: ${getShareViewerUrl(gistId)}`);
				} else {
					lines.push("Gist: none (will create on next export)");
				}
				if (lastExportTime > 0) {
					const ago = Math.round((Date.now() - lastExportTime) / 1000);
					lines.push(`Last export: ${ago}s ago`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (arg === "on") {
				if (enabled) {
					ctx.ui.notify("Auto-share is already enabled", "info");
					return;
				}
				enabled = true;
				ctx.ui.notify("Auto-share enabled", "info");
				doExport(pi, ctx, true);
				return;
			}

			if (arg === "off") {
				if (!enabled) {
					ctx.ui.notify("Auto-share is already disabled", "info");
					return;
				}
				enabled = false;
				ctx.ui.notify("Auto-share disabled", "info");
				return;
			}

			// No arg or unrecognized: toggle
			enabled = !enabled;
			ctx.ui.notify(`Auto-share ${enabled ? "enabled" : "disabled"}`, "info");
			if (enabled) {
				doExport(pi, ctx, true);
			}
		},
	});
}
