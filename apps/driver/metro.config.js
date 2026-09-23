const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '../../packages/rides-native')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [sharedRoot]
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'expo-secure-store': path.resolve(projectRoot, 'node_modules/expo-secure-store'),
  'rides-native': sharedRoot,
}

module.exports = config
