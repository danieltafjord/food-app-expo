import { validateReleaseEnvironment } from '../../scripts/release-config';
import eas from '../../eas.json';

const valid = {
  EXPO_PUBLIC_API_URL: 'https://api.handlelistaapp.no',
  EXPO_PUBLIC_PRIVACY_URL: 'https://handlelistaapp.no/privacy',
  EXPO_PUBLIC_SUPPORT_URL: 'https://handlelistaapp.no/support',
  EXPO_PUBLIC_OAUTH_CLIENT_ID: 'public-client-id',
};

it('accepts complete HTTPS release configuration', () => {
  expect(() => validateReleaseEnvironment(valid)).not.toThrow();
});

it('ships a complete production build configuration with public help pages', () => {
  const production = eas.build.production.env;
  expect(() => validateReleaseEnvironment(production)).not.toThrow();
  expect(production.EXPO_PUBLIC_PRIVACY_URL).toBe(valid.EXPO_PUBLIC_PRIVACY_URL);
  expect(production.EXPO_PUBLIC_SUPPORT_URL).toBe(valid.EXPO_PUBLIC_SUPPORT_URL);
});

it.each([
  ['EXPO_PUBLIC_API_URL', 'http://food-app.test'],
  ['EXPO_PUBLIC_API_URL', 'https://api.handlelistaapp.no/api/v1'],
  ['EXPO_PUBLIC_API_URL', 'https://user:password@api.handlelistaapp.no'],
  ['EXPO_PUBLIC_PRIVACY_URL', ''],
  ['EXPO_PUBLIC_SUPPORT_URL', 'https://support.example'],
  ['EXPO_PUBLIC_OAUTH_CLIENT_ID', 'REPLACE_WITH_CLIENT'],
])('rejects invalid %s', (key, value) => {
  expect(() => validateReleaseEnvironment({ ...valid, [key]: value })).toThrow(key);
});
