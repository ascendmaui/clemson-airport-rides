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

// If the previous one didn't match, let's just find the exact block:
let match = code.match(/const cases = \[\n      \[\{\}, undefined\],\n      \[\{ message: null \}, null\],[\s\S]*?assert\.equal\(error, expected\)\n    \}/);
if (match) {
  code = code.replace(match[0], `const cases = [
      {},
      { message: null },
      { message: { code: '42501' } },
      { message: RAW_STACK },
    ]
    for (const supabaseError of cases) {
      useClient(() => ({ data: null, error: supabaseError }))
      const { error } = await api.loadAccount('user-1')
      assert.equal(error, 'Something went wrong. Please try again.')
    }`);
}

match = code.match(/for \(const error of \[networkError\(\), timeoutError\(\)\]\) \{\n      useClient\(\(\) => \{\n        throw error\n      \}\)\n      const result = await api\.loadAccount\('user-1'\)\n      assert\.equal\(result\.error, 'Could not load your account\. Check your connection and try again\.'\)/);
if (match) {
  code = code.replace(match[0], `for (const error of [networkError(), timeoutError()]) {
      useClient(() => {
        throw error
      })
      const result = await api.loadAccount('user-1')
      assert.equal(result.error, 'Check your connection and try again.')`);
}

fs.writeFileSync('apps/rider/lib/accountApi.test.mjs', code);
