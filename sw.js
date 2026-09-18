// Service worker voor pushmeldingen. Bewust minimaal: geen offline-cache of
// andere PWA-features, alleen het tonen van een pushmelding en doorklikken
// naar de app. Wordt pas geregistreerd zodra een speler pushmeldingen
// inschakelt (zie enablePushNotifications() in js/app.js) - niet vooraf.

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* geen geldige JSON, val terug op lege data */ }

  const title = data.title || "Dart League";
  const options = {
    body: data.body || "",
    icon: "https://qspfphnailbelqmmzjbk.supabase.co/storage/v1/object/public/app-assets/favicon.png",
    badge: "https://qspfphnailbelqmmzjbk.supabase.co/storage/v1/object/public/app-assets/favicon.png",
    data: { url: "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
