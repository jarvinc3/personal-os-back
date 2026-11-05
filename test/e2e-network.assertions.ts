import { takeBlockedExternalFetchAttempts } from './helpers/test-env';

afterEach(() => {
  expect(takeBlockedExternalFetchAttempts()).toEqual([]);
});
