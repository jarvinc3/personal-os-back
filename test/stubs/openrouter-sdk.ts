/**
 * Jest runs CommonJS and `@openrouter/sdk` ships ESM only. Tests inject AI
 * providers as doubles, so this stub is never asked to call the network.
 */
export class OpenRouter {}
