import type { ConfigContext, ExpoConfig } from 'expo/config';
import { validateReleaseEnvironment } from './scripts/release-config';

/** Validate store configuration and keep local HTTP exceptions out of release builds. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const isProduction = process.env.EAS_BUILD_PROFILE === 'production';
  if (isProduction) validateReleaseEnvironment(process.env);
  const ios = { ...config.ios };
  const infoPlist = { ...ios.infoPlist };

  if (isProduction || process.env.NODE_ENV === 'production') {
    // Explicitly replace dev exceptions even when prebuild reuses an existing native project.
    infoPlist.NSAppTransportSecurity = {
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: false,
      NSExceptionDomains: {},
    };
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
