const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '../..')
const sharedRoot = path.resolve(repoRoot, 'packages/rides-native')
const onboardingRoot = path.resolve(repoRoot, 'shared')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [sharedRoot, onboardingRoot, path.join(repoRoot, 'src'), path.join(repoRoot, 'server')]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.disableHierarchicalLookup = true
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'expo-secure-store': path.resolve(projectRoot, 'node_modules/expo-secure-store'),
  'expo-router': path.resolve(projectRoot, 'node_modules/expo-router'),
  'rides-native': sharedRoot,
}

const virtualEnv = path.resolve(projectRoot, 'node_modules/expo/virtual/env.js')
const defaultResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo/virtual/env') {
    return { type: 'sourceFile', filePath: virtualEnv }
  }
  if (defaultResolve) return defaultResolve(context, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
