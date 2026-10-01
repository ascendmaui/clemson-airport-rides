/**
 * WAI-ARIA compliant tab navigation helpers:
 * Implements roving tabindex, arrow-key cycling (ArrowLeft, ArrowRight, Home, End),
 * and proper ARIA controls/labelledby linkage for tablists and tabpanels.
 */

/**
 * Generates ARIA props for a tab element in a tablist.
 */
export function getTabProps(tabId, selectedTabId, options = {}) {
  const isSelected = tabId === selectedTabId
  const tabPrefix = options.tabPrefix || 'tab'
  const panelPrefix = options.panelPrefix || 'tabpanel'

  return {
    id: `${tabPrefix}-${tabId}`,
    role: 'tab',
    'aria-selected': isSelected,
    'aria-controls': `${panelPrefix}-${tabId}`,
    tabIndex: isSelected ? 0 : -1,
  }
}

/**
 * Generates ARIA props for a tabpanel element.
 */
export function getTabPanelProps(tabId, options = {}) {
  const tabPrefix = options.tabPrefix || 'tab'
  const panelPrefix = options.panelPrefix || 'tabpanel'

  return {
    id: `${panelPrefix}-${tabId}`,
    role: 'tabpanel',
    'aria-labelledby': `${tabPrefix}-${tabId}`,
    tabIndex: 0,
  }
}

/**
 * Keydown handler for tablists following the WAI-ARIA Tabs pattern.
 * Supports ArrowRight/ArrowDown (next), ArrowLeft/ArrowUp (previous),
 * Home (first), and End (last) with circular wrapping.
 */
export function handleTabListKeyDown(event, tabs, currentTabId, onSelectTab) {
  if (!Array.isArray(tabs) || tabs.length === 0) return

  const currentIndex = tabs.findIndex((t) => (t.id || t) === currentTabId)
  if (currentIndex === -1) return

  let targetIndex = -1

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      targetIndex = (currentIndex + 1) % tabs.length
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      targetIndex = (currentIndex - 1 + tabs.length) % tabs.length
      break
    case 'Home':
      targetIndex = 0
      break
    case 'End':
      targetIndex = tabs.length - 1
      break
    default:
      return
  }

  if (targetIndex !== -1 && targetIndex !== currentIndex) {
    event.preventDefault()
    const targetTab = tabs[targetIndex]
    const targetId = targetTab.id || targetTab
    onSelectTab?.(targetId)

    // Focus the target tab button if available in the DOM
    if (typeof document !== 'undefined') {
      const tabPrefix = 'tab'
      const targetElement = document.getElementById(`${tabPrefix}-${targetId}`)
      if (targetElement && typeof targetElement.focus === 'function') {
        targetElement.focus()
      }
    }
  }
}
