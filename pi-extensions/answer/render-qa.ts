// Shared Q&A pair rendering used by both the QnAComponent confirmation
// screen and the ask_user_question tool's renderResult.

export interface QAPairData {
  question: string;
  answer: string;
}

export interface QATheme {
  dim: (s: string) => string;
  accent: (s: string) => string;
}

export function renderQAPairs(pairs: QAPairData[], theme: QATheme): string[] {
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (i > 0) lines.push("");
    lines.push(theme.dim("Q: ") + pairs[i].question);
    lines.push(theme.accent("A: ") + pairs[i].answer);
  }
  return lines;
}
