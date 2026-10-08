# Notifications — estado

Fecha: 2026-09-15

| Ítem | Estado | Evidencia |
| --- | --- | --- |
| REST IN_APP | `implemented` | controller + e2e |
| Push tokens + processors | `implemented` | specs |
| EMAIL Resend gated | `implemented` | `EMAIL_DELIVERY_ENABLED` |
| Finance listeners | `implemented` | `NotificationsEventsListener` |
| Copy en español + datos del movimiento | `implemented` | `domain/notification-copy.ts`, payload en `mappers.ts` |
| Sender FCM/APNs “real” aparte de Expo/VAPID | `planned` | docs web antiguas; no hay adapter extra — REV-BACK-007 |
