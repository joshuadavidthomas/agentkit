// Q&A UI components — QnAComponent for interactive questioning, and shared
// renderQAPairs for confirmation screen and tool result rendering.

import type { ExtractedQuestion } from "./extract.ts";
import {
  type Component,
  Container,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  type SelectListTheme,
  Spacer,
  Text,
  type TUI,
  visibleWidth,
} from "@mariozechner/pi-tui";

// Bordered box — wraps child components with box-drawing borders

class BorderedBox implements Component {
  private children: Component[] = [];
  private maxWidth: number;
  private padding: number;
  private styleBorder: (s: string) => string;

  constructor(maxWidth: number = 120, padding: number = 2, styleBorder: (s: string) => string = (s) => s) {
    this.maxWidth = maxWidth;
    this.padding = padding;
    this.styleBorder = styleBorder;
  }

  addChild(component: Component): void {
    this.children.push(component);
  }

  addSeparator(): void {
    this.children.push({ render: (_w) => ["__SEPARATOR__"], invalidate() {} });
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate();
    }
  }

  render(width: number): string[] {
    const boxWidth = Math.min(width - 4, this.maxWidth);
    const contentWidth = boxWidth - 2 - this.padding * 2;
    const hr = "─".repeat(boxWidth - 2);
    const lines: string[] = [];

    lines.push(this.pad(this.styleBorder(`╭${hr}╮`), width));

    for (const child of this.children) {
      const childLines = child.render(contentWidth);
      for (const line of childLines) {
        if (line === "__SEPARATOR__") {
          lines.push(this.pad(this.styleBorder(`├${hr}┤`), width));
        } else {
          lines.push(this.pad(this.wrapLine(line, boxWidth), width));
        }
      }
    }

    lines.push(this.pad(this.styleBorder(`╰${hr}╯`), width));
    return lines;
  }

  private wrapLine(content: string, boxWidth: number): string {
    const padded = " ".repeat(this.padding) + content;
    const contentLen = visibleWidth(padded);
    const rightPad = Math.max(0, boxWidth - contentLen - 2);
    return this.styleBorder("│") + padded + "\x1b[0m" + " ".repeat(rightPad) + this.styleBorder("│");
  }

  private pad(line: string, width: number): string {
    const len = visibleWidth(line);
    return line + " ".repeat(Math.max(0, width - len));
  }
}

// Editor without border lines, with optional prefix on first line

class PrefixedEditor implements Component {
  private prefix: string;
  private prefixWidth: number;
  constructor(private editor: Editor, prefix: string = "") {
    this.prefix = prefix;
    this.prefixWidth = visibleWidth(prefix);
  }
  invalidate(): void { this.editor.invalidate(); }
  render(width: number): string[] {
    const editorWidth = this.prefix ? width - this.prefixWidth : width;
    const lines = this.editor.render(editorWidth);
    // Strip top/bottom border lines the Editor always renders
    const content = lines.slice(1, -1);
    if (this.prefix && content.length > 0) {
      content[0] = this.prefix + content[0];
      const indent = " ".repeat(this.prefixWidth);
      for (let i = 1; i < content.length; i++) {
        content[i] = indent + content[i];
      }
    }
    return content;
  }
}

// Shared Q&A pair rendering

export interface QAPairData {
  question: string;
  options?: string[];
  answer: string;
}

export interface QATheme {
  dim: (s: string) => string;
  accent: (s: string) => string;
  italic: (s: string) => string;
}

export function renderQAPairs(pairs: QAPairData[], theme: QATheme): Container {
  const container = new Container();
  for (let i = 0; i < pairs.length; i++) {
    if (i > 0) container.addChild(new Spacer(1));
    container.addChild(new Text(theme.dim("Q: ") + pairs[i].question, 0, 0));
    if (pairs[i].options && pairs[i].options!.length > 0) {
      container.addChild(new Text(theme.dim(theme.italic(pairs[i].options!.join(", "))), 3, 0));
    }
    container.addChild(new Text(theme.accent("A: ") + pairs[i].answer, 0, 0));
  }
  return container;
}

// Interactive Q&A component

export class QnAComponent implements Component {
  private questions: ExtractedQuestion[];
  private answers: string[];
  private currentIndex: number = 0;
  private editor: Editor;
  private tui: TUI;
  private onDone: (result: string | null) => void;
  private showingConfirmation: boolean = false;

