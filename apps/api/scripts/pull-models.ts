/** Downloads the Ollama models Relay uses, if they aren't there yet. */
import { pullModel } from '../src/ai/ollama';
import { loadConfig } from '../src/config';

const { ai } = loadConfig();
const models = [ai.embedModel, ...(ai.anthropicApiKey ? [] : [ai.ollamaChatModel])];
for (const model of models) {
  console.log(`Pulling ${model} from ${ai.ollamaUrl} (first time can take a few minutes)…`);
  await pullModel(ai.ollamaUrl, model);
}
console.log('Models ready.');
