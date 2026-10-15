import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
    'https://jbrpleyrkdgnrmfakdyk.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    'sb_publishable_qJDyIefA2HfQINPaCHNl9Q_ZeTzcXPg',
);
