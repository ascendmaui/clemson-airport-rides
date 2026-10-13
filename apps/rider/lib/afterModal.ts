import { InteractionManager } from 'react-native'
import { createModalGate } from 'rides-native/afterModal.js'

const gate = createModalGate()

export function riderModalOpened() {
  gate.opened()
}

export function riderModalClosed() {
  gate.closed()
}

export function riderModalIsOpen() {
  return gate.isOpen()
}

/** Run after the match sheet has dismissed, then after the transition finishes. */
export function afterRiderModal(job: () => void) {
  gate.afterClose(() => {
    InteractionManager.runAfterInteractions(job)
  })
}
