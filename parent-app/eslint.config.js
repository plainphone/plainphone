// SPDX-License-Identifier: Apache-2.0
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  // eslint-plugin-react cannot detect the React version under ESLint 10; name it.
  { settings: { react: { version: "19.3" } } },
  {
    ignores: ["dist/*", "android/*", "ios/*", "src/api/schema.d.ts", "src/shared/**"],
  },
]);
