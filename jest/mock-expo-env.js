// babel-preset-expo rewrites `process.env.EXPO_PUBLIC_*` reads into an import of
// `expo/virtual/env` (ESM). Under the no-preset jest config that file is not
// transformed, so map it to this CommonJS shim.
module.exports = { env: process.env };
