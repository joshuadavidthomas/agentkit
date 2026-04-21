import { ToolExecutionComponent } from "@mariozechner/pi-coding-agent";
import { Container, type TUI } from "@mariozechner/pi-tui";
import { type ToolView } from "./tools.js";
import type { TurnRenderState } from "./types.js";

export class ClaudeAgentWidget extends Container {
  constructor(
    private readonly tui: TUI,
    private readonly getTurn: () => TurnRenderState | undefined,
    private readonly getCwd: () => string,
    private readonly toPiToolView: (rawName: string, args: Record<string, unknown>) => ToolView,
  ) {
    super();
  }

  override render(width: number): string[] {
    this.clear();

    const turn = this.getTurn();
    if (!turn) return [];
    if (turn.tools.length === 0) return [];

    for (const tool of turn.tools.slice(-6)) {
      const { toolName, args } = this.toPiToolView(tool.rawName, tool.args);
      const component = new ToolExecutionComponent(
        toolName,
        tool.toolUseId,
        args,
        undefined,
        undefined,
        this.tui,
        this.getCwd(),
      );
      component.markExecutionStarted();
      component.setArgsComplete();
      if (tool.resultText !== undefined) {
        component.updateResult(
          {
            content: [{ type: "text", text: tool.resultText }],
            details: undefined,
            isError: tool.isError,
          },
          !tool.isComplete,
        );
      }
      this.addChild(component);
    }

    return super.render(width);
  }
}
