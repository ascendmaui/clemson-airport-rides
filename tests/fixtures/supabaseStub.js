
export let supabase = null;
export function setMockSupabase(client) { supabase = client; }
export function resetMockSupabase() { supabase = null; }
