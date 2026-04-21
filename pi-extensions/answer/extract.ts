// Question extraction — model selection and JSON parsing for the /answer command.

import { complete, type Model, type Api, type UserMessage } from "@mariozechner/pi-ai";

export interface ExtractedQuestion {
  question: string;
  context?: string;
  options?: string[];
  allowCustom?: boolean;
}

export interface ExtractionResult {
  questions: ExtractedQuestion[];
}

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
    }
  ]
}`;

const CODEX_MODEL_ID = "gpt-5.1-codex-mini";
const HAIKU_MODEL_ID = "claude-haiku-4-5";

/**
 * Prefer Codex mini for extraction when available, otherwise fallback to haiku or the current model.
 */
export async function selectExtractionModel(
  currentModel: Model<Api>,
  modelRegistry: {
    find: (provider: string, modelId: string) => Model<Api> | undefined;
    getApiKey: (model: Model<Api>) => Promise<string | undefined>;
  },
): Promise<Model<Api>> {
  const codexModel = modelRegistry.find("openai-codex", CODEX_MODEL_ID);
  if (codexModel) {
    const apiKey = await modelRegistry.getApiKey(codexModel);
    if (apiKey) {
      return codexModel;
    }
  }

  const haikuModel = modelRegistry.find("anthropic", HAIKU_MODEL_ID);
  if (!haikuModel) {
    return currentModel;
  }

  const apiKey = await modelRegistry.getApiKey(haikuModel);
  if (!apiKey) {
    return currentModel;
  }

  return haikuModel;
}

/**
 * Parse the JSON response from the LLM into an ExtractionResult.
 */
export function parseExtractionResult(text: string): ExtractionResult | null {
  try {
    let jsonStr = text;

    // Remove markdown code block if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.questions)) {
      return parsed as ExtractionResult;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract questions from text using an LLM.
 */
export async function extractQuestions(
  text: string,
  model: Model<Api>,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<ExtractionResult | null> {
  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };

  const response = await complete(
    model,
    { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey, signal },
  );

  if (response.stopReason === "aborted") {
    return null;
  }

  const responseText = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return parseExtractionResult(responseText);
}
