import type { RenderStrategy } from "../types";

export const hybrid: RenderStrategy = {
  name: "hybrid",
  prepare(prompt) {
    const systemParts: string[] = [];
    if (prompt.system) systemParts.push(prompt.system);
    if (prompt.tools.length > 0) {
      systemParts.push(
        "You may invoke multiple independent tools in one turn when that is useful. " +
          "Do not batch dependent actions whose later arguments require earlier tool results.",
      );
    }
    return {
      system: systemParts.length ? systemParts.join("\n\n") : undefined,
      messages: prompt.messages,
      nativeTools: prompt.tools.length > 0 ? prompt.tools : undefined,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    };
  },
  parseResponse(response) {
    return { text: response.text, toolCalls: response.nativeToolCalls };
  },
};
