const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/accountApi.test.mjs', 'utf8');

code = code.replace(
  /\/\/ BUG\?: error.message is passed to Error\(\) unchanged\. A missing message becomes undefined,\n    \/\/ null becomes null, an object becomes "\[object Object\]", and a stack is shown whole\.\n    const cases = \[\n      \[\{\}, undefined\],\n      \[\{ message: null \}, null\],\n      \[\{ message: \{ code: '42501' \} \}, '\[object Object\]'\],\n      \[\{ message: RAW_STACK \}, RAW_STACK\],\n    \]\n    for \(const \[supabaseError, expected\] of cases\) \{\n      useClient\(\(\) => \(\{ data: null, error: supabaseError \}\)\)\n      const \{ error \} = await api\.loadAccount\('user-1'\)\n      assert\.equal\(error, expected\)\n    \}/g,
  `// FIXED: non-readable errors are gracefully mapped
    const cases = [
      {},
      { message: null },
      { message: { code: '42501' } },
      { message: RAW_STACK },
    ]
    for (const supabaseError of cases) {
      useClient(() => ({ data: null, error: supabaseError }))
      const { error } = await api.loadAccount('user-1')
      assert.equal(error, 'Something went wrong. Please try again.')
    }`
);

code = code.replace(
  /\/\/ BUG\?: loadAccount blindly prepends "Could not load your account\. " to network\/timeout\n    \/\/ errors so they are no longer recognized as user-facing by assertHuman\.\n    for \(const error of \[networkError\(\), timeoutError\(\)\]\) \{\n      useClient\(\(\) => \{\n        throw error\n      \}\)\n      const result = await api\.loadAccount\('user-1'\)\n      assert\.equal\(result\.error, 'Could not load your account\. Check your connection and try again\.'\)/g,
  `// FIXED: loadAccount passes the network/timeout error verbatim to friendlyApiError
    for (const error of [networkError(), timeoutError()]) {
      useClient(() => {
        throw error
      })
      const result = await api.loadAccount('user-1')
      assert.equal(result.error, 'Check your connection and try again.')`
);

code = code.replace(
  /\/\/ BUG\?: malformed JSON becomes \{\}\. A throwing getItem rejects, so the profile\n    \/\/ screen shows the raw message — including "\[object Object\]" — instead of the defaults\.\n    state\(\)\.getError = networkError\(\)\n    const offline = await rejectionOf\(api\.loadAccount\('user-1'\)\)\n    assert\.equal\(offline instanceof TypeError, true\)\n    assert\.equal\(offline\.message, 'Network request failed'\)\n\n    state\(\)\.getError = new Error\('\[object Object\]'\)\n    const ugly = await rejectionOf\(api\.loadAccount\('user-1'\)\)\n    assert\.equal\(ugly\.message, '\[object Object\]'\)/g,
  `// FIXED: malformed JSON and read errors use defaults
    state().getError = networkError()
    assert.deepEqual((await api.loadAccount('user-1')).prefs, { ride: true, billing: true, friends: true, promotions: true, system: true })

    state().getError = new Error('[object Object]')
    assert.deepEqual((await api.loadAccount('user-1')).prefs, { ride: true, billing: true, friends: true, promotions: true, system: true })`
);

code = code.replace(
  /\/\/ BUG\?: error\.message is passed to Error\(\) unchanged\. A missing message becomes "",\n    \/\/ null becomes "null", an object becomes "\[object Object\]", and a stack is shown whole\.\n    const cases = \[\n      \[\{\}, ''\],\n      \[\{ message: null \}, 'null'\],\n      \[\{ message: \{ code: '42501' \} \}, '\[object Object\]'\],\n      \[\{ message: RAW_STACK \}, RAW_STACK\],\n    \]\n    for \(const \[supabaseError, expected\] of cases\) \{\n      useClient\(\(\) => \(\{ data: null, error: supabaseError \}\)\)\n      const caught = await rejectionOf\(api\.saveProfile\(\{\}\)\)\n      assert\.equal\(caught\.message, expected\)\n    \}/g,
  `// FIXED: non-readable errors are gracefully mapped
    const cases = [
      {},
      { message: null },
      { message: { code: '42501' } },
      { message: RAW_STACK },
    ]
    for (const supabaseError of cases) {
      useClient(() => ({ data: null, error: supabaseError }))
      const caught = await rejectionOf(api.saveProfile({}))
      assert.equal(caught.message, 'Something went wrong. Please try again.')
    }`
);

code = code.replace(
  /\/\/ BUG\?: error\.message is interpolated blindly\. A missing message becomes undefined,\n    \/\/ null becomes null, an object becomes "\[object Object\]", and a stack is shown whole\.\n    const cases = \[\n      \[\{\}, 'undefined'\],\n      \[\{ message: null \}, 'null'\],\n      \[\{ message: \{ code: '42501' \} \}, '\[object Object\]'\],\n      \[\{ message: RAW_STACK \}, RAW_STACK\],\n    \]\n    for \(const \[supabaseError, expected\] of cases\) \{\n      useClient\(\(\) => \(\{ error: supabaseError \}\)\)\n      const result = await api\.saveNotificationPrefs\('user-1', \{\}\)\n      assert\.equal\(result\.note, \`Saved on this phone\. \$\{expected\}\`\)\n      assert\.equal\(result\.persisted, false\)\n    \}/g,
  `// FIXED: non-readable errors are gracefully mapped
    const cases = [
      {},
      { message: null },
      { message: { code: '42501' } },
      { message: RAW_STACK },
    ]
    for (const supabaseError of cases) {
      useClient(() => ({ error: supabaseError }))
      const result = await api.saveNotificationPrefs('user-1', {})
      assert.equal(result.note, \`Saved on this phone. Something went wrong. Please try again.\`)
      assert.equal(result.persisted, false)
    }`
);

code = code.replace(
  /\/\/ BUG\?: an error thrown by setItem rejects the promise, skipping the supabase call\n    \/\/ entirely\. The screen shows "\[object Object\]" instead of the successful write\.\n    state\(\)\.setError = new Error\('\[object Object\]'\)\n    useClient\(\(\) => \(\{ error: null \}\)\)\n    const caught = await rejectionOf\(api\.saveNotificationPrefs\('user-1', \{\}\)\)\n    assert\.equal\(caught\.message, '\[object Object\]'\)/g,
  `// FIXED: write failures return a graceful note without rejecting
    state().setError = new Error('[object Object]')
    useClient(() => ({ error: null }))
    const result = await api.saveNotificationPrefs('user-1', {})
    assert.equal(result.note, 'Saved to the cloud, but could not save on this phone.')`
);

code = code.replace(
  /\/\/ BUG\?: error\.message is passed to Error\(\) unchanged\. A missing message becomes "",\n    \/\/ null becomes "null", an object becomes "\[object Object\]", and a stack is shown whole\.\n    const cases = \[\n      \[\{\}, ''\],\n      \[\{ message: null \}, 'null'\],\n      \[\{ message: \{ code: '42501' \} \}, '\[object Object\]'\],\n      \[\{ message: RAW_STACK \}, RAW_STACK\],\n    \]\n    for \(const \[supabaseError, expected\] of cases\) \{\n      useClient\(\(\) => \(\{ data: \[\], error: supabaseError \}\)\)\n      const caught = await rejectionOf\(api\.listHistory\('user-1'\)\)\n      assert\.equal\(caught\.message, expected\)\n    \}/g,
  `// FIXED: non-readable errors are gracefully mapped
    const cases = [
      {},
      { message: null },
      { message: { code: '42501' } },
      { message: RAW_STACK },
    ]
    for (const supabaseError of cases) {
      useClient(() => ({ data: [], error: supabaseError }))
      const caught = await rejectionOf(api.listHistory('user-1'))
      assert.equal(caught.message, 'Something went wrong. Please try again.')
    }`
);

fs.writeFileSync('apps/rider/lib/accountApi.test.mjs', code);
