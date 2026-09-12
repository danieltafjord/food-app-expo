/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // React Native defines this at runtime; app code branches on it.
  globals: { __DEV__: true },
  // Transform app + Legend-State (ESM) via Babel; everything else in node_modules
  // is left as-is. No jest-expo preset — these are pure-logic tests and the preset
  // drags in Expo's winter runtime, which fights jest's module sandbox.
  transform: {
    '^.+\\.[cm]?[jt]sx?$': [
      'babel-jest',
      { configFile: false, babelrc: false, presets: ['babel-preset-expo'] },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(?:@legendapp)/)'],
  // Mirror the tsconfig path aliases, and stub the few native modules these
  // pure functions transitively import (but never meaningfully exercise).
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.css$': '<rootDir>/jest/empty.js',
    '^expo-crypto$': '<rootDir>/jest/mock-expo-crypto.js',
    '^expo-localization$': '<rootDir>/jest/mock-expo-localization.js',
    '^expo/virtual/env$': '<rootDir>/jest/mock-expo-env.js',
  },
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
};
