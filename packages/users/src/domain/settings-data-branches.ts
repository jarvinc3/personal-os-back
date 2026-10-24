import { DATA_APP, type DataBranchDescriptor } from './data-branches';

/** Settings that go back to their defaults; the owner is the users package. */
export const SETTINGS_DATA_BRANCHES: readonly DataBranchDescriptor[] = [
  {
    id: 'settings.defaults',
    app: DATA_APP.SETTINGS,
    label: 'Configuración por defecto',
    includes: [],
    order: 1,
  },
];

export const SETTINGS_DEFAULTS_BRANCH = 'settings.defaults';
