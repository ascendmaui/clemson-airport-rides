const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '../..')
const sharedRoot = path.resolve(repoRoot, 'packages/rides-native')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [sharedRoot, path.join(repoRoot, 'src'), path.join(repoRoot, 'server')]
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'expo-secure-store': path.resolve(projectRoot, 'node_modules/expo-secure-store'),
  'rides-native': sharedRoot,
}

module.exports = config
