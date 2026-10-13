// babel-preset-expo appends react-native-worklets/plugin (Reanimated 4)
// at the end of its own plugin list when the package is installed.
// Config plugins run before presets, so listing the plugin here would
// transform too early and can also throw as a duplicate.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
  }
}
