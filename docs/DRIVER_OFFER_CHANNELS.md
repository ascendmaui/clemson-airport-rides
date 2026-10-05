# Driver-offer SMS, email, and push

Push uses the stored Expo token. The server posts to Expo only when `EXPO_ACCESS_TOKEN` is set. A locked, asleep, or signed-out phone shows that as a system notification. iOS delivery also needs an APNs key on the Expo project, and Android needs FCM credentials there. This server cannot see those keys. Until both the access token and the platform credentials exist, the client still shows an in-app alert with sound and vibration while the driver is online and the app is open.

# Driver-offer SMS and email

Both out-of-app offer channels are disabled by default. Set exactly `DRIVER_OFFER_ALERT_SMS=send` or `DRIVER_OFFER_ALERT_EMAIL=send` to enable their respective delivery. SMS additionally needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`. Email needs `RESEND_API_KEY` and `RESEND_FROM`.

`DRIVER_OFFER_ALERT_SMS_MAX_PER_HOUR` and `DRIVER_OFFER_ALERT_EMAIL_MAX_PER_HOUR` cap sends per driver/channel (default `6`). Drivers can opt out per channel with `profiles.notification_prefs.offer_sms = false` and/or `offer_email = false`; the existing `ride = false` and quiet-hours preferences suppress both channels too. Delivery claims and outcomes are stored in `driver_offer_alert_attempts`; phone numbers and credentials are never stored there.
