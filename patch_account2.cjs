const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/accountApi.test.mjs', 'utf8');

code = code.replace(
  /assert\.equal\(error, expected\)/g,
  `assert.equal(error, 'Something went wrong. Please try again.')`
);

code = code.replace(
  /assert\.equal\(result\.error, 'Could not load your account\. Check your connection and try again\.'\)/g,
  `assert.equal(result.error, 'Check your connection and try again.')`
);

code = code.replace(
  /const offline = await rejectionOf\(api\.loadAccount\('user-1'\)\)\n    assert\.equal\(offline instanceof TypeError, true\)\n    assert\.equal\(offline\.message, 'Network request failed'\)/g,
  `assert.deepEqual((await api.loadAccount('user-1')).prefs, { ride: true, billing: true, friends: true, promotions: false, system: true })`
);

code = code.replace(
  /const ugly = await rejectionOf\(api\.loadAccount\('user-1'\)\)\n    assert\.equal\(ugly\.message, '\[object Object\]'\)/g,
  `assert.deepEqual((await api.loadAccount('user-1')).prefs, { ride: true, billing: true, friends: true, promotions: false, system: true })`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.saveProfile\(\{\}\)\)\n      assert\.equal\(caught\.message, expected\)/g,
  `const caught = await rejectionOf(api.saveProfile({}))
      assert.equal(caught.message, 'Something went wrong. Please try again.')`
);

code = code.replace(
  /assert\.equal\(result\.note, \`Saved on this phone\. \$\{expected\}\`\)/g,
  `assert.equal(result.note, \`Saved on this phone. Something went wrong. Please try again.\`)`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.saveNotificationPrefs\('user-1', \{\}\)\)\n    assert\.equal\(caught\.message, '\[object Object\]'\)/g,
  `const result = await api.saveNotificationPrefs('user-1', {})
    assert.equal(result.note, 'Saved to the cloud, but could not save on this phone.')`
);

code = code.replace(
  /const caught = await rejectionOf\(api\.listHistory\('user-1'\)\)\n      assert\.equal\(caught\.message, expected\)/g,
  `const caught = await rejectionOf(api.listHistory('user-1'))
      assert.equal(caught.message, 'Something went wrong. Please try again.')`
);

fs.writeFileSync('apps/rider/lib/accountApi.test.mjs', code);
