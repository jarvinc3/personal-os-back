import { StreamedToolCallAccumulator } from './streamed-tool-call-accumulator';

describe('StreamedToolCallAccumulator', () => {
  it('joins id, name and argument chunks by index', () => {
    const accumulator = new StreamedToolCallAccumulator();

    accumulator.add([
      {
        index: 0,
        id: 'call-1',
        function: { name: 'buscar', arguments: '{"q"' },
      },
    ]);
    accumulator.add([{ index: 0, function: { arguments: ':"uno"}' } }]);
    accumulator.add([
      { index: 1, id: 'call-2', function: { name: 'leer', arguments: '{}' } },
    ]);

    expect(accumulator.finish()).toEqual([
      { id: 'call-1', name: 'buscar', arguments: { q: 'uno' } },
      { id: 'call-2', name: 'leer', arguments: {} },
    ]);
  });

  it('ignores an empty delta list', () => {
    const accumulator = new StreamedToolCallAccumulator();

    accumulator.add([]);

    expect(accumulator.finish()).toEqual([]);
  });

  it('fails when the provider leaves an incomplete call', () => {
    const accumulator = new StreamedToolCallAccumulator();
    accumulator.add([{ index: 0, function: { arguments: '{}' } }]);

    expect(() => accumulator.finish()).toThrow(
      'AI provider returned an incomplete tool call',
    );
  });
});
