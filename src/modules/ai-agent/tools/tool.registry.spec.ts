import { getActionLabel, getToolsForModule } from './tool.registry';

describe('tool.registry', () => {
  it('returns general tools by default', () => {
    const tools = getToolsForModule(null);
    expect(tools.some((t) => t.name === 'set_theme')).toBe(true);
  });

  it('labels theme actions', () => {
    expect(getActionLabel('set_theme', { value: 'dark' })).toContain('dark');
  });

  it('scopes agenda module tools', () => {
    const agendaTools = getToolsForModule('agenda');
    expect(agendaTools.some((t) => t.name === 'update_module_config')).toBe(true);
    expect(agendaTools.some((t) => t.name === 'set_theme')).toBe(false);
  });
});
