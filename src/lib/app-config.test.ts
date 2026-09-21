import makeConfig from '../../app.config';
import app from '../../app.json';
import eas from '../../eas.json';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const originalEnv = process.env;
const context: ConfigContext = {
  config: app.expo as ExpoConfig,
  projectRoot: process.cwd(),
  staticConfigPath: `${process.cwd()}/app.json`,
  packageJsonPath: `${process.cwd()}/package.json`,
};

afterEach(() => { process.env = originalEnv; });

it.each(['production', 'preview', 'development'] as const)(
  'keeps %s native configuration identical locally and on EAS', (profile) => {
    expect(eas.build[profile].env.APP_VARIANT).toBe(profile);
    process.env = { ...originalEnv, ...eas.build[profile].env };
    delete process.env.EAS_BUILD_PROFILE;
    Reflect.deleteProperty(process.env, 'NODE_ENV');
    const local = makeConfig(context);
    process.env.EAS_BUILD_PROFILE = profile;
    process.env.NODE_ENV = 'production';
    expect(makeConfig(context)).toEqual(local);
  },
);

it('defaults to strict transport security when no variant is selected', () => {
  process.env = { ...originalEnv };
  delete process.env.APP_VARIANT;
  delete process.env.EAS_BUILD_PROFILE;
  Reflect.deleteProperty(process.env, 'NODE_ENV');
  expect(makeConfig(context).ios?.infoPlist?.NSAppTransportSecurity).toEqual({
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: false,
    NSExceptionDomains: {},
  });
});

it('allows the Herd HTTP exception only for explicit development', () => {
  process.env = { ...originalEnv, APP_VARIANT: 'development' };
  delete process.env.EAS_BUILD_PROFILE;
  Reflect.deleteProperty(process.env, 'NODE_ENV');
  expect(makeConfig(context).ios?.infoPlist?.NSAppTransportSecurity.NSExceptionDomains)
    .toHaveProperty(['food-app.test', 'NSExceptionAllowsInsecureHTTPLoads'], true);
});
