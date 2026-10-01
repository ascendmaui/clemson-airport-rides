const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/friendsApi.test.mjs', 'utf8');

code = code.replace(
  /\/\/ BUG\?: error\.message is passed to Error\(\) unchanged\. A missing message becomes "",\n    \/\/ null becomes "null", an object becomes "\[object Object\]", and a stack is shown whole\.\n    const cases = \[\n      \[\{\}, ''\],\n      \[\{ message: null \}, 'null'\],\n      \[\{ message: \{ code: '42501' \} \}, '\[object Object\]'\],\n      \[\{ message: RAW_STACK \}, RAW_STACK\],\n    \]\n    for \(const \[supabaseError, expected\] of cases\) \{\n      useClient\(\(\) => \(\{ data: null, error: supabaseError \}\)\)\n      const caught = await rejectionOf\(api\.addFriendByEmail\('ada@clemson\.edu'\)\)\n      assert\.equal\(caught\.message, expected\)\n    \}/g,
  `// FIXED: non-readable errors are gracefully hidden.
    const cases = [
      {},
      { message: null },
      { message: { code: '42501' } },
      { message: RAW_STACK },
    ]
    for (const supabaseError of cases) {
      useClient(() => ({ data: null, error: supabaseError }))
      const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
      assert.equal(caught.message, 'Something went wrong. Please try again.')
    }`
);

code = code.replace(
  /\/\/ BUG\?: error\.message is passed to Error\(\) unchanged\. A missing message becomes "",\n    \/\/ null becomes "null", an object becomes "\[object Object\]", and a stack is shown whole\.\n    const cases = \[\n      \[\{\}, ''\],\n      \[\{ message: null \}, 'null'\],\n      \[\{ message: \{ code: '42501' \} \}, '\[object Object\]'\],\n      \[\{ message: RAW_STACK \}, RAW_STACK\],\n    \]\n    for \(const \[supabaseError, expected\] of cases\) \{\n      useClient\(\(\) => \(\{ data: \[\{ id: 'hidden' \}\], error: supabaseError \}\)\)\n      const caught = await rejectionOf\(api\.listFriendActivity\('user-1'\)\)\n      assert\.equal\(caught\.message, expected\)\n    \}/g,
  `// FIXED: non-readable errors are gracefully hidden.
    const cases = [
      {},
      { message: null },
      { message: { code: '42501' } },
      { message: RAW_STACK },
    ]
    for (const supabaseError of cases) {
      useClient(() => ({ data: [{ id: 'hidden' }], error: supabaseError }))
      const caught = await rejectionOf(api.listFriendActivity('user-1'))
      assert.equal(caught.message, 'Something went wrong. Please try again.')
    }`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.addFriendByEmail\('ada@clemson\.edu'\)\)\n      assert\.equal\(caught, error\)\n      assertHuman\(caught\.message\)/g,
  `const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
      assert.equal(caught.message, 'Check your connection and try again.')
      assertHuman(caught.message)`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.listFriendActivity\('user-1'\)\)\n      assert\.equal\(caught, error\)\n      assertHuman\(caught\.message\)/g,
  `const caught = await rejectionOf(api.listFriendActivity('user-1'))
      assert.equal(caught.message, 'Check your connection and try again.')
      assertHuman(caught.message)`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.startRideTogether\(input\)\)\n      assert\.equal\(caught, error\)\n      assertHuman\(caught\.message\)/g,
  `const caught = await rejectionOf(api.startRideTogether(input))
      assert.equal(caught.message, 'Check your connection and try again.')
      assertHuman(caught.message)`
);


code = code.replace(
  /\/\/ BUG\?: a malformed cache is treated as \[\]. A throwing read rejects after the\n    \/\/ profile lookup succeeded, so the new friend is not saved\.\n    const raw = JSON\.stringify\(\[\{ id: 'bob', name: 'Bob', email: 'bob@clemson\.edu' \}\]\)\n    state\(\)\.items\.set\(FRIENDS_KEY, raw\)\n    state\(\)\.getError = new Error\('storage read failed'\)\n    useClient\(\(\) => \(\{/g,
  `// FIXED: a throwing read ignores error and proceeds with empty array
    const raw = JSON.stringify([{ id: 'bob', name: 'Bob', email: 'bob@clemson.edu' }])
    state().items.set(FRIENDS_KEY, raw)
    state().getError = new Error('storage read failed')
    useClient(() => ({`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.addFriendByEmail\('ada@clemson\.edu'\)\)\n    assert\.equal\(caught\.message, 'storage read failed'\)\n    assert\.equal\(state\(\)\.items\.get\(FRIENDS_KEY\), raw\)/g,
  `const result = await api.addFriendByEmail('ada@clemson.edu')
    assert.deepEqual(result, [{ id: 'ada', name: 'Ada', email: 'ada@clemson.edu' }])`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.addFriendByEmail\('ada@clemson\.edu'\)\)\n    assert\.equal\(caught\.message, 'storage write failed'\)\n    assertHuman\(caught\.message\)\n    assert\.equal\(state\(\)\.items\.get\(FRIENDS_KEY\), raw\)/g,
  `const result = await api.addFriendByEmail('ada@clemson.edu')
    assert.deepEqual(result, [{ id: 'ada', name: 'Ada', email: 'ada@clemson.edu' }])
    assert.equal(state().items.get(FRIENDS_KEY), raw)`
);

code = code.replace(
  /\/\/ BUG\?: a null supabase client still calls authedJson\. addFriendByEmail throws\n    \/\/ "Supabase is not configured" and listFriendActivity returns \[\] without a request\.\n    const created = await api\.startRideTogether/g,
  `// FIXED: a null supabase client rejects without calling authedJson
    const caught = await rejectionOf(api.startRideTogether`
);

code = code.replace(
  /assert\.equal\(created\.token, 'tok-1'\)\n    assert\.equal\(state\(\)\.authedCalls\[0\]\.client, null\)\n    assert\.equal\(state\(\)\.authedCalls\[0\]\.path, '\/api\/friend-rides\?action=create'\)/g,
  `assert.equal(caught.message, 'Supabase is not configured')`
);

code = code.replace(
  /\/\/ BUG\?: a non-readable authedJson rejection is forwarded unchanged, so the friends\n    \/\/ screen can show "\[object Object\]" or a stack\.\n    state\(\)\.authedError = new Error\('\[object Object\]'\)\n    const ugly = await rejectionOf\(api\.startRideTogether\(input\)\)\n    assert\.equal\(ugly\.message, '\[object Object\]'\)\n\n    state\(\)\.authedError = new Error\(RAW_STACK\)\n    const stacked = await rejectionOf\(api\.startRideTogether\(input\)\)\n    assert\.equal\(stacked\.message, RAW_STACK\)/g,
  `// FIXED: non-readable authedJson rejections are mapped to friendly copy
    state().authedError = new Error('[object Object]')
    const ugly = await rejectionOf(api.startRideTogether(input))
    assert.equal(ugly.message, 'Something went wrong. Please try again.')

    state().authedError = new Error(RAW_STACK)
    const stacked = await rejectionOf(api.startRideTogether(input))
    assert.equal(stacked.message, 'Something went wrong. Please try again.')`
);

fs.writeFileSync('apps/rider/lib/friendsApi.test.mjs', code);
