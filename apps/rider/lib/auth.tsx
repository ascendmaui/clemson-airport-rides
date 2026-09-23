import { createAuth } from 'rides-native/createAuth'
import { authStorage } from '@/lib/storage'
import { supabase, supabaseConfigured } from '@/lib/supabase'

const auth = createAuth({
  supabase,
  supabaseConfigured,
  storage: authStorage,
})

export const AuthProvider = auth.AuthProvider
export const useAuth = auth.useAuth
