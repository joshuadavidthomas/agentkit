// System and user prompt builders for the specialist scout.
//
// Unlike other scouts, the specialist's system prompt is loaded from a
// SKILL.md file on disk. The preamble orients the agent as an expert
// executing under a turn budget, then the skill content follows.

const PREAMBLE = `You are a specialist agent executing a focused task. You have domain expertise loaded below.

Your job: apply this expertise to the task the user gives you. Be thorough, use your tools to investigate and verify, and produce a clear, actionable result.

Constraints:
- You have a limited turn budget. Be efficient with tool calls.
- Focus on the task. Do not go on tangents.
- End with a clear summary of findings or actions taken.`;

export function buildSpecialistSystemPrompt(skillContent: string, maxTurns: number): string {
  return `${PREAMBLE}

Turn budget: ${maxTurns} turns total. On your final turn, tool use is disabled — provide your answer.

## Domain Expertise

${skillContent}`;
}

export function buildSpecialistUserPrompt(params: Record<string, unknown>): string {
  const task = String(params.task ?? "").trim();
  if (!task) return "No task provided.";
  return task;
}
