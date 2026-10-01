const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/accountApi.ts', 'utf8');

code = code.replace(
  /  if \(\!queried \|\| queried\.error\) \{\n    const raw = queried\?\.error\?\.message\n    const msg = friendlyApiError\(queried\?\.error\?\.code \?\? \(queried\?\.error\?\.name === 'TypeError' \|\| raw === 'Request timed out' \? 0 : 400\), raw\)\.message\n    return \{\n      profile: null as RiderProfile \| null,\n      prefs: localPrefs,\n      error: raw \? msg : 'Could not load your account\. Check your connection and try again\.',\n    \}\n  \}\n  const \{ data, error \} = queried\n  if \(error\) return \{ profile: null as RiderProfile \| null, prefs: localPrefs, error: friendlyApiError\(error\.code \?\? 400, error\.message\)\.message \}/,
  `  if (!queried) return { profile: null as RiderProfile | null, prefs: localPrefs, error: 'Could not load your account. Check your connection and try again.' }
  const { data, error } = queried
  if (error) return { profile: null as RiderProfile | null, prefs: localPrefs, error: friendlyApiError(error.code ?? (error.name === 'TypeError' || error.message === 'Request timed out' ? 0 : 400), error.message).message }`
);
fs.writeFileSync('apps/rider/lib/accountApi.ts', code);
