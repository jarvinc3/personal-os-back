import { DATA_APP, type DataBranchDescriptor } from '@personal-os/users';

/** Chat data the assistant owns; its own branch, counted before wiping. */
export const AI_DATA_BRANCHES: readonly DataBranchDescriptor[] = [
  {
    id: 'ai.sessions',
    app: DATA_APP.AI,
    label: 'Conversaciones del asistente',
    includes: [],
    order: 1,
  },
];
