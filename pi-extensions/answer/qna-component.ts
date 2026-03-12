// Interactive Q&A TUI component for navigating and answering extracted questions.
// Supports free-text editor input and selectable options per question.

import type { ExtractedQuestion } from "./extract.ts";
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  SelectList,
  type SelectListTheme,
  truncateToWidth,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

type InputMode = "editor" | "select";

export class QnAComponent implements Component {
  private questions: ExtractedQuestion[];
  private answers: string[];
  private currentIndex: number = 0;
  private editor: Editor;
  private selectLists: (SelectList | null)[];
  private customInput: boolean[];
  private tui: TUI;
  private onDone: (result: string | null) => void;
  private showingConfirmation: boolean = false;

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

    // Build a SelectList for each question that has options
    this.selectLists = questions.map((q) => {
      if (!q.options || q.options.length === 0) return null;
      const items = q.options.map((o) => ({ value: o, label: o }));
      if (q.allowCustom !== false) {
        items.push({ value: "__other__", label: "Other" });
      }
      const list = new SelectList(items, 10, selectTheme);
      list.onSelect = (item) => {
        if (item.value === "__other__") {
          this.customInput[this.currentIndex] = true;
          this.editor.setText("");
          this.invalidate();
          this.tui.requestRender();
        } else {
          this.answers[this.currentIndex] = item.value;
          this.advance();
        }
      };
      list.onCancel = () => this.cancel();
      return list;
    });
  }

  private inputMode(): InputMode {
    const q = this.questions[this.currentIndex];
    if (!q.options || q.options.length === 0) return "editor";
    if (this.customInput[this.currentIndex]) return "editor";
    return "select";
  }

  private saveCurrentAnswer(): void {
    if (this.inputMode() === "editor") {
      this.answers[this.currentIndex] = this.editor.getText();
    }
    // Select mode answers are saved on selection via onSelect callback
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
    if (this.inputMode() === "editor") {
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

    if (this.inputMode() === "select") {
      const list = this.selectLists[this.currentIndex];
      if (list) {
        list.handleInput(data);
        this.invalidate();
        this.tui.requestRender();
      }
    } else {
      // Editor mode
      if (matchesKey(data, Key.up) && this.editor.getText() === "") {
        // If we came from "Other", go back to select
        if (this.customInput[this.currentIndex]) {
          this.customInput[this.currentIndex] = false;
          this.invalidate();
          this.tui.requestRender();
          return;
        }
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

    // Answer area — select list or editor
    if (this.inputMode() === "select") {
      const list = this.selectLists[this.currentIndex];
      if (list) {
        const selectLines = list.render(contentWidth - 4);
        for (const sl of selectLines) {
          lines.push(padToWidth(boxLine(sl)));
        }
      }
    } else {
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

    lines.push(padToWidth(emptyBoxLine()));

    // Footer
    if (this.showingConfirmation) {
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      const confirmMsg = `${this.yellow("Submit all answers?")} ${this.dim("(Enter/y to confirm, Esc/n to cancel)")}`;
      lines.push(padToWidth(boxLine(truncateToWidth(confirmMsg, contentWidth))));
    } else {
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      const controls = this.inputMode() === "select"
        ? `${this.dim("↑↓")} select · ${this.dim("Enter")} confirm · ${this.dim("Tab")} next · ${this.dim("Esc")} cancel`
        : `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
      lines.push(padToWidth(boxLine(truncateToWidth(controls, contentWidth))));
    }
    lines.push(padToWidth(this.dim("╰" + horizontalLine(boxWidth - 2) + "╯")));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
