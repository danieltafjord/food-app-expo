// Expo Router uses a namespace import. The patched security update must retain
// that API, not merely bundle successfully with a default-only ESM export.
import * as queryString from 'query-string';

it('supports Expo Router query serialization and parsing after the security update', () => {
  expect(queryString.stringify({ token: 'a b', lang: 'nb' }, { sort: false })).toBe('token=a%20b&lang=nb');
  expect(queryString.parse('token=a%20b&lang=nb')).toEqual({ token: 'a b', lang: 'nb' });
});

it('handles malformed deep-link encoding without throwing', () => {
  expect(() => queryString.parse('token=%E0%A4%A')).not.toThrow();
});
