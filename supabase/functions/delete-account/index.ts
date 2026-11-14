// Lets a signed-in user delete their own account. Deploy with: supabase functions deploy delete-account
// The service role key is provided by Supabase to the function and never ships in the app.
Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, auth = req.headers.get("Authorization") ?? "";
  const me = await fetch(`${url}/auth/v1/user`, { headers: { apikey: service, Authorization: auth } });
  if (!me.ok) return new Response("Unauthorized", { status: 401 });
  const { id } = await me.json();
  const del = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: service, Authorization: `Bearer ${service}` } });
  return new Response(del.ok ? "ok" : "failed", { status: del.ok ? 200 : 500 });
});
