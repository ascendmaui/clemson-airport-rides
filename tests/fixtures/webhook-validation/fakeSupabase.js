/**
 * Test-only stand-in for @supabase/supabase-js.
 * createClient throws so a webhook instance under test cannot open a real client.
 */
export function createClient() {
  throw new Error('webhook-validation fixture blocked createClient')
}
