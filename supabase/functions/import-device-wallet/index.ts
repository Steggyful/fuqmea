import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function resolvePublishableKey(): string | undefined {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  if (legacy) return legacy;
  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, unknown>;
    const def = keys['default'];
    if (typeof def === 'string' && def.trim()) return def.trim();
    const entry = Object.values(keys).find((v) => typeof v === 'string' && String(v).trim());
    return entry ? String(entry).trim() : undefined;
  } catch {
    return undefined;
  }
}

type Body = {
  p_tokens?: number;
  p_coin_streak?: number;
  p_last_daily?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const anonKey = resolvePublishableKey();
  if (!supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase env vars' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const p_tokens = Math.max(0, Math.floor(Number(body.p_tokens)));
  const p_coin_streak = Math.max(0, Math.floor(Number(body.p_coin_streak)));
  const p_last_daily = typeof body.p_last_daily === 'string' ? body.p_last_daily.slice(0, 32) : '';

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: authData, error: authErr } = await client.auth.getUser();
  if (authErr || !authData.user) {
    return new Response(JSON.stringify({ error: 'Invalid session token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { data, error } = await client.rpc('import_initial_device_wallet', {
    p_tokens,
    p_coin_streak,
    p_last_daily
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return new Response(JSON.stringify({ error: 'No wallet returned' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ ok: true, wallet: row }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
