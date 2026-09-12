import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic config layered over `app.json`.
 *
 * The only runtime decision: the iOS App Transport Security exception that lets
 * a dev build talk plain HTTP to the local Herd site (`food-app.test`). It must
 * not ship in the store build, so it is added for every profile except
 * `production` (EAS sets `EAS_BUILD_PROFILE`; local `expo run:ios` has none and
 * counts as development).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const isProduction = process.env.EAS_BUILD_PROFILE === 'production';
  const ios = { ...config.ios };
  const infoPlist = { ...ios.infoPlist };

  if (isProduction) {
    delete infoPlist.NSAppTransportSecurity;
  } else {
    infoPlist.NSAppTransportSecurity = {
      NSExceptionDomains: {
        'food-app.test': {
          NSExceptionAllowsInsecureHTTPLoads: true,
          NSIncludesSubdomains: true,
        },
      },
    };
  }

  return {
    ...config,
    name: config.name ?? 'Handlelista',
    slug: config.slug ?? 'handlelista',
    ios: { ...ios, infoPlist },
  };
};
