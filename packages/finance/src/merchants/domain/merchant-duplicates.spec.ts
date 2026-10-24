import {
  countPossibleDuplicates,
  duplicateReason,
  findDuplicateCandidates,
  MERCHANT_DUPLICATE_REASON,
  type DuplicateComparable,
} from './merchant-duplicates';
import { normalizeMerchant } from './normalize-merchant';

function merchant(
  id: string,
  name: string,
  aliases: string[] = [],
): DuplicateComparable {
  return {
    id,
    name,
    normalizedKey: normalizeMerchant(name) ?? name,
    aliases,
  };
}

describe('duplicateReason', () => {
  it('flags two names that normalize to the same key', () => {
    expect(
      duplicateReason(merchant('a', 'Café Lindo'), merchant('b', 'Cafe Lindo')),
    ).toBe(MERCHANT_DUPLICATE_REASON.SAME_KEY);
  });

  it('flags a merchant whose alias is the other name', () => {
    expect(
      duplicateReason(
        merchant('a', 'Supermercado Nacional', ['Nacional']),
        merchant('b', 'Nacional'),
      ),
    ).toBe(MERCHANT_DUPLICATE_REASON.ALIAS_MATCH);
  });

  it('flags a name that only adds a final number', () => {
    expect(
      duplicateReason(
        merchant('a', 'Supermercado Nacional'),
        merchant('b', 'Supermercado Nacional 5'),
      ),
    ).toBe(MERCHANT_DUPLICATE_REASON.TRAILING_NUMBER);
  });

  it('flags a brand with a final number as a candidate, never a merge', () => {
    expect(
      duplicateReason(merchant('a', 'Studio'), merchant('b', 'Studio 54')),
    ).toBe(MERCHANT_DUPLICATE_REASON.TRAILING_NUMBER);
  });

  it('flags one name contained in the other', () => {
    expect(
      duplicateReason(
        merchant('a', 'Supermercado Nacional'),
        merchant('b', 'Supermercado Nacional Lope de Vega'),
      ),
    ).toBe(MERCHANT_DUPLICATE_REASON.NAME_CONTAINED);
  });

  it('flags a one-letter difference', () => {
    expect(
      duplicateReason(
        merchant('a', 'Farmacia Carol'),
        merchant('b', 'Farmacia Darol'),
      ),
    ).toBe(MERCHANT_DUPLICATE_REASON.SIMILAR_NAME);
  });

  it('keeps short names conservative', () => {
    expect(
      duplicateReason(merchant('a', 'Uber'), merchant('b', 'Ubera')),
    ).toBeNull();
    expect(duplicateReason(merchant('a', 'Uber'), merchant('b', 'Uber'))).toBe(
      MERCHANT_DUPLICATE_REASON.SAME_KEY,
    );
  });

  it('never compares a merchant with itself and is symmetric', () => {
    const first = merchant('a', 'Supermercado Nacional');
    const second = merchant('b', 'Supermercado Nacional 5');
    expect(duplicateReason(first, first)).toBeNull();
    expect(duplicateReason(first, second)).toBe(duplicateReason(second, first));
  });
});

describe('findDuplicateCandidates', () => {
  it('returns candidates with their reason, capped at the limit', () => {
    const target = merchant('a', 'Supermercado Nacional');
    const others = Array.from({ length: 8 }, (_, index) =>
      merchant(`m-${index}`, `Supermercado Nacional ${index + 1}`),
    );

    const candidates = findDuplicateCandidates(target, others, 5);

    expect(candidates).toHaveLength(5);
    expect(candidates[0].reason).toBe(
      MERCHANT_DUPLICATE_REASON.TRAILING_NUMBER,
    );
  });

  it('returns an empty list without candidates', () => {
    expect(
      findDuplicateCandidates(
        merchant('a', 'Cine'),
        [merchant('b', 'Farmacia'), merchant('c', 'Gasolina')],
        5,
      ),
    ).toEqual([]);
  });
});

describe('countPossibleDuplicates', () => {
  it('excludes itself and the dismissed pairs', () => {
    const target = merchant('a', 'Supermercado Nacional');
    const others = [
      target,
      merchant('b', 'Supermercado Nacional 1'),
      merchant('c', 'Supermercado Nacional 2'),
    ];

    expect(countPossibleDuplicates(target, others, new Set())).toBe(2);
    expect(countPossibleDuplicates(target, others, new Set(['b']))).toBe(1);
  });
});
