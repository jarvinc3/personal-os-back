import type { AiTone } from '@personal-os/users';
import type { ChatContextEntity } from '@personal-os/core';
import { TONE_INSTRUCTIONS } from '../chat/application/build-system-prompt';
import { getModuleContextPrompt } from './module-context';
import { SYSTEM_BASE_PROMPT } from './system-base';
import {
  getToolsBehaviorInstructions,
  getToolsListForModule,
} from './tools-instructions';

export function buildAgentPrompt(options: {
  tone: AiTone;
  locale?: string | null;
  confirmBeforeActions?: boolean;
  memorySnapshot?: Record<string, unknown>;
  moduleSlug?: string | null;
  entityContext?: ChatContextEntity | null;
}): string {
  const useSpanish =
    !options.locale || options.locale.toLowerCase().startsWith('es');
  const languageHint = useSpanish
    ? 'Responde en español salvo que el usuario escriba en otro idioma.'
    : 'Respond in the user language.';

  const confirmationHint = options.confirmBeforeActions
    ? 'Modo confirmación ACTIVO: las acciones mutantes quedan pendientes en tarjetas hasta que el usuario confirme.'
    : 'Modo confirmación DESACTIVADO: ejecuta acciones mutantes de inmediato con las herramientas. No pidas confirmación al usuario.';

  const toolsBehavior = getToolsBehaviorInstructions(
    options.confirmBeforeActions ?? true,
  );

  const memoryHint =
    options.memorySnapshot && Object.keys(options.memorySnapshot).length > 0
      ? `Memoria de sesiones anteriores: ${JSON.stringify(options.memorySnapshot).slice(0, 1500)}`
      : '';

  const entityHint = options.entityContext
    ? `Entidad en foco: ${options.entityContext.type} "${options.entityContext.name}" (id: ${options.entityContext.id}). Datos: ${options.entityContext.summary}. Si el usuario dice "esto", "esta cuenta", "este préstamo" u otra referencia sin id, usa esa entidad y pasa el id a las herramientas.`
    : '';

  return [
    SYSTEM_BASE_PROMPT,
    getModuleContextPrompt(options.moduleSlug ?? null),
    getToolsListForModule(options.moduleSlug ?? null),
    entityHint,
    toolsBehavior,
    languageHint,
    TONE_INSTRUCTIONS[options.tone],
    confirmationHint,
    memoryHint,
  ]
    .filter(Boolean)
    .join('\n\n');
}