  // Per-question option selection state
  private selectedOptionIndex: number[];
  private customInput: boolean[];
  private editorInPaste: boolean = false;

  // Colors
  private dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  private bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  private cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  private green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  private yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  private gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

  constructor(
    questions: ExtractedQuestion[],
    tui: TUI,
    onDone: (result: string | null) => void,
  ) {
    this.questions = questions;
    this.answers = questions.map(() => "");
    this.selectedOptionIndex = questions.map(() => 0);
    this.customInput = questions.map(() => false);
    this.tui = tui;
    this.onDone = onDone;

    const selectTheme: SelectListTheme = {
      selectedPrefix: (s: string) => `\x1b[44m${s}\x1b[0m`,
      selectedText: this.cyan,
      description: this.gray,
      scrollInfo: this.dim,
      noMatch: this.gray,
    };

    const editorTheme: EditorTheme = {
      borderColor: this.dim,
      selectList: selectTheme,
    };

    this.editor = new Editor(tui, editorTheme);
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      this.invalidate();
      this.tui.requestRender();
    };
  }

  private hasOptions(): boolean {
    const q = this.questions[this.currentIndex];
    return !!(q.options && q.options.length > 0);
  }

  private isEditingCustom(): boolean {
    return this.hasOptions() && this.customInput[this.currentIndex];
  }

  private optionsForCurrent(): string[] {
    const q = this.questions[this.currentIndex];
    if (!q.options || q.options.length === 0) return [];
    const opts = [...q.options];
    if (q.allowCustom !== false) opts.push("Other");
    return opts;
  }

  private saveCurrentAnswer(): void {
    if (this.isEditingCustom() || !this.hasOptions()) {
      this.answers[this.currentIndex] = this.editor.getText();
    }
  }

  private advance(): void {
    if (this.currentIndex < this.questions.length - 1) {
      this.navigateTo(this.currentIndex + 1);
    } else {
      this.showingConfirmation = true;
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.questions.length) return;
    this.saveCurrentAnswer();
    this.currentIndex = index;
    if (!this.hasOptions() || this.customInput[index]) {
      this.editor.setText(this.answers[index] || "");
    }
    this.invalidate();
  }

  private submit(): void {
    this.saveCurrentAnswer();

    const parts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const a = this.answers[i]?.trim() || "(no answer)";
      parts.push(`Q: ${q.question}`);
      if (q.context) {
        parts.push(`> ${q.context}`);
      }
      parts.push("");
      parts.push(`A: ${a}`);
      parts.push("");
    }

    this.onDone(parts.join("\n").trim());
  }

  private cancel(): void {
    this.onDone(null);
  }

  invalidate(): void {
    for (const child of [this.editor]) {
      child.invalidate?.();
    }
  }

  handleInput(data: string): void {
    if (this.showingConfirmation) {
      if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
        this.submit();
        return;
      }
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data.toLowerCase() === "n") {
        this.showingConfirmation = false;
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.cancel();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
      }
      return;
    }

    // Pass bracketed paste sequences directly to the editor
    if (data.includes("\x1b[200~") || this.editorInPaste) {
      this.editor.handleInput(data);
      this.editorInPaste = !data.includes("\x1b[201~");
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (this.isEditingCustom()) {
      this.handleCustomInput(data);
    } else if (this.hasOptions()) {
      this.handleSelectInput(data);
    } else {
      this.handleEditorInput(data);
    }
  }

  private handleSelectInput(data: string): void {
    const opts = this.optionsForCurrent();
    const idx = this.selectedOptionIndex[this.currentIndex];

    if (matchesKey(data, Key.up)) {
      this.selectedOptionIndex[this.currentIndex] = idx > 0 ? idx - 1 : opts.length - 1;
      this.invalidate();
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedOptionIndex[this.currentIndex] = idx < opts.length - 1 ? idx + 1 : 0;
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const selected = opts[this.selectedOptionIndex[this.currentIndex]];
      if (selected === "Other") {
        this.customInput[this.currentIndex] = true;
        this.editor.setText("");
        this.invalidate();
        this.tui.requestRender();
      } else {
        this.answers[this.currentIndex] = selected;
        this.advance();
      }
      return;
    }
  }

  private handleCustomInput(data: string): void {
    if (matchesKey(data, Key.up) && this.editor.getText() === "") {
      this.customInput[this.currentIndex] = false;
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.saveCurrentAnswer();
      this.advance();
      return;
    }

    this.editor.handleInput(data);
    this.invalidate();
    this.tui.requestRender();
  }

  private handleEditorInput(data: string): void {
    if (matchesKey(data, Key.up) && this.editor.getText() === "") {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
        return;
      }
    }
    if (matchesKey(data, Key.down) && this.editor.getText() === "") {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
        return;
      }
    }

    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.saveCurrentAnswer();
      this.advance();
      return;
    }

    this.editor.handleInput(data);
    this.invalidate();
    this.tui.requestRender();
  }

  private buildConfirmationView(): Component {
    const box = new BorderedBox(120, 2, this.dim);

    box.addChild(new Text(this.bold(this.yellow("Review Answers")), 0, 0));
    box.addSeparator();

    const pairs = this.questions.map((q, i) => ({
      question: q.question,
      options: q.options,
      answer: this.answers[i]?.trim() || "(no answer)",
    }));
    const italic = (s: string) => `\x1b[3m${s}\x1b[23m`;
    box.addChild(renderQAPairs(pairs, { dim: this.dim, accent: this.green, italic }));

    box.addSeparator();
    box.addChild(new Text(
      `${this.yellow("Submit?")} ${this.dim("(Enter/y to confirm, Esc/n to go back)")}`,
      0, 0,
    ));

    return box;
  }

  private buildQuestionView(): Component {
    const box = new BorderedBox(120, 2, this.dim);

    // Title
    const title = `${this.bold(this.cyan("Questions"))} ${this.dim(`(${this.currentIndex + 1}/${this.questions.length})`)}`;
    box.addChild(new Text(title, 0, 0));
    box.addSeparator();

    // Progress dots
    const progressParts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const answered = (this.answers[i]?.trim() || "").length > 0;
      const current = i === this.currentIndex;
      if (current) {
        progressParts.push(this.cyan("●"));
      } else if (answered) {
        progressParts.push(this.green("●"));
      } else {
        progressParts.push(this.dim("○"));
      }
    }
    box.addChild(new Text(progressParts.join(" "), 0, 0));
    box.addChild(new Spacer(1));

    // Current question
    const q = this.questions[this.currentIndex];
    box.addChild(new Text(`${this.bold("Q:")} ${q.question}`, 0, 0));

    // Context
    if (q.context) {
      box.addChild(new Text(this.gray(`> ${q.context}`), 0, 0));
    }

    box.addChild(new Spacer(1));

    // Answer area
    box.addChild(this.buildAnswerArea());

    box.addChild(new Spacer(1));

    // Controls
    box.addSeparator();
    let controls: string;
    if (this.isEditingCustom()) {
      controls = `${this.dim("↑")} back to options · ${this.dim("Enter")} confirm · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
    } else if (this.hasOptions()) {
      controls = `${this.dim("↑↓")} select · ${this.dim("Enter")} confirm · ${this.dim("Tab")} next · ${this.dim("Esc")} cancel`;
    } else {
      controls = `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
    }
    box.addChild(new Text(controls, 0, 0));

    return box;
  }

  private buildAnswerArea(): Component {
    const container = new Container();

    if (this.hasOptions()) {
      const opts = this.optionsForCurrent();
      const idx = this.selectedOptionIndex[this.currentIndex];

      for (let i = 0; i < opts.length; i++) {
        const isSelected = i === idx;
        const isOther = opts[i] === "Other";
        const isEditingThis = isOther && this.customInput[this.currentIndex];

        if (isEditingThis) {
          container.addChild(new PrefixedEditor(this.editor, this.cyan("→ ") + this.cyan("Other: ")));
        } else {
          const prefix = isSelected ? this.cyan("→ ") : "  ";
          const text = isSelected ? this.cyan(opts[i]) : opts[i];
          container.addChild(new Text(`${prefix}${text}`, 0, 0));
        }
      }
    } else {
      container.addChild(new PrefixedEditor(this.editor, this.bold("A: ")));
    }

    return container;
  }

  render(width: number): string[] {
    const view = this.showingConfirmation
      ? this.buildConfirmationView()
      : this.buildQuestionView();
    return view.render(width);
  }
}
