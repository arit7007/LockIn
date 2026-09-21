import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized." }, 401);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "Server missing ANTHROPIC_API_KEY." }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return json({ error: "Missing prompt." }, 400);
  }

  const content = [];
  if (body?.image?.data && body?.image?.mediaType) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: body.image.mediaType, data: body.image.data }
    });
  }
  content.push({ type: "text", text: prompt });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1800,
        messages: [{ role: "user", content }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ error: data?.error?.message || "AI request failed." }, res.status);
    }

    const text = Array.isArray(data?.content)
      ? data.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("")
      : "";
    if (!text) {
      return json({ error: "No text returned by the model." }, 502);
    }

    return json({ text });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unexpected server error." }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}
