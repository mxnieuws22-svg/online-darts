// Verstuurt e-mails voor openstaande meldingen (nieuwe wedstrijd ingepland,
// nieuwe wedstrijd beschikbaar, alles rond een speelmoment-voorstel:
// voorgesteld/geaccepteerd/tegenvoorstel/probleem/ingetrokken, een speler
// die zijn onboarding-profiel heeft ingevuld, een herinnering aan spelers
// die dat nog niet hebben gedaan, een speler die in een divisie is
// ingedeeld, een vrij bericht van de organisator aan gekozen spelers, en
// een herinnering voor een al langer beschikbare maar nog niet gespeelde
// wedstrijd) via het eigen Gmail-account van de organisator. Wordt elke 5
// minuten aangeroepen door een pg_cron-job (zie supabase/schema.sql,
// sectie 20/21), niet rechtstreeks door de app.
//
// Vereiste secrets (Project Settings -> Edge Functions -> Secrets):
//   GMAIL_USER           je Gmail-adres
//   GMAIL_APP_PASSWORD   een app-wachtwoord (myaccount.google.com/apppasswords)
//   CRON_SECRET          een willekeurige, geheime tekenreeks - moet exact
//                        overeenkomen met de waarde in de cron-job hieronder
//
// Deze functie is bewust gedeployed met verify_jwt=false (de aanroep komt
// van pg_cron, niet van een ingelogde gebruiker) en controleert in plaats
// daarvan zelf de x-cron-secret header.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPassword) {
    return new Response(
      JSON.stringify({ error: "GMAIL_USER/GMAIL_APP_PASSWORD zijn niet ingesteld." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending, error } = await supabase
    .from("notifications")
    .select("id, player_id, type, title, body")
    .in("type", [
      "match_scheduled",
      "match_available",
      "match_schedule_proposed",
      "match_schedule_accepted",
      "match_schedule_countered",
      "match_schedule_disputed",
      "match_schedule_withdrawn",
      "player_onboarding_completed",
      "onboarding_reminder",
      "division_assigned",
      "organizer_message",
      "match_reminder",
    ])
    .is("email_sent_at", null)
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPassword },
    },
  });

  let sent = 0;
  const errors: string[] = [];

  for (const n of pending) {
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(n.player_id);
    const email = userData?.user?.email;
    if (userError || !email) {
      errors.push(`${n.id}: geen e-mailadres gevonden`);
      continue;
    }
    try {
      await client.send({
        from: gmailUser,
        to: email,
        subject: n.title,
        content: n.body || n.title,
      });
      await supabase
        .from("notifications")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", n.id);
      sent++;
    } catch (e) {
      errors.push(`${n.id}: ${String(e)}`);
    }
  }

  try {
    await client.close();
  } catch {
    // Sluiten van de SMTP-verbinding hoeft de aanroep niet te laten falen.
  }

  return new Response(JSON.stringify({ sent, errors }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
