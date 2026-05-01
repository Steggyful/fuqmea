import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

type SettlePayload = {
  game?: string;
  detail?: string;
  delta?: number;
  coin_streak?: number;
  last_daily?: string;
  /** Client-reported Aura Farm multiplier this round (clamped server-side). */
  crash_peak_mult?: number;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function allowedDeltaForGame(game: string): { min: number; max: number } | null {
  const g = game.toLowerCase();
  if (g === 'coin' || g === 'rps' || g === 'slots' || g === 'bj' || g === 'crash') return { min: -250, max: 600 };
  if (g === 'daily') return { min: 0, max: 60 };
  if (g === 'quest' || g === 'quest_weekly') return { min: 0, max: 250 };
  if (g === 'rakeback') return { min: 0, max: 2000 };
  if (g === 'reset') return { min: -5000, max: 0 };
  return null;
}

/** Hosted Edge Functions expose publishable keys as JSON (new); legacy anon JWT may still be set. */
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

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

  let payload: SettlePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const game = String(payload.game || '').trim().slice(0, 24);
  const detail = String(payload.detail || '').trim().slice(0, 160);
  const delta = Number.isFinite(payload.delta) ? Math.trunc(Number(payload.delta)) : NaN;

  if (!game || !Number.isFinite(delta)) {
    return new Response(JSON.stringify({ error: 'Missing valid game or delta' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const bounds = allowedDeltaForGame(game);
  if (!bounds) {
    return new Response(JSON.stringify({ error: 'Unsupported game key' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (delta < bounds.min || delta > bounds.max) {
    return new Response(JSON.stringify({ error: 'Delta is out of allowed range for this game type' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const gKey = game.toLowerCase();

  /** Optional wallet fields — validated per game before RPC */
  type RpcArgs = {
    p_game: string;
    p_detail: string;
    p_delta: number;
    p_coin_streak?: number;
    p_last_daily?: string;
    p_crash_peak?: number;
  };
  const rpcArgs: RpcArgs = { p_game: game, p_detail: detail, p_delta: delta };

  if (gKey === 'coin' && payload.coin_streak != null && Number.isFinite(Number(payload.coin_streak))) {
    const cs = Math.trunc(Number(payload.coin_streak));
    if (cs >= 0 && cs <= 500_000) rpcArgs.p_coin_streak = cs;
  }

  if (gKey === 'daily' && typeof payload.last_daily === 'string') {
    const ld = payload.last_daily.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ld)) rpcArgs.p_last_daily = ld;
  }

  if (
    gKey === 'crash' &&
    payload.crash_peak_mult != null &&
    Number.isFinite(Number(payload.crash_peak_mult))
  ) {
    const pm = Number(payload.crash_peak_mult);
    rpcArgs.p_crash_peak = Math.round(Math.min(Math.max(pm, 1), 89) * 100) / 100;
  }

  const { data, error } = await client.rpc('apply_settlement', rpcArgs);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    return new Response(JSON.stringify({ error: 'No settlement row returned' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      wallet: {
        tokens: Number(row.tokens) || 0,
        coinStreak: Number(row.coin_streak) || 0,
        lastDaily: row.last_daily || ''
      },
      eventId: row.event_id || null
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  );
});
