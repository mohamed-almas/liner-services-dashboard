import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://jeuqpnhajmatekbzlfne.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpldXFwbmhham1hdGVrYnpsZm5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDQ5NzAsImV4cCI6MjEwMDcyMDk3MH0.hVnlLdqq7NrdLjDok1vBvZ901eFsIbTJ3_VG_kPMsXo'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
