import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerBrainstorm } from "./brainstorm.ts";

export default function (pi: ExtensionAPI) {
  registerBrainstorm(pi);
}
