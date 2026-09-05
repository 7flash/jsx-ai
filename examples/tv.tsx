// @jsxImportSource jsx-ai

import { callLLM } from "../src/index";

const prompt = (
  <prompt>
    <system>Call stage_shot exactly once.</system>

    <tool name="stage_shot" description="Stage the next shot">
      <param name="prompt" type="string" required>
        Video prompt
      </param>
    </tool>

    <message role="user">Stage a shot where a cat enters the room.</message>
  </prompt>
);

const result = await callLLM(prompt);
console.log(JSON.stringify(result, null, 2));
