import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerBrainstorm(pi: ExtensionAPI) {
  pi.registerCommand("ak:brainstorm", {
    description: "Interactive brainstorm — generate research questions through Q&A",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("ak:brainstorm requires interactive mode", "error");
        return;
      }

      const trimmed = args.trim();

      if (trimmed === "done") {
        return handleDone(pi);
      }

      return handleStart(pi, trimmed || undefined);
    },
    getArgumentCompletions: () => {
      return [{ value: "done", description: "Wrap up and write brainstorm doc" }];
    },
  });
}

function handleStart(pi: ExtensionAPI, topic?: string) {
  pi.sendMessage(
    { customType: "ak:brainstorm", content: buildStartPrompt(topic), display: true },
    { triggerTurn: true }
  );
}

function handleDone(pi: ExtensionAPI) {
  const today = new Date().toISOString().slice(0, 10);

  pi.sendMessage(
    { customType: "ak:brainstorm", content: buildDonePrompt(today), display: true },
    { triggerTurn: true }
  );
}

function buildStartPrompt(topic?: string): string {
  const sections: string[] = [];

  sections.push(
    `You are running an interactive brainstorm. Your one job: produce **research questions** — specific factual questions that \`/ak:research\` will answer by examining the codebase and external docs. Everything here serves that goal. No architecture, no implementation ideas, no solutions.`
  );

  if (topic) {
    sections.push(`## Topic\n\n${topic}`);
  } else {
    sections.push(`## Topic\n\nThe user didn't provide a topic. Ask them what they want to brainstorm about before proceeding.`);
  }

  sections.push(`## What to do

Use \`finder\` to scan the repo for code relevant to this topic. Describe what exists — facts only.

Then ask questions **one at a time** using \`ask_user_question\`. Start by challenging the framing: is this the right problem? What happens if we do nothing?

Then explore what we don't know yet. Prefer structured choices (the \`options\` array) over open-ended questions. After each answer, reflect back what you heard and surface the research questions emerging from it.

Match depth to complexity. Small change: 3–5 questions. Major feature: 10–15. Trivial fix: say so and write a minimal doc.`);

  return sections.join("\n\n");
}

function buildDonePrompt(today: string): string {
  return `Synthesize everything we discussed in this brainstorm into a document in \`docs/brainstorms/\`. Name the file \`${today}-<topic-slug>.md\` where \`<topic-slug>\` is a kebab-case slug you derive from what we discussed.

The document must contain:
- **Problem statement** — what we're solving and why
- **Research questions** — specific "What/How/Where" questions answerable with facts from the codebase or external docs
- **Initial non-goals** — what we're explicitly not doing

Base this entirely on our conversation. Don't add new questions we didn't discuss.

After writing, tell the user they can continue with \`/ak:research <path-to-the-file-you-wrote>\`.`;
}
