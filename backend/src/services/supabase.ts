import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'scan-images';
