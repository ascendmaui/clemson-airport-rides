const fs = require('fs');
let code = fs.readFileSync('apps/rider/lib/accountApi.test.mjs', 'utf8');

code = code.replace(/assert\.equal\(result\.error, supabaseError\.message\)\n      else assert\.equal\(result\.error, expected\)/g, "assert.equal(result.error, 'Something went wrong. Please try again.')");

code = code.replace(/const offlineCopy = 'Could not load your account\. Check your connection and try again\.'/g, "const offlineCopy = 'Check your connection and try again.'");

code = code.replace(/for \(const error of \[networkError\(\), timeoutError\(\), new Error\('\[object Object\]'\), new Error\(RAW_STACK\)\]\) \{/g, `for (const error of [networkError(), timeoutError(), new Error('[object Object]'), new Error(RAW_STACK)]) {`);

code = code.replace(/assert\.equal\(result\.error, offlineCopy\)\n      assertHuman\(result\.error\)/g, `assert.equal(result.error, error instanceof TypeError || error.message === 'Request timed out' ? 'Check your connection and try again.' : 'Something went wrong. Please try again.')\n      assertHuman(result.error)`);

fs.writeFileSync('apps/rider/lib/accountApi.test.mjs', code);
