# Build & blocker fixes log

Persistent knowledge base for recurring failures. When a matching issue appears, apply the saved fix first.

## 2026-09-24 — Driver EAS Bundle JS: Unable to resolve `expo-router` from `rides-native`

- **Track / machine:** Clemson RIDES Track 1 · Max; EAS iOS driver
- **Symptom:** EAS Bundle JavaScript failed with Unable to resolve module expo-router from packages/rides-native/PartyScreens.jsx (build e394dd9a)
- **Root cause:** Metro hierarchical lookup from the shared package missed apps/driver/node_modules (same for rider)
- **Fix:** In apps/driver/metro.config.js and apps/rider/metro.config.js: nodeModulesPaths → app node_modules, disableHierarchicalLookup = true, map expo-router in extraNodeModules
- **Commit:** 5d7ced3 on main
- **Reuse:** Any monorepo app failing to resolve a dep imported only from packages/* — apply this Metro pattern before retrying EAS

## 2026-09-24 — iMac Grok Build not signed in

- **Track / machine:** Pool · Johns-iMac.lan
- **Symptom:** grok 1.0.41 installed but not signed in
- **Root cause:** Fresh CLI install, no auth session
- **Fix:** grok login --device-code (or XAI_API_KEY), then restart Track Grok sessions
- **Reuse:** New machine after x.ai CLI install always needs login first
