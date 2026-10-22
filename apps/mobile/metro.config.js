const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const upstream = config.resolver.resolveRequest;

// The shared packages are TypeScript sources that import siblings as "./x.js" (the NodeNext/vitest
// convention). Let Metro find "./x.ts" for those.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName.slice(0, -3), platform);
    } catch {
      /* fall through to the literal name */
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
