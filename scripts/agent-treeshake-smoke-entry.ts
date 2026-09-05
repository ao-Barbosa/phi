import { Agent } from "@ao-barbosa/phi-agent-core";
import { createModels } from "@ao-barbosa/phi-ai";
import { anthropicProvider } from "@ao-barbosa/phi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel("anthropic", "claude-sonnet-4-5");
if (!model) throw new Error("Anthropic smoke-test model not found");

export const agent = new Agent({
	initialState: { model },
	streamFn: models.streamSimple.bind(models),
});
