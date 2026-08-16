import type { RenderStrategy } from "../types";

export const native: RenderStrategy = {
  name: "native",
  prepare(prompt) {
    return {
      system: prompt.system,
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
