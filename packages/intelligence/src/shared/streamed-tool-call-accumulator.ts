import { parseToolCallArguments } from './provider-tool-codec';
import type { ToolCallRequest } from './ai.types';

export type StreamedToolCallDelta = {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * Junta los trozos de una llamada a herramienta que llegan en varios chunks.
 * El id y el nombre pueden venir solo en el primero; los argumentos se
 * concatenan hasta el último.
 */
export class StreamedToolCallAccumulator {
  private readonly pending = new Map<number, PendingToolCall>();

  add(deltas: readonly StreamedToolCallDelta[]): void {
    for (const delta of deltas) {
      const current = this.pending.get(delta.index) ?? {
        id: '',
        name: '',
        arguments: '',
      };
      this.pending.set(delta.index, {
        id: delta.id ?? current.id,
        name: delta.function?.name ?? current.name,
        arguments: current.arguments + (delta.function?.arguments ?? ''),
      });
    }
  }

  finish(): ToolCallRequest[] {
    return [...this.pending.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => {
        if (!call.id || !call.name) {
          throw new Error('AI provider returned an incomplete tool call');
        }
        return {
          id: call.id,
          name: call.name,
          arguments: parseToolCallArguments(call.arguments),
        };
      });
  }
}
