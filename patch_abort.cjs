const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/friendsApi.test.mjs', 'utf8');
code = code.replace(
  /\/\/ FIXED: a throwing read ignores error and proceeds with empty array\n    const raw = JSON\.stringify\(\[\{ id: 'bob', name: 'Bob', email: 'bob@clemson\.edu' \}\]\)\n    state\(\)\.items\.set\(FRIENDS_KEY, raw\)\n    state\(\)\.getError = new Error\('storage read failed'\)\n    useClient\(\(\) => \(\{\n      data: \{ id: 'ada', full_name: 'Ada', email: 'ada@clemson\.edu' \},\n      error: null,\n    \}\)\)\n    const result = await api\.addFriendByEmail\('ada@clemson\.edu'\)\n    assert\.deepEqual\(result, \[\{ id: 'ada', name: 'Ada', email: 'ada@clemson\.edu' \}, \{ id: 'bob', name: 'Bob', email: 'bob@clemson\.edu' \}\]\)/,
  `// FIXED: a throwing read ignores error and proceeds with empty array
    const raw = JSON.stringify([{ id: 'bob', name: 'Bob', email: 'bob@clemson.edu' }])
    state().items.set(FRIENDS_KEY, raw)
    state().getError = new Error('storage read failed')
    useClient(() => ({
      data: { id: 'ada', full_name: 'Ada', email: 'ada@clemson.edu' },
      error: null,
    }))
    const result = await api.addFriendByEmail('ada@clemson.edu')
    assert.deepEqual(result, [{ id: 'ada', name: 'Ada', email: 'ada@clemson.edu' }])`
);
fs.writeFileSync('apps/rider/lib/friendsApi.test.mjs', code);
