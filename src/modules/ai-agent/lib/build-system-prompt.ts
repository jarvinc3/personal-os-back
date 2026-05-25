import type { AiTone } from '../../users/defaults/global-preferences-defaults';

export const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  concise:
    'Responde de forma breve y directa. Usa listas solo cuando aporten claridad.',
  balanced:
    'Equilibra claridad y detalle. Sé útil sin extenderte innecesariamente.',
  detailed:
    'Proporciona respuestas completas con contexto y pasos cuando sea relevante.',
};

export function buildSystemPrompt(options: {
  tone: AiTone;
  locale?: string | null;
  confirmBeforeActions?: boolean;
}): string {
  const useSpanish =
    !options.locale || options.locale.toLowerCase().startsWith('es');
  const languageHint = useSpanish
    ? 'Responde en español salvo que el usuario escriba en otro idioma.'
    : 'Respond in the user language.';

  const confirmationHint = options.confirmBeforeActions
    ? 'Si propones una acción que modifique datos del usuario, indícalo claramente y espera confirmación explícita.'
    : '';

  return [
    'Eres el asistente de Personal OS, una plataforma personal de productividad y finanzas.',
    languageHint,
    TONE_INSTRUCTIONS[options.tone],
    confirmationHint,
  ]
    .filter(Boolean)
    .join(' ');
}
