// Makes the Jest globals (describe / it / expect / beforeEach / …) visible to
// `tsc` in *.test.ts files. The base Expo tsconfig uses `moduleResolution:
// bundler` with a `react-native` condition, under which @types/jest isn't
// auto-included; this triple-slash reference pulls its global declarations in
// without restricting `compilerOptions.types` (which would drop @types/react).
/// <reference types="jest" />
