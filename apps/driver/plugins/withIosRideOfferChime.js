const { copyFileSync } = require('fs')
const { basename, resolve } = require('path')
const { IOSConfig, withXcodeProject } = require('expo/config-plugins')

const RELATIVE_SOUND = 'assets/sounds/ride_offer_chime.caf'

/**
 * Copies the ride-offer CAF into the iOS app bundle only.
 * The WAV is bundled for both platforms by the expo-notifications plugin.
 * This plugin does not copy the CAF into the Android project. A second file
 * with the same basename would collide on the Android resource name.
 */
function withIosRideOfferChime(config) {
  return withXcodeProject(config, (mod) => {
    const { projectRoot, projectName } = mod.modRequest
    if (!projectName) {
      throw new Error('withIosRideOfferChime: unable to find the iOS project name.')
    }
    const project = mod.modResults
    const fileName = basename(RELATIVE_SOUND)
    const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot)
    copyFileSync(resolve(projectRoot, RELATIVE_SOUND), resolve(sourceRoot, fileName))
    const projectPath = `${projectName}/${fileName}`
    if (!project.hasFile(projectPath)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: projectPath,
        groupName: projectName,
        isBuildFile: true,
        project,
      })
    }
    return mod
  })
}

module.exports = withIosRideOfferChime
