import { BadRequestException } from '@nestjs/common';
import {
  resolveViewSuggestionScope,
  viewSuggestionKey,
} from './view-suggestion-scope';

describe('resolveViewSuggestionScope', () => {
  it('keeps the route and labels the view or the sheet', () => {
    expect(
      resolveViewSuggestionScope({
        route: '/finance/transactions',
        view: 'list',
      }),
    ).toEqual({ route: '/finance/transactions', viewKey: 'view:list' });
    expect(
      resolveViewSuggestionScope({ route: '/finance', sheet: 'filters' }),
    ).toEqual({ route: '/finance', viewKey: 'sheet:filters' });
    expect(resolveViewSuggestionScope({ route: '/home' })).toEqual({
      route: '/home',
      viewKey: '',
    });
  });

  it('ignores filters and entity: they are not part of the view', () => {
    const withView = resolveViewSuggestionScope({
      route: '/finance/transactions',
      view: 'list',
    });
    expect(withView).toEqual({
      route: '/finance/transactions',
      viewKey: 'view:list',
    });
  });

  it('rejects a view and a sheet at the same time', () => {
    expect(() =>
      resolveViewSuggestionScope({
        route: '/finance',
        view: 'list',
        sheet: 'filters',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a route without the leading slash', () => {
    expect(() => resolveViewSuggestionScope({ route: 'finance' })).toThrow(
      BadRequestException,
    );
  });
});

describe('viewSuggestionKey', () => {
  it('is stable for casing, trimming and repeated spaces', () => {
    expect(viewSuggestionKey('  Revisá el presupuesto  ')).toBe(
      viewSuggestionKey('revisá   el presupuesto'),
    );
  });
});
