// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // eslint-plugin-react's version auto-detection calls an API removed in ESLint 10
    settings: { react: { version: "19.2" } },
  },
  {
    ignores: ["dist/*"],
  }
]);
