/** Name the user sees for each app whose API can be turned off. */
const MODULE_DISPLAY_NAME: Readonly<Record<string, string>> = {
  finance: 'Finanzas',
  agenda: 'Agenda',
  projects: 'Proyectos',
  health: 'Salud',
  keepAwake: 'Keep Awake',
};

export function moduleDisplayName(slug: string): string {
  return MODULE_DISPLAY_NAME[slug] ?? slug;
}

export function moduleDisabledMessage(slug: string): string {
  return `La app ${moduleDisplayName(slug)} está desactivada`;
}
