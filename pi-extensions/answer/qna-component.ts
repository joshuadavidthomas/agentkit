// Interactive Q&A TUI component for navigating and answering extracted questions.
// Supports free-text editor input and selectable options per question.

import type { ExtractedQuestion } from "./extract.ts";
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  type SelectListTheme,
  truncateToWidth,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

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

  // Cache
  private cachedWidth?: number;
  private cachedLines?: string[];

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

  private isOnOtherOption(): boolean {
    const opts = this.optionsForCurrent();
    return this.selectedOptionIndex[this.currentIndex] === opts.length - 1
      && opts[opts.length - 1] === "Other";
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
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
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
    // Escape from custom input back to option selection
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

  private renderAnswerArea(
    contentWidth: number,
    boxLine: (c: string, p?: number) => string,
    padToWidth: (l: string) => string,
  ): string[] {
    const lines: string[] = [];

    if (this.hasOptions()) {
      const opts = this.optionsForCurrent();
      const idx = this.selectedOptionIndex[this.currentIndex];

      for (let i = 0; i < opts.length; i++) {
        const isSelected = i === idx;
        const isOther = opts[i] === "Other";
        const isEditingThis = isOther && this.customInput[this.currentIndex];

        if (isEditingThis) {
          // Replace "Other" row with inline editor
          const prefix = this.cyan("→ ");
          const label = this.cyan("Other: ");
          const editorWidth = contentWidth - 12;
          const editorLines = this.editor.render(editorWidth);
          for (let j = 1; j < editorLines.length - 1; j++) {
            if (j === 1) {
              lines.push(padToWidth(boxLine(`${prefix}${label}${editorLines[j]}`)));
            } else {
              lines.push(padToWidth(boxLine(`    ${" ".repeat(visibleWidth("Other: "))}${editorLines[j]}`)));
            }
          }
        } else {
          const prefix = isSelected ? this.cyan("→ ") : "  ";
          const text = isSelected ? this.cyan(opts[i]) : opts[i];
          lines.push(padToWidth(boxLine(`${prefix}${text}`)));
        }
      }
    } else {
      // Pure free-text
      const answerPrefix = this.bold("A: ");
      const editorWidth = contentWidth - 4 - 3;
      const editorLines = this.editor.render(editorWidth);
      for (let i = 1; i < editorLines.length - 1; i++) {
        if (i === 1) {
          lines.push(padToWidth(boxLine(answerPrefix + editorLines[i])));
        } else {
          lines.push(padToWidth(boxLine("   " + editorLines[i])));
        }
      }
    }

    return lines;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const boxWidth = Math.min(width - 4, 120);
    const contentWidth = boxWidth - 4;

    const horizontalLine = (count: number) => "─".repeat(count);

    const boxLine = (content: string, leftPad: number = 2): string => {
      const paddedContent = " ".repeat(leftPad) + content;
      const contentLen = visibleWidth(paddedContent);
      const rightPad = Math.max(0, boxWidth - contentLen - 2);
      return this.dim("│") + paddedContent + " ".repeat(rightPad) + this.dim("│");
    };

    const emptyBoxLine = (): string => {
      return this.dim("│") + " ".repeat(boxWidth - 2) + this.dim("│");
    };

    const padToWidth = (line: string): string => {
      const len = visibleWidth(line);
      return line + " ".repeat(Math.max(0, width - len));
    };

    // Title
    lines.push(padToWidth(this.dim("╭" + horizontalLine(boxWidth - 2) + "╮")));

    if (this.showingConfirmation) {
      // Confirmation screen: summary of all Q&A pairs
      const title = this.bold(this.yellow("Review Answers"));
      lines.push(padToWidth(boxLine(title)));
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));

      for (let i = 0; i < this.questions.length; i++) {
        if (i > 0) lines.push(padToWidth(emptyBoxLine()));
        const q = this.questions[i];
        const a = this.answers[i]?.trim() || "(no answer)";

        const questionText = `${this.dim("Q:")} ${q.question}`;
        const wrappedQ = wrapTextWithAnsi(questionText, contentWidth);
        for (const line of wrappedQ) {
          lines.push(padToWidth(boxLine(line)));
        }

        const answerText = `${this.green("A:")} ${a}`;
        const wrappedA = wrapTextWithAnsi(answerText, contentWidth);
        for (const line of wrappedA) {
          lines.push(padToWidth(boxLine(line)));
        }
      }

      lines.push(padToWidth(emptyBoxLine()));
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      const confirmMsg = `${this.yellow("Submit?")} ${this.dim("(Enter/y to confirm, Esc/n to go back)")}`;
      lines.push(padToWidth(boxLine(truncateToWidth(confirmMsg, contentWidth))));
    } else {
      // Normal question screen
      const title = `${this.bold(this.cyan("Questions"))} ${this.dim(`(${this.currentIndex + 1}/${this.questions.length})`)}`;
      lines.push(padToWidth(boxLine(title)));
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));

      // Progress indicator
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
      lines.push(padToWidth(boxLine(progressParts.join(" "))));
      lines.push(padToWidth(emptyBoxLine()));

      // Current question
      const q = this.questions[this.currentIndex];
      const questionText = `${this.bold("Q:")} ${q.question}`;
      const wrappedQuestion = wrapTextWithAnsi(questionText, contentWidth);
      for (const line of wrappedQuestion) {
        lines.push(padToWidth(boxLine(line)));
      }

      // Context if present
      if (q.context) {
        lines.push(padToWidth(emptyBoxLine()));
        const contextText = this.gray(`> ${q.context}`);
        const wrappedContext = wrapTextWithAnsi(contextText, contentWidth - 2);
        for (const line of wrappedContext) {
          lines.push(padToWidth(boxLine(line)));
        }
      }

      lines.push(padToWidth(emptyBoxLine()));

      // Answer area
      lines.push(...this.renderAnswerArea(contentWidth, boxLine, padToWidth));

      lines.push(padToWidth(emptyBoxLine()));

      // Footer controls
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      let controls: string;
      if (this.isEditingCustom()) {
        controls = `${this.dim("↑")} back to options · ${this.dim("Enter")} confirm · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
      } else if (this.hasOptions()) {
        controls = `${this.dim("↑↓")} select · ${this.dim("Enter")} confirm · ${this.dim("Tab")} next · ${this.dim("Esc")} cancel`;
      } else {
        controls = `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
      }
      lines.push(padToWidth(boxLine(truncateToWidth(controls, contentWidth))));
    }

    lines.push(padToWidth(this.dim("╰" + horizontalLine(boxWidth - 2) + "╯")));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
