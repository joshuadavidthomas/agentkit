/**
 * Agent Settings Widget
 *
 * Provides a /agents command that opens an interactive TUI for browsing
 * and editing subagent configurations. Shows a list of all discovered agents,
 * and a detail view for editing frontmatter settings per agent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
	Container,
	Text,
	Spacer,
	Input,
	Editor,
	type EditorTheme,
	SettingsList,
	type SettingItem,
	getEditorKeybindings,
	matchesKey,
	fuzzyFilter,
	type Component,
	type TUI,
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
	name: string;
}

export interface ToolInfo {
	name: string;
	description?: string;
}

interface AgentSettingsCallbacks {
	onClose: () => void;
	requestRender: () => void;
}

type View = "list" | "detail";

// Known frontmatter keys and their types
// (the order here determines display order in the detail view)
const FRONTMATTER_KEYS = [
	{ key: "name", label: "Name", type: "text" as const, description: "Agent identifier — also renames the file" },
	{ key: "description", label: "Description", type: "text" as const, description: "Shown in the subagent tool description" },
	{ key: "model", label: "Model", type: "model" as const, description: "LLM model to use (e.g., openai/gpt-5.2-codex)" },
	{ key: "tools", label: "Tools", type: "tools" as const, description: "Tools available to this agent" },
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
// Multiline text editor submenu (for editing long text like descriptions)
// ─────────────────────────────────────────────────────────────────────────────

function createEditorSubmenu(
	tui: TUI,
	title: string,
	description: string,
	initialValue: string,
	theme: import("@mariozechner/pi-coding-agent").Theme,
	onSave: (value: string) => void,
	onCancel: () => void,
): Component {
	const container = new Container();

	const editorTheme: EditorTheme = {
		borderColor: (s: string) => theme.fg("border", s),
		selectList: {
			selectedPrefix: (s: string) => theme.fg("accent", s),
			selectedText: (s: string) => theme.fg("accent", s),
			description: (s: string) => theme.fg("muted", s),
			scrollInfo: (s: string) => theme.fg("muted", s),
			noMatch: (s: string) => theme.fg("muted", s),
		},
	};

	const editor = new Editor(tui, editorTheme, { paddingX: 1 });
	editor.setText(initialValue);
	editor.disableSubmit = true;

	container.addChild(new Spacer(1));
	container.addChild(new Text(title, 1, 0));
	if (description) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(description, 1, 0));
	}
	container.addChild(new Spacer(1));
	container.addChild(editor);
	container.addChild(new Spacer(1));
	container.addChild(new Text("ctrl+s to save • esc to cancel", 1, 0));
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
			if (matchesKey(data, "ctrl+s")) {
				const value = editor.getText().trim();
				onSave(value);
			} else if (kb.matches(data, "selectCancel")) {
				onCancel();
			} else {
				editor.handleInput(data);
			}
		},
		get focused() {
			return isFocused;
		},
		set focused(value: boolean) {
			isFocused = value;
			editor.focused = value;
		},
	} as Component;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model picker submenu (lifted from pi's ModelSelectorComponent)
// ─────────────────────────────────────────────────────────────────────────────

function createModelPickerSubmenu(
	currentModel: string,
	availableModels: ModelInfo[],
	theme: import("@mariozechner/pi-coding-agent").Theme,
	onSelect: (model: string) => void,
	onCancel: () => void,
): Component {
	const container = new Container();
	const searchInput = new Input();
	const listContainer = new Container();

	let selectedIndex = 0;
	let isFocused = false;

	// Only match by exact fullId — if the configured model string doesn't
	// correspond to a real model in the registry, nothing gets a checkmark.
	function isCurrentModel(m: ModelInfo): boolean {
		return m.fullId === currentModel;
	}

	const hasCurrentMatch = currentModel !== "" && availableModels.some(isCurrentModel);

	// Sort: current model first, then by provider
	const sortedModels = [...availableModels].sort((a, b) => {
		const aIsCurrent = isCurrentModel(a);
		const bIsCurrent = isCurrentModel(b);
		if (aIsCurrent && !bIsCurrent) return -1;
		if (!aIsCurrent && bIsCurrent) return 1;
		return a.provider.localeCompare(b.provider);
	});

	let filteredModels = [...sortedModels];

	const MAX_VISIBLE = 10;

	// Layout: spacer, search input, warning (if invalid), spacer, list, spacer
	container.addChild(new Spacer(1));
	container.addChild(searchInput);
	if (currentModel && !hasCurrentMatch) {
		container.addChild(new Text(
			theme.fg("warning", `  ⚠ Unknown model: ${currentModel}`),
			0, 0,
		));
	}
	container.addChild(new Spacer(1));
	container.addChild(listContainer);
	container.addChild(new Spacer(1));

	searchInput.onSubmit = () => {
		const selected = filteredModels[selectedIndex];
		if (selected) onSelect(selected.fullId);
	};

	function filterModels(query: string): void {
		filteredModels = query
			? fuzzyFilter(sortedModels, query, (m) => `${m.id} ${m.provider}`)
			: [...sortedModels];
		selectedIndex = Math.min(selectedIndex, Math.max(0, filteredModels.length - 1));
		updateList();
	}

	function updateList(): void {
		listContainer.clear();

		const startIndex = Math.max(0, Math.min(
			selectedIndex - Math.floor(MAX_VISIBLE / 2),
			filteredModels.length - MAX_VISIBLE,
		));
		const endIndex = Math.min(startIndex + MAX_VISIBLE, filteredModels.length);

		for (let i = startIndex; i < endIndex; i++) {
			const model = filteredModels[i]!;
			const isSelected = i === selectedIndex;
			const isCurrent = isCurrentModel(model);

			let line: string;
			if (isSelected) {
				const prefix = theme.fg("accent", "→ ");
				const modelText = theme.fg("accent", model.id);
				const providerBadge = theme.fg("muted", ` [${model.provider}]`);
				const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
				line = `${prefix}${modelText}${providerBadge}${checkmark}`;
			} else {
				const providerBadge = theme.fg("muted", `[${model.provider}]`);
				const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
				line = `  ${model.id} ${providerBadge}${checkmark}`;
			}

			listContainer.addChild(new Text(line, 0, 0));
		}

		// Scroll indicator
		if (startIndex > 0 || endIndex < filteredModels.length) {
			listContainer.addChild(new Text(
				theme.fg("muted", `  (${selectedIndex + 1}/${filteredModels.length})`),
				0, 0,
			));
		}

		// Model name detail or empty state
		if (filteredModels.length === 0) {
			listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		} else {
			const selected = filteredModels[selectedIndex];
			if (selected) {
				listContainer.addChild(new Spacer(1));
				listContainer.addChild(new Text(
					theme.fg("muted", `  Model Name: ${selected.name}`),
					0, 0,
				));
			}
		}
	}

	// Initial render
	updateList();

	return {
		render(width: number) {
			return container.render(width);
		},
		invalidate() {
			container.invalidate();
		},
		handleInput(data: string) {
			const kb = getEditorKeybindings();

			if (kb.matches(data, "selectUp")) {
				if (filteredModels.length > 0) {
					selectedIndex = selectedIndex === 0 ? filteredModels.length - 1 : selectedIndex - 1;
					updateList();
				}
			} else if (kb.matches(data, "selectDown")) {
				if (filteredModels.length > 0) {
					selectedIndex = selectedIndex === filteredModels.length - 1 ? 0 : selectedIndex + 1;
					updateList();
				}
			} else if (kb.matches(data, "selectConfirm")) {
				const selected = filteredModels[selectedIndex];
				if (selected) onSelect(selected.fullId);
			} else if (kb.matches(data, "selectCancel")) {
				onCancel();
			} else {
				// Forward to search input, then re-filter
				searchInput.handleInput(data);
				filterModels(searchInput.getValue());
			}
		},
		get focused() {
			return isFocused;
		},
		set focused(value: boolean) {
			isFocused = value;
			searchInput.focused = value;
		},
	} as Component;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools toggle submenu
// ─────────────────────────────────────────────────────────────────────────────

function createToolsToggleSubmenu(
	currentTools: string[],
	allTools: ToolInfo[],
	theme: import("@mariozechner/pi-coding-agent").Theme,
	onSave: (tools: string[]) => void,
	onCancel: () => void,
): Component {
	const container = new Container();
	const searchInput = new Input();
	const listContainer = new Container();
	const selectedTools = new Set(currentTools);
	let isFocused = false;

	// Sort: selected tools first, then alphabetically
	const sortedTools = [...allTools].sort((a, b) => {
		const aSelected = selectedTools.has(a.name);
		const bSelected = selectedTools.has(b.name);
		if (aSelected && !bSelected) return -1;
		if (!aSelected && bSelected) return 1;
		return a.name.localeCompare(b.name);
	});

	let cursorIndex = 0;
	let filteredTools = [...sortedTools];

	const MAX_VISIBLE = 12;

	// Layout
	container.addChild(new Spacer(1));
	container.addChild(searchInput);
	container.addChild(new Spacer(1));
	container.addChild(listContainer);
	container.addChild(new Spacer(1));

	function filterTools(query: string): void {
		filteredTools = query
			? fuzzyFilter(sortedTools, query, (t) => `${t.name} ${t.description ?? ""}`)
			: [...sortedTools];
		cursorIndex = Math.min(cursorIndex, Math.max(0, filteredTools.length - 1));
		updateList();
	}

	function updateList(): void {
		listContainer.clear();

		if (filteredTools.length === 0) {
			listContainer.addChild(new Text(theme.fg("muted", "  No matching tools"), 0, 0));
			return;
		}

		const startIndex = Math.max(0, Math.min(
			cursorIndex - Math.floor(MAX_VISIBLE / 2),
			filteredTools.length - MAX_VISIBLE,
		));
		const endIndex = Math.min(startIndex + MAX_VISIBLE, filteredTools.length);

		for (let i = startIndex; i < endIndex; i++) {
			const tool = filteredTools[i]!;
			const isCursor = i === cursorIndex;
			const isSelected = selectedTools.has(tool.name);

			const prefix = isCursor ? theme.fg("accent", "→ ") : "  ";
			const checkbox = isSelected ? theme.fg("success", "[x]") : theme.fg("muted", "[ ]");
			const nameText = isCursor ? theme.fg("accent", tool.name) : tool.name;

			listContainer.addChild(new Text(`${prefix}${checkbox} ${nameText}`, 0, 0));
		}

		// Scroll indicator
		if (startIndex > 0 || endIndex < filteredTools.length) {
			listContainer.addChild(new Text(
				theme.fg("muted", `  (${cursorIndex + 1}/${filteredTools.length})`),
				0, 0,
			));
		}

		// Selected count
		listContainer.addChild(new Spacer(1));
		listContainer.addChild(new Text(
			theme.fg("muted", `  ${selectedTools.size} selected · space toggle · enter confirm`),
			0, 0,
		));
	}

	// Initial render
	updateList();

	return {
		render(width: number) {
			return container.render(width);
		},
		invalidate() {
			container.invalidate();
		},
		handleInput(data: string) {
			const kb = getEditorKeybindings();

			if (kb.matches(data, "selectCancel")) {
				onCancel();
				return;
			}

			if (kb.matches(data, "selectConfirm")) {
				onSave([...selectedTools]);
				return;
			}

			if (data === " ") {
				if (filteredTools.length > 0) {
					const tool = filteredTools[cursorIndex];
					if (tool) {
						if (selectedTools.has(tool.name)) {
							selectedTools.delete(tool.name);
						} else {
							selectedTools.add(tool.name);
						}
						updateList();
					}
				}
				return;
			}

			if (kb.matches(data, "selectUp")) {
				if (filteredTools.length > 0) {
					cursorIndex = cursorIndex === 0 ? filteredTools.length - 1 : cursorIndex - 1;
					updateList();
				}
			} else if (kb.matches(data, "selectDown")) {
				if (filteredTools.length > 0) {
					cursorIndex = cursorIndex === filteredTools.length - 1 ? 0 : cursorIndex + 1;
					updateList();
				}
			} else {
				// Forward to search input (except space which is toggle)
				searchInput.handleInput(data);
				filterTools(searchInput.getValue());
			}
		},
		get focused() {
			return isFocused;
		},
		set focused(value: boolean) {
			isFocused = value;
			searchInput.focused = value;
		},
	} as Component;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Agent Settings Component
// ─────────────────────────────────────────────────────────────────────────────

export class AgentSettingsComponent {
	private container: InstanceType<typeof Container>;
	private settingsList!: InstanceType<typeof SettingsList>;
	private tui: TUI;
	private ctx: ExtensionCommandContext;
	private agents: AgentConfig[];
	private availableModels: ModelInfo[];
	private availableTools: ToolInfo[];
	private onClose: () => void;
	private requestRender: () => void;

	// State
	private view: View = "list";
	private selectedAgent: AgentConfig | null = null;
	private agentFrontmatter: Record<string, unknown> = {};
	private agentBody: string = "";

	constructor(
		tui: TUI,
		agents: AgentConfig[],
		availableModels: ModelInfo[],
		availableTools: ToolInfo[],
		ctx: ExtensionCommandContext,
		callbacks: AgentSettingsCallbacks,
	) {
		this.tui = tui;
		this.ctx = ctx;
		this.agents = agents;
		this.availableModels = availableModels;
		this.availableTools = availableTools;
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

			if (def.key === "name") {
				// Name field — also renames the file
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
								if (!value) { done(); return; }
								this.renameAgent(value);
								done(value);
							},
							() => done(),
						);
					},
				});
			} else if (def.type === "model") {
				const modelValue = displayValue || "(default)";
				const modelIsUnknown = displayValue !== "" && !this.availableModels.some((m) => m.fullId === displayValue);
				const warningBadge = modelIsUnknown ? ` ${this.ctx.ui.theme.fg("warning", "⚠")}` : "";
				items.push({
					id: def.key,
					label: def.label,
					description: def.description,
					currentValue: `${modelValue}${warningBadge}`,
					submenu: (_current: string, done: (val?: string) => void) => {
						// Use raw frontmatter value, not the display value
						const rawModel = String(this.agentFrontmatter[def.key] ?? "");
						return createModelPickerSubmenu(
							rawModel,
							this.availableModels,
							this.ctx.ui.theme,
							(model: string) => {
								this.agentFrontmatter[def.key] = model;
								this.saveCurrentAgent();
								done(model);
							},
							() => done(),
						);
					},
				});
			} else if (def.type === "tools") {
				// Tools field — toggle list submenu
				const currentToolsList = this.parseToolsList(rawValue);
				items.push({
					id: def.key,
					label: def.label,
					description: def.description,
					currentValue: currentToolsList.length > 0 ? currentToolsList.join(", ") : "(none)",
					submenu: (_current: string, done: (val?: string) => void) => {
						return createToolsToggleSubmenu(
							this.parseToolsList(this.agentFrontmatter[def.key]),
							this.availableTools,
							this.ctx.ui.theme,
							(tools: string[]) => {
								this.agentFrontmatter[def.key] = tools.join(", ");
								this.saveCurrentAgent();
								const display = tools.length > 0 ? tools.join(", ") : "(none)";
								done(display);
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
			} else if (def.key === "description") {
				// Description field — use multiline editor submenu
				items.push({
					id: def.key,
					label: def.label,
					description: def.description,
					currentValue: displayValue || "(empty)",
					submenu: (_current: string, done: (val?: string) => void) => {
						const prefill = String(this.agentFrontmatter[def.key] ?? "");
						return createEditorSubmenu(
							this.tui,
							def.label,
							def.description,
							prefill,
							this.ctx.ui.theme,
							(value: string) => {
								this.agentFrontmatter[def.key] = value;
								this.saveCurrentAgent();
								done(value || "(empty)");
							},
							() => done(),
						);
					},
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
								this.agentFrontmatter[def.key] = value;
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

	/** Parse a tools value (string or array) into a string array */
	private parseToolsList(value: unknown): string[] {
		if (Array.isArray(value)) {
			return value.map(String).map((s) => s.trim()).filter(Boolean);
		}
		if (typeof value === "string") {
			return value.split(",").map((s) => s.trim()).filter(Boolean);
		}
		return [];
	}

	private handleDetailValueChange(id: string, newValue: string): void {
		// Handle toggle fields
		const def = FRONTMATTER_KEYS.find((d) => d.key === id);
		if (def?.type === "toggle") {
			this.agentFrontmatter[id] = newValue === "true";
			this.saveCurrentAgent();
		}
	}

	/**
	 * Rename an agent: update frontmatter name, rename the file, and update
	 * all in-memory references.
	 */
	private renameAgent(newName: string): void {
		if (!this.selectedAgent) return;

		const oldName = this.selectedAgent.name;
		const oldPath = this.selectedAgent.filePath;
		const dir = path.dirname(oldPath);
		const newPath = path.join(dir, `${newName}.md`);

		// Update frontmatter
		this.agentFrontmatter.name = newName;

		// Save to old path first (in case rename fails)
		try {
			saveAgentFile(oldPath, this.agentFrontmatter, this.agentBody);
		} catch (err) {
			this.ctx.ui.notify(`Failed to save: ${err}`, "error");
			return;
		}

		// Rename the file (skip if paths are the same)
		if (oldPath !== newPath) {
			try {
				if (fs.existsSync(newPath)) {
					this.ctx.ui.notify(`File already exists: ${newPath}`, "error");
					// Revert the frontmatter name
					this.agentFrontmatter.name = oldName;
					saveAgentFile(oldPath, this.agentFrontmatter, this.agentBody);
					return;
				}
				fs.renameSync(oldPath, newPath);
			} catch (err) {
				this.ctx.ui.notify(`Failed to rename file: ${err}`, "error");
				// Revert the frontmatter name
				this.agentFrontmatter.name = oldName;
				saveAgentFile(oldPath, this.agentFrontmatter, this.agentBody);
				return;
			}
		}

		// Update in-memory state
		this.selectedAgent.name = newName;
		this.selectedAgent.filePath = newPath;

		// Update the agent in the agents array
		const agentInList = this.agents.find((a) => a.name === oldName);
		if (agentInList) {
			agentInList.name = newName;
			agentInList.filePath = newPath;
		}

		// Rebuild detail view to reflect the new name
		this.buildDetailView();
		this.requestRender();
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
		// Ctrl+E: open in $EDITOR (only in detail view)
		if (this.view === "detail" && this.selectedAgent && matchesKey(data, "ctrl+e")) {
			this.openInEditor(this.selectedAgent.filePath);
			return;
		}

		this.settingsList.handleInput?.(data);
	}
}
