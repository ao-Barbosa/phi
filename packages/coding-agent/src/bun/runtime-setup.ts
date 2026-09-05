import { bedrockProviderModule } from "@ao-barbosa/phi-ai/bedrock-provider";
import { registerBunOAuthFlows } from "@ao-barbosa/phi-ai/bun-oauth";
import { setBedrockProviderModule } from "@ao-barbosa/phi-ai/compat";
import { APP_NAME } from "../config.ts";

process.title = APP_NAME;
process.emitWarning = (() => {}) as typeof process.emitWarning;
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
