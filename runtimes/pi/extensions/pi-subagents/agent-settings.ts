/**
 * Agent Settings Widget
 *
 * Provides a /agents command that opens an interactive TUI for browsing
 * and editing subagent configurations. Shows a list of all discovered agents,
 * and a detail view for editing frontmatter settings per agent.
 */

import * as fs from "node:fs";
import { execSync } from "node:child_process";
import {
	Container,
	Text,
	Spacer,
	Input,
	SettingsList,
	type SettingItem,
	getEditorKeybindings,
	matchesKey,
	fuzzyFilter,
	type Component,
} from "@mariozechner/pi-tui";
import {
	getSettingsListTheme,
	DynamicBorder,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "./agents.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelInfo {
	provider: string;
	id: string;
	fullId: string;
}

interface AgentSettingsCallbacks {
	onClose: () => void;
	requestRender: () => void;
}

type View = "list" | "detail";

// Known frontmatter keys and their types
// (the order here determines display order in the detail view)
const FRONTMATTER_KEYS = [
	{ key: "name", label: "Name", type: "text" as const, description: "Agent identifier (used when calling the agent)" },
	{ key: "description", label: "Description", type: "text" as const, description: "Shown in the subagent tool description" },
	{ key: "model", label: "Model", type: "model" as const, description: "LLM model to use (e.g., openai/gpt-5.2-codex)" },
	{ key: "tools", label: "Tools", type: "text" as const, description: "Comma-separated list of tools (read, grep, glob, ls, etc.)" },
	{ key: "skills", label: "Skills", type: "text" as const, description: "Comma-separated skill names to inject" },
	{ key: "output", label: "Output", type: "text" as const, description: "Default output filename for chain writes" },
	{ key: "defaultReads", label: "Default Reads", type: "text" as const, description: "Default files to read in chains (comma-separated)" },
	{ key: "defaultProgress", label: "Default Progress", type: "toggle" as const, description: "Enable progress.md tracking in chains" },
	{ key: "interactive", label: "Interactive", type: "toggle" as const, description: "Enable interactive mode" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read an agent file and parse it into frontmatter + body.
 */
function parseAgentFile(filePath: string): { frontmatter: Record<string, unknown>; body: string; raw: string } {
	const raw = fs.readFileSync(filePath, "utf-8");
	const normalized = raw.replace(/\r\n/g, "\n");

	if (!normalized.startsWith("---")) {
		return { frontmatter: {}, body: normalized, raw };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter: {}, body: normalized, raw };
	}

	const frontmatterBlock = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4);

	let frontmatter: Record<string, unknown> = {};
	try {
		const parsed = parseYaml(frontmatterBlock);
		if (parsed && typeof parsed === "object") {
			frontmatter = parsed as Record<string, unknown>;
		}
	} catch {}

	return { frontmatter, body, raw };
}

/**
 * Serialize frontmatter + body back to a markdown file.
 * Preserves the body content exactly as it was.
 */
function serializeAgentFile(frontmatter: Record<string, unknown>, body: string): string {
	// Clean up undefined/empty values
	const clean: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value !== undefined && value !== null && value !== "") {
			clean[key] = value;
		}
	}

	const yamlStr = stringifyYaml(clean, { lineWidth: 0 }).trimEnd();
	// body already starts with a newline (or is empty) from the original parse
	return `---\n${yamlStr}\n---${body}`;
}

/**
 * Save updated frontmatter back to the agent file.
 */
