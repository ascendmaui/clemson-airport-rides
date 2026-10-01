import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

mock.module('./friendRideLib.js', {
  namedExports: {
    admin: () => 'mock_admin',
    userFromAuth: async () => ({ id: 'mock_user' }),
  }
})

test('module mocking works', async () => {
  const lib = await import('./friendRideLib.js')
  assert.equal(lib.admin(), 'mock_admin')
})
