// Shared Q&A pair rendering used by both the QnAComponent confirmation
// screen and the ask_user_question tool's renderResult.

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

export function renderQAPairs(pairs: QAPairData[], theme: QATheme): string[] {
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (i > 0) lines.push("");
    lines.push(theme.dim("Q: ") + pairs[i].question);
    if (pairs[i].options && pairs[i].options!.length > 0) {
      lines.push(theme.dim("   " + theme.italic(pairs[i].options!.join(", "))));
    }
    lines.push(theme.accent("A: ") + pairs[i].answer);
  }
  return lines;
}