function saveAgentFile(filePath: string, frontmatter: Record<string, unknown>, body: string): void {
	const content = serializeAgentFile(frontmatter, body);
	fs.writeFileSync(filePath, content, "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Text input submenu (for editing string values)
// ─────────────────────────────────────────────────────────────────────────────

function createTextInputSubmenu(
	title: string,
	description: string,
	initialValue: string,
	onSave: (value: string) => void,
	onCancel: () => void,
): Component {
	const container = new Container();
	const input = new Input();
	input.setValue(initialValue);

	container.addChild(new Spacer(1));
	container.addChild(new Text(title, 1, 0));
	if (description) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(description, 1, 0));
	}
	container.addChild(new Spacer(1));
	container.addChild(input);
	container.addChild(new Spacer(1));
	container.addChild(new Text("enter to save • esc to cancel", 1, 0));
	container.addChild(new Spacer(1));

	let isFocused = false;

	return {
		render(width: number) {
			return container.render(width);
		},
		invalidate() {
			container.invalidate();
		},
		handleInput(data: string) {
			const kb = getEditorKeybindings();
			if (kb.matches(data, "selectConfirm") || data === "\n") {
				const value = input.getValue().trim();
				onSave(value);
			} else if (kb.matches(data, "selectCancel")) {
				onCancel();
			} else {
				input.handleInput(data);
			}
		},
		get focused() {
			return isFocused;
		},
		set focused(value: boolean) {
			isFocused = value;
			input.focused = value;
		},
	} as Component;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model picker submenu
// ─────────────────────────────────────────────────────────────────────────────

function createModelPickerSubmenu(
	currentModel: string,
	availableModels: ModelInfo[],
	onSelect: (model: string) => void,
	onCancel: () => void,
): Component {
	let searchQuery = "";
	let selectedIndex = 0;
	let filteredModels = [...availableModels];
	let isFocused = false;

	// Pre-select current model
	const currentIdx = filteredModels.findIndex(
		(m) => m.fullId === currentModel || m.id === currentModel,
	);
	if (currentIdx >= 0) selectedIndex = currentIdx;

	const MAX_VISIBLE = 10;

	function filterModels(): void {
		if (!searchQuery) {
			filteredModels = [...availableModels];
		} else {
			filteredModels = fuzzyFilter(
				availableModels,
				searchQuery,
				(m) => `${m.id} ${m.provider}`,
			);
		}
		selectedIndex = Math.min(selectedIndex, Math.max(0, filteredModels.length - 1));
	}

	return {
		render(width: number) {
			const lines: string[] = [];
			const innerW = Math.max(width - 4, 20);

			lines.push("");
			lines.push(` Model Selector`);
			lines.push(` Current: ${currentModel || "(default)"}`);
			lines.push("");
			const cursor = "\x1b[7m \x1b[27m";
			lines.push(` Search: ${searchQuery}${cursor}`);
			lines.push("");

			if (filteredModels.length === 0) {
				lines.push("  No matching models");
			} else {
				let startIdx = 0;
				if (filteredModels.length > MAX_VISIBLE) {
					startIdx = Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE / 2));
					startIdx = Math.min(startIdx, filteredModels.length - MAX_VISIBLE);
				}
				const endIdx = Math.min(startIdx + MAX_VISIBLE, filteredModels.length);

				if (startIdx > 0) {
					lines.push(`    ↑ ${startIdx} more`);
				}

				for (let i = startIdx; i < endIdx; i++) {
					const model = filteredModels[i]!;
					const isSelected = i === selectedIndex;
					const isCurrent = model.fullId === currentModel || model.id === currentModel;

					const prefix = isSelected ? "→ " : "  ";
					const badge = ` [${model.provider}]`;
					const check = isCurrent ? " ✓" : "";

					lines.push(` ${prefix}${model.id}${badge}${check}`);
				}

				const remaining = filteredModels.length - endIdx;
				if (remaining > 0) {
					lines.push(`    ↓ ${remaining} more`);
				}
			}

			lines.push("");
			lines.push(` (${filteredModels.length}/${availableModels.length}) enter select • esc cancel • type to filter`);
			lines.push("");

			return lines;
		},
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
				onCancel();
				return;
			}

			if (matchesKey(data, "return")) {
				const selected = filteredModels[selectedIndex];
				if (selected) {
					onSelect(selected.fullId);
				} else {
					onCancel();
				}
				return;
			}

			if (matchesKey(data, "up")) {
				if (filteredModels.length > 0) {
					selectedIndex = selectedIndex === 0 ? filteredModels.length - 1 : selectedIndex - 1;
				}
				return;
			}

			if (matchesKey(data, "down")) {
				if (filteredModels.length > 0) {
					selectedIndex = selectedIndex === filteredModels.length - 1 ? 0 : selectedIndex + 1;
				}
				return;
			}

			if (matchesKey(data, "backspace")) {
				if (searchQuery.length > 0) {
					searchQuery = searchQuery.slice(0, -1);
					filterModels();
				}
				return;
			}

			// Printable character
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				searchQuery += data;
				filterModels();
				return;
			}
		},
		get focused() {
			return isFocused;
		},
		set focused(value: boolean) {
			isFocused = value;
		},
	} as Component;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Agent Settings Component
// ─────────────────────────────────────────────────────────────────────────────

