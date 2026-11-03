import type { AiToolDefinition } from './ai.types';
export function toolsToOpenAiFormat(tools: AiToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
export type ParseToolCallArgumentsResult =
  { ok: true; args: Record<string, unknown> } | { ok: false; message: string };
export function parseToolCallArguments(raw: string): Record<string, unknown> {
  const result = parseToolCallArgumentsStrict(raw);
  // Providers historically received `{}`; callers that need fail-closed should use
  // parseToolCallArgumentsStrict. This wrapper stays for compatibility but returns
  // a marker so validation can still reject empty unknown shapes for mutators.
  if (!result.ok) {
    return { __parseError: result.message };
  }
  return result.args;
}
export function parseToolCallArgumentsStrict(
  raw: string,
): ParseToolCallArgumentsResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {
        ok: false,
        message: 'Tool arguments must be a JSON object',
      };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      message: 'Tool arguments are not valid JSON',
    };
  }
}
