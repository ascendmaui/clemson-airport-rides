const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/friendsApi.test.mjs', 'utf8');

code = code.replace(
  /\/\/ BUG\?: malformed JSON becomes \[\]. A throwing getItem rejects, so the friends\n    \/\/ screen shows the raw message — including "\[object Object\]" — instead of an empty list\.\n    state\(\)\.getError = networkError\(\)\n    const offline = await rejectionOf\(api\.loadSavedFriends\(\)\)\n    assert\.equal\(offline instanceof TypeError, true\)\n    assert\.equal\(offline\.message, 'Network request failed'\)\n\n    state\(\)\.getError = new Error\('\[object Object\]'\)\n    const ugly = await rejectionOf\(api\.loadSavedFriends\(\)\)\n    assert\.equal\(ugly\.message, '\[object Object\]'\)/g,
  `// FIXED: malformed JSON becomes []. A throwing getItem is ignored.
    state().getError = networkError()
    assert.deepEqual(await api.loadSavedFriends(), [])

    state().getError = new Error('[object Object]')
    assert.deepEqual(await api.loadSavedFriends(), [])`
);

code = code.replace(
  /\/\/ BUG\?: a malformed cache is treated as \[\]. A throwing read rejects after the\n    \/\/ profile lookup succeeded, so the new friend is not saved\.\n    const raw = JSON\.stringify\(\[\{ id: 'bob', name: 'Bob', email: 'bob@clemson\.edu' \}\]\)\n    state\(\)\.items\.set\(FRIENDS_KEY, raw\)\n    useClient\(\(\) => \(\{ data: \{ id: '12', full_name: 'Ana', email: 'ana@' \} \}\)\)\n\n    state\(\)\.getError = networkError\(\)\n    const offline = await rejectionOf\(api\.addFriendByEmail\('ana@'\)\)\n    assert\.equal\(offline instanceof TypeError, true\)\n    assert\.equal\(offline\.message, 'Network request failed'\)\n    assert\.equal\(state\(\)\.items\.get\(FRIENDS_KEY\), raw\)\n\n    state\(\)\.getError = new Error\('\[object Object\]'\)\n    const ugly = await rejectionOf\(api\.addFriendByEmail\('ana@'\)\)\n    assert\.equal\(ugly\.message, '\[object Object\]'\)/g,
  `// FIXED: a throwing read is treated as [] and overwritten with the new friend.
    const raw = JSON.stringify([{ id: 'bob', name: 'Bob', email: 'bob@clemson.edu' }])
    state().items.set(FRIENDS_KEY, raw)
    useClient(() => ({ data: { id: '12', full_name: 'Ana', email: 'ana@' } }))

    state().getError = networkError()
    const next = await api.addFriendByEmail('ana@')
    assert.deepEqual(next, [{ id: '12', name: 'Ana', email: 'ana@' }])`
);

fs.writeFileSync('apps/rider/lib/friendsApi.test.mjs', code);