export class AgentSettingsComponent {
	private container: InstanceType<typeof Container>;
	private settingsList!: InstanceType<typeof SettingsList>;
	private ctx: ExtensionCommandContext;
	private agents: AgentConfig[];
	private availableModels: ModelInfo[];
	private onClose: () => void;
	private requestRender: () => void;

	// State
	private view: View = "list";
	private selectedAgent: AgentConfig | null = null;
	private agentFrontmatter: Record<string, unknown> = {};
	private agentBody: string = "";

	constructor(
		agents: AgentConfig[],
		availableModels: ModelInfo[],
		ctx: ExtensionCommandContext,
		callbacks: AgentSettingsCallbacks,
	) {
		this.ctx = ctx;
		this.agents = agents;
		this.availableModels = availableModels;
		this.onClose = callbacks.onClose;
		this.requestRender = callbacks.requestRender;

		this.container = new Container();
		this.buildListView();
	}

	// ─── List View ───────────────────────────────────────────────────────────

	private buildListView(): void {
		this.view = "list";
		this.selectedAgent = null;
		this.container = new Container();
		this.container.addChild(new DynamicBorder((s: string) => s));

		const items: SettingItem[] = this.agents.map((agent) => {
			const sourceTag = agent.source === "project" ? "[project]" : "[user]";
			return {
				id: agent.name,
				label: agent.name,
				description: `${sourceTag} ${agent.filePath}\n${agent.description}`,
				currentValue: agent.model || "default",
				submenu: (_current: string, done: (val?: string) => void) => {
					// Schedule the detail view switch on next tick so the SettingsList
					// submenu lifecycle completes cleanly before we swap views.
					queueMicrotask(() => {
						this.openDetailView(agent);
					});
					done();
					return { render: () => [], invalidate: () => {}, handleInput: () => {} } as unknown as Component;
				},
			};
		});

		if (items.length === 0) {
			items.push({
				id: "_empty",
				label: "No agents found",
				description: "Place .md files in ~/.pi/agent/agents/ or .pi/agents/",
				currentValue: "",
			});
		}

		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 15),
			getSettingsListTheme(),
			() => {},
			() => {
				this.onClose();
			},
			{ enableSearch: true },
		);

		this.container.addChild(this.settingsList);
		this.container.addChild(new DynamicBorder((s: string) => s));
	}

	// ─── Detail View ─────────────────────────────────────────────────────────

	private openDetailView(agent: AgentConfig): void {
		this.view = "detail";
		this.selectedAgent = agent;

		// Parse the actual file to get raw frontmatter
		const parsed = parseAgentFile(agent.filePath);
		this.agentFrontmatter = { ...parsed.frontmatter };
		this.agentBody = parsed.body;

		this.buildDetailView();
		this.requestRender();
	}

	private buildDetailView(): void {
		if (!this.selectedAgent) return;

		this.container = new Container();
		this.container.addChild(new DynamicBorder((s: string) => s));

		const agent = this.selectedAgent;
		const fm = this.agentFrontmatter;
		const items: SettingItem[] = [];

		for (const def of FRONTMATTER_KEYS) {
			const rawValue = fm[def.key];
			let displayValue: string;

			if (def.type === "toggle") {
				displayValue = rawValue === true || rawValue === "true" ? "true" : "false";
			} else if (Array.isArray(rawValue)) {
				displayValue = rawValue.join(", ");
			} else if (rawValue !== undefined && rawValue !== null) {
				displayValue = String(rawValue);
			} else {
				displayValue = "";
			}

			if (def.type === "model") {
				items.push({
					id: def.key,
					label: def.label,
					description: def.description,
					currentValue: displayValue || "(default)",
					submenu: (current: string, done: (val?: string) => void) => {
						return createModelPickerSubmenu(
							current === "(default)" ? "" : current,
							this.availableModels,
							(model: string) => {
								this.agentFrontmatter[def.key] = model;
								this.saveCurrentAgent();
								done(model);
							},
							() => done(),
						);
					},
				});
			} else if (def.type === "toggle") {
				items.push({
					id: def.key,
					label: def.label,
					description: def.description,
					currentValue: displayValue,
					values: ["true", "false"],
				});
			} else {
				// Text field — use submenu for editing
				items.push({
					id: def.key,
					label: def.label,
					description: def.description,
					currentValue: displayValue || "(empty)",
					submenu: (current: string, done: (val?: string) => void) => {
						return createTextInputSubmenu(
							def.label,
							def.description,
							current === "(empty)" ? "" : current,
							(value: string) => {
								// For array-like fields, store as comma-separated string
								if (def.key === "tools" || def.key === "skills" || def.key === "defaultReads") {
									this.agentFrontmatter[def.key] = value;
								} else {
									this.agentFrontmatter[def.key] = value;
								}
								this.saveCurrentAgent();
								done(value || "(empty)");
							},
							() => done(),
						);
					},
				});
			}
		}

		// Also show any unknown/extra frontmatter keys at the bottom
		const knownKeys = new Set<string>(FRONTMATTER_KEYS.map((d) => d.key));
		for (const [key, value] of Object.entries(fm)) {
			if (knownKeys.has(key)) continue;

			const displayValue = typeof value === "object"
				? JSON.stringify(value)
				: String(value ?? "");

			items.push({
				id: `_extra_${key}`,
				label: key,
				description: `Custom frontmatter key`,
				currentValue: displayValue || "(empty)",
				submenu: (current: string, done: (val?: string) => void) => {
					return createTextInputSubmenu(
						key,
						`Edit custom frontmatter key: ${key}`,
						current === "(empty)" ? "" : current,
						(newValue: string) => {
							// Try to preserve the original type
							if (value === true || value === false) {
								this.agentFrontmatter[key] = newValue === "true";
							} else if (typeof value === "number") {
								const num = Number(newValue);
								this.agentFrontmatter[key] = Number.isNaN(num) ? newValue : num;
							} else {
								this.agentFrontmatter[key] = newValue;
							}
							this.saveCurrentAgent();
							done(newValue || "(empty)");
						},
						() => done(),
					);
				},
			});
		}

		// Add "Open in $EDITOR" action at the bottom
		items.push({
			id: "_open_editor",
			label: "Open in $EDITOR",
			description: `Open ${agent.filePath} in your editor (${process.env.EDITOR || "vi"})`,
			currentValue: "→",
			submenu: (_current: string, done: (val?: string) => void) => {
				queueMicrotask(() => {
					this.openInEditor(agent.filePath);
				});
				done();
				return { render: () => [], invalidate: () => {}, handleInput: () => {} } as unknown as Component;
			},
		});

		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 18),
			getSettingsListTheme(),
			(id: string, newValue: string) => {
				this.handleDetailValueChange(id, newValue);
			},
			() => {
				// Esc on detail → back to list
				this.buildListView();
				this.requestRender();
			},
			{ enableSearch: true },
		);

		this.container.addChild(this.settingsList);
		this.container.addChild(new DynamicBorder((s: string) => s));
	}

	private handleDetailValueChange(id: string, newValue: string): void {
		// Handle toggle fields
		const def = FRONTMATTER_KEYS.find((d) => d.key === id);
		if (def?.type === "toggle") {
			this.agentFrontmatter[id] = newValue === "true";
			this.saveCurrentAgent();
		}
	}

	private saveCurrentAgent(): void {
		if (!this.selectedAgent) return;
		try {
			saveAgentFile(this.selectedAgent.filePath, this.agentFrontmatter, this.agentBody);

			// Update the in-memory agent config too so the list reflects changes
			const agent = this.agents.find((a) => a.name === this.selectedAgent!.name);
			if (agent) {
				const fm = this.agentFrontmatter;
				if (typeof fm.name === "string") agent.name = fm.name;
				if (typeof fm.description === "string") agent.description = fm.description;
				if (typeof fm.model === "string") agent.model = fm.model;
			}
		} catch (err) {
			this.ctx.ui.notify(`Failed to save: ${err}`, "error");
		}
	}

	private openInEditor(filePath: string): void {
		const editor = process.env.EDITOR || process.env.VISUAL || "vi";
		try {
			execSync(`${editor} "${filePath}"`, {
				stdio: "inherit",
				env: { ...process.env },
			});
			// After editor closes, reload the file in case it was modified
			if (this.selectedAgent && this.selectedAgent.filePath === filePath) {
				const parsed = parseAgentFile(filePath);
				this.agentFrontmatter = { ...parsed.frontmatter };
				this.agentBody = parsed.body;
				this.buildDetailView();
			}
			this.requestRender();
		} catch (err) {
			this.ctx.ui.notify(`Failed to open editor: ${err}`, "error");
		}
	}

	// ─── Component interface ─────────────────────────────────────────────────

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate();
	}

	handleInput(data: string): void {
		this.settingsList.handleInput?.(data);
	}
}
