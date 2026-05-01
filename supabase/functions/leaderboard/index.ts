import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

type Body = {
  scope?: string;
  limit?: number;
};

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

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const scope = String(payload.scope || 'alltime').toLowerCase();
  const rawLim = payload.limit != null ? Number(payload.limit) : 25;
  const lim = Math.min(100, Math.max(1, Number.isFinite(rawLim) ? Math.trunc(rawLim) : 25));

  const client = createClient(supabaseUrl, anonKey);
  let data: unknown;
  let error: { message?: string } | null = null;

  if (scope === 'weekly') {
    const r = await client.rpc('leaderboard_weekly_rows', { p_limit: lim });
    data = r.data;
    error = r.error;
  } else {
    const r = await client.rpc('leaderboard_all_time_rows', { p_limit: lim });
    data = r.data;
    error = r.error;
  }

  if (error) {
    return new Response(JSON.stringify({ error: error.message || 'RPC failed' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const rows = Array.isArray(data) ? data : [];
  return new Response(JSON.stringify({ ok: true, scope: scope === 'weekly' ? 'weekly' : 'alltime', rows }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
