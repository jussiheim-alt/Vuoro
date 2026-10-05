// =====================================================================
// Vuoro frontend -konfiguraatio.
// =====================================================================

// Sama origin (Renderissa yksi palvelu) — override localStoragella tarvittaessa.
export const PROD_API_BASE = '/api';

export const API_BASE =
  (typeof localStorage !== 'undefined' && localStorage.getItem('vuoro_api')) ||
  PROD_API_BASE ||
  'http://localhost:8788/api';

// Oletustenantti (white-label). Tuotannossa yrityksen slug.
export const DEFAULT_ORG = 'trainwithmarjo';
