import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
};

const hasKeys = 
  supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== 'YOUR_SUPABASE_URL' && 
  supabaseAnonKey !== 'YOUR_SUPABASE_ANON_KEY' &&
  isValidUrl(supabaseUrl);

if (!hasKeys) {
  console.warn(
    'Supabase URL or Anon Key is missing or invalid. App is running in Local Offline Sandbox mode. Please configure .env to connect to Supabase Cloud.'
  );
}

export const supabase = hasKeys ? createClient(supabaseUrl, supabaseAnonKey) : null;

