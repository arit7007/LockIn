import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const DEFAULT_MODEL = "gpt-5.4-mini";

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

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return json({ error: "Server missing OPENAI_API_KEY." }, 500);
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

  const content: Record<string, unknown>[] = [{ type: "input_text", text: prompt }];
  if (body?.image?.data && body?.image?.mediaType) {
    content.unshift({
      type: "input_image",
      image_url: `data:${body.image.mediaType};base64,${body.image.data}`
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || DEFAULT_MODEL,
        input: [{ role: "user", content }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ error: data?.error?.message || "AI request failed." }, res.status);
    }

    const text = extractOutputText(data);
    if (!text) {
      return json({ error: "No text returned by the model." }, 502);
    }

    return json({ text });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unexpected server error." }, 500);
  }
});

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const items = Array.isArray(data?.output) ? data.output : [];
  const parts: string[] = [];
  items.forEach((item: any) => {
    if (item?.type !== "message" || !Array.isArray(item?.content)) return;
    item.content.forEach((c: any) => {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    });
  });
  return parts.join("\n").trim();
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}
