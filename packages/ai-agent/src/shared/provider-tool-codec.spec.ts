import {
  parseToolCallArguments,
  parseToolCallArgumentsStrict,
} from './provider-tool-codec';
describe('Provider tool-call JSON codec', () => {
  it('fails closed on invalid tool argument JSON', () => {
    expect(parseToolCallArgumentsStrict('{')).toEqual({
      ok: false,
      message: 'Tool arguments are not valid JSON',
    });
    expect(parseToolCallArguments('{')).toEqual({
      __parseError: 'Tool arguments are not valid JSON',
    });
    expect(parseToolCallArgumentsStrict('[]')).toMatchObject({ ok: false });
    expect(parseToolCallArgumentsStrict('{"value":"dark"}')).toEqual({
      ok: true,
      args: { value: 'dark' },
    });
  });
});
