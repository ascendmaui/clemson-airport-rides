const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/friendsApi.test.mjs', 'utf8');
code = code.replace(
  /partyType: 'carpool',\n    }\)\n    assert\.equal\(caught\.message/g,
  `partyType: 'carpool',\n    }))\n    assert.equal(caught.message`
);
fs.writeFileSync('apps/rider/lib/friendsApi.test.mjs', code);
