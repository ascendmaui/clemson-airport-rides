const { getDefaultConfig } = require('expo/metro-config')
const fs = require('fs')
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

// Hierarchical lookup is disabled so the app pins React and Expo. That also
// hides nested copies, so `semver/functions/*` from Reanimated resolves to the
// hoisted semver 6 package, which has no subpath files. Walk from the importer
// to the nested semver 7 it actually depends on.
function nestedSemverSubpath(originModulePath, moduleName) {
  if (!originModulePath || !moduleName.startsWith('semver/')) return null
  const subpath = moduleName.slice('semver/'.length)
  let dir = path.dirname(originModulePath)
  while (dir === projectRoot || dir.startsWith(`${projectRoot}${path.sep}`)) {
    const base = path.join(dir, 'node_modules', 'semver', subpath)
    for (const file of [`${base}.js`, `${base}.json`, path.join(base, 'index.js'), base]) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo/virtual/env') {
    return { type: 'sourceFile', filePath: virtualEnv }
  }
  const semverFile = nestedSemverSubpath(context.originModulePath, moduleName)
  if (semverFile) return { type: 'sourceFile', filePath: semverFile }
  if (defaultResolve) return defaultResolve(context, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
