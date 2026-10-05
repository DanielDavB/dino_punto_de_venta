import { createClient } from '../vendor/supabase.js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
