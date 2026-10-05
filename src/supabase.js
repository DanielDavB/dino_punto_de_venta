import { createClient } from '../vendor/supabase.js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

// Los enlaces de los correos de Supabase (invitación, recuperar contraseña)
// llegan con datos en el #hash. Se leen antes de crear el cliente, que los borra.
const hash = new URLSearchParams(location.hash.slice(1))
export const enlace = {
  tipo: hash.get('type'), // 'invite' | 'recovery' | 'signup' | 'magiclink' | null
  error: hash.get('error_code'), // p. ej. 'otp_expired'
}
if (enlace.error) history.replaceState(null, '', location.pathname + location.search)

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
