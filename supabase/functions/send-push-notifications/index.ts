// Verstuurt pushmeldingen (Web Push) voor openstaande meldingen naar elk
// toestel waarop een speler pushmeldingen heeft ingeschakeld - alle types
// die ook in-app en (voor de meeste) per mail gemeld worden: wedstrijd
// ingepland/beschikbaar, alles rond een speelmoment-voorstel, een speler
// die is ingedeeld of zijn onboarding heeft afgerond (of daaraan
// herinnerd wordt), een vrij bericht van de organisator, een
// wedstrijdherinnering, het seizoensoverzicht, en - als enige twee types
// die bewust NIET per mail gaan (zie send-pending-emails, om spam per
// bericht te voorkomen) - een nieuw wedstrijdchat- of privébericht, juist
// omdat een pop-up daar wel het geschikte kanaal voor is. Wordt elke 5
// minuten aangeroepen door een pg_cron-job (zie supabase/schema.sql,
// sectie 21), niet rechtstreeks door de app.
//
// Vereiste secrets (Project Settings -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   sleutelpaar specifiek voor Web
//                                          Push (geen provider-account nodig)
//   CRON_SECRET                            zelfde gedeeld geheim als
//                                          send-pending-emails
//   GMAIL_USER                             optioneel, gebruikt als
//                                          contactadres in de VAPID-header
//
// Bewust gedeployed met verify_jwt=false (de aanroep komt van pg_cron, geen
// ingelogde gebruiker) en controleert in plaats daarvan zelf de
// x-cron-secret header.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const NOTIFY_TYPES = [
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
  "season_recap",
  "direct_message",
  "match_chat_message",
];

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPublicKey || !vapidPrivateKey) {
    return new Response(
      JSON.stringify({ error: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY zijn niet ingesteld." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const contactEmail = Deno.env.get("GMAIL_USER") || "admin@example.com";
  webpush.setVapidDetails(`mailto:${contactEmail}`, vapidPublicKey, vapidPrivateKey);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending, error } = await supabase
    .from("notifications")
    .select("id, player_id, type, title, body")
    .in("type", NOTIFY_TYPES)
    .is("push_sent_at", null)
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

  let sent = 0;
  const errors: string[] = [];

  for (const n of pending) {
    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("player_id", n.player_id);

    if (subsError) {
      errors.push(`${n.id}: ${subsError.message}`);
      continue;
    }

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: n.title, body: n.body }),
        );
      } catch (e) {
        const statusCode = (e as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Abonnement niet meer geldig (toestel/browser heeft het ingetrokken).
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          errors.push(`${n.id}/${sub.id}: ${String(e)}`);
        }
      }
    }

    await supabase
      .from("notifications")
      .update({ push_sent_at: new Date().toISOString() })
      .eq("id", n.id);
    sent++;
  }

  return new Response(JSON.stringify({ sent, errors }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
