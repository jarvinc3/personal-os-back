import { Inject, Injectable } from '@nestjs/common';
import {
  AI_AGENT_INFERENCE,
  AI_CAPABILITY_REGISTRY,
  AiCapabilityError,
  type AiAgentInferencePort,
  type AiAgentMessage,
  type AiAgentToolDefinition,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
  type AiExecutionContext,
} from '@personal-os/contracts';
import { randomUUID } from 'node:crypto';
import { AiContextAssembler } from './ai-context-assembler';
import { AiConversationStore } from './ai-conversation.store';

const MAX_TOOL_ROUNDS = 4;
const SUMMARY_AFTER_MESSAGES = 24;
const SUMMARY_RECENT_MESSAGES = 12;

@Injectable()
export class AiAgentOrchestrator {
  constructor(
    private readonly conversations: AiConversationStore,
    private readonly contextAssembler: AiContextAssembler,
    @Inject(AI_AGENT_INFERENCE)
    private readonly inference: AiAgentInferencePort,
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly capabilities: AiCapabilityRegistryPort,
  ) {}

  async sendMessage(userId: string, conversationId: string, content: string) {
    const initial = await this.conversations.findOwned(userId, conversationId);
    const hadUserMessages = initial.messages.some(
      (message) => message.role === 'user',
    );
    await this.conversations.append(userId, conversationId, {
      role: 'user',
      content,
    });
    if (!hadUserMessages) {
      await this.conversations.setTitleFromFirstMessage(
        userId,
        conversationId,
        content,
      );
    }

    const conversation = await this.conversations.findOwned(
      userId,
      conversationId,
    );
    const history = conversation.messages;
    await this.refreshSummary(
      userId,
      conversationId,
      conversation.summary,
      history,
    );
    const latest = await this.conversations.findOwned(userId, conversationId);
    const descriptors = this.readCapabilities();
    const ctx: AiExecutionContext = {
      userId,
      invocationId: randomUUID(),
      correlationId: conversationId,
    };
    const messages = await this.contextAssembler.assemble({
      ctx,
      descriptors,
      history,
      summary: latest.summary,
    });
    const definitions: AiAgentToolDefinition[] = descriptors.map(
      (descriptor) => ({
        name: descriptor.id,
        description: descriptor.description,
        parameters: descriptor.inputSchema,
      }),
    );

    let completion = await this.inference.complete(messages, definitions);
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (!completion.toolCalls.length) {
        break;
      }

      const assistantToolCall: AiAgentMessage = {
        role: 'assistant',
        content: completion.content,
        toolCalls: completion.toolCalls,
      };
      messages.push(assistantToolCall);
      await this.conversations.append(
        userId,
        conversationId,
        assistantToolCall,
      );

      for (const call of completion.toolCalls) {
        const descriptor = descriptors.find((item) => item.id === call.name);
        let toolContent: string;
        if (!descriptor) {
          toolContent = JSON.stringify({
            ok: false,
            error: 'CAPABILITY_NOT_FOUND',
          });
        } else {
          try {
            const result = await this.capabilities.execute(
              ctx,
              descriptor.id,
              call.arguments,
            );
            toolContent = JSON.stringify({ ok: true, data: result });
          } catch (error) {
            const code =
              error instanceof AiCapabilityError
                ? error.code
                : 'CAPABILITY_EXECUTION_FAILED';
            toolContent = JSON.stringify({ ok: false, error: code });
          }
        }
        const toolMessage: AiAgentMessage = {
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: toolContent,
        };
        messages.push(toolMessage);
        await this.conversations.append(userId, conversationId, toolMessage);
      }
      completion = await this.inference.complete(
        messages,
        round + 1 < MAX_TOOL_ROUNDS ? definitions : undefined,
      );
    }

    const answer =
      completion.content.trim() ||
      'No pude completar una respuesta con los datos disponibles. Inténtalo de nuevo.';
    await this.conversations.append(userId, conversationId, {
      role: 'assistant',
      content: answer,
    });
    return {
      conversationId,
      answer,
      provider: completion.provider,
      model: completion.model,
    };
  }

  private readCapabilities(): AiCapabilityDescriptor[] {
    return this.capabilities
      .discover()
      .filter((descriptor) => descriptor.effect === 'READ');
  }

  private async refreshSummary(
    userId: string,
    conversationId: string,
    currentSummary: string | null,
    history: readonly AiAgentMessage[],
  ): Promise<void> {
    if (history.length < SUMMARY_AFTER_MESSAGES || history.length % 10 !== 0) {
      return;
    }
    const messagesToSummarize = history.slice(0, -SUMMARY_RECENT_MESSAGES);
    if (!messagesToSummarize.length) {
      return;
    }
    try {
      const summary = await this.inference.summarize([
        ...(currentSummary
          ? [
              {
                role: 'system' as const,
                content: `Resumen anterior:\n${currentSummary}`,
              },
            ]
          : []),
        ...messagesToSummarize,
      ]);
      if (summary) {
        await this.conversations.saveSummary(userId, conversationId, summary);
      }
    } catch {
      // Summary is an optional private convenience; a failed summary does not block a turn.
    }
  }
}
