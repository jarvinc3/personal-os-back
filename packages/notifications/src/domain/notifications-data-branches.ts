import { DATA_APP, type DataBranchDescriptor } from '@personal-os/users';

/** Notification history and push tokens are wiped separately. */
export const NOTIFICATIONS_DATA_BRANCHES: readonly DataBranchDescriptor[] = [
  {
    id: 'notifications.history',
    app: DATA_APP.NOTIFICATIONS,
    label: 'Historial de notificaciones',
    includes: [],
    order: 1,
  },
  {
    id: 'notifications.pushTokens',
    app: DATA_APP.NOTIFICATIONS,
    label: 'Tokens push',
    includes: [],
    order: 2,
  },
];
