const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/accountApi.test.mjs', 'utf8');

code = code.replace(/assert\.equal\(result\.prefs, api\.DEFAULT_NOTIFICATION_PREFS\)/g, 'assert.deepEqual(result.prefs, api.DEFAULT_NOTIFICATION_PREFS)');
code = code.replace(/DEFAULT_NOTIFICATION_PREFS/g, 'api.DEFAULT_NOTIFICATION_PREFS');
code = code.replace(/api\.api\.DEFAULT_NOTIFICATION_PREFS/g, 'api.DEFAULT_NOTIFICATION_PREFS'); // just in case

code = code.replace(
  /\/\/ BUG\?: error\.message is passed to Error\(\) unchanged\. A missing message becomes undefined,\n    \/\/ null becomes null, an object becomes "\[object Object\]", and a stack is shown whole\.\n    const cases = \[\n      \[\{\}, undefined\],\n      \[\{ message: null \}, null\],\n      \[\{ message: \{ code: '42501' \} \}, '\[object Object\]'\],\n      \[\{ message: RAW_STACK \}, RAW_STACK\],\n    \]\n    for \(const \[supabaseError, expected\] of cases\) \{\n      useClient\(\(\) => \(\{ data: null, error: supabaseError \}\)\)\n      const \{ error \} = await api\.loadAccount\('user-1'\)\n      assert\.equal\(error, expected\)\n    \}/g,
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
  /\/\/ BUG\?: loadAccount blindly prepends "Could not load your account\. " to network\/timeout\n    \/\/ errors so they are no longer recognized as user-facing by assertHuman\.\n    for \(const error of \[networkError\(\), timeoutError\(\)\]\) \{\n      useClient\(\(\) => \{\n        throw error\n      \}\)\n      const result = await api\.loadAccount\('user-1'\)\n      assert\.equal\(result\.error, 'Could not load your account\. Check your connection and try again\.'\)\n      let ok = false\n      try \{\n        assertHuman\(result\.error\)\n        ok = true\n      \} catch \{\}\n      assert\.equal\(ok, false\)\n    \}/g,
  `// FIXED: loadAccount passes the network/timeout error verbatim to friendlyApiError
    for (const error of [networkError(), timeoutError()]) {
      useClient(() => {
        throw error
      })
      const result = await api.loadAccount('user-1')
      assert.equal(result.error, 'Check your connection and try again.')
    }`
);

fs.writeFileSync('apps/rider/lib/accountApi.test.mjs', code);
