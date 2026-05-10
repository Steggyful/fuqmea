import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// Reads manual TikTok live toggle from DB (set via admin panel).
// Direct TikTok scraping is blocked server-side; DB is the source of truth.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username } = await req.json();
    if (!username || typeof username !== "string") {
      return new Response(JSON.stringify({ live: false }), { headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { data } = await supabase
      .from('streamer_live_status')
      .select('tiktok_live')
      .eq('username', username.toLowerCase().trim())
      .maybeSingle();

    return new Response(
      JSON.stringify({ live: data?.tiktok_live ?? false, viewers: null }),
      { headers: corsHeaders }
    );
  } catch (_e) {
    return new Response(JSON.stringify({ live: false }), { headers: corsHeaders });
  }
});
