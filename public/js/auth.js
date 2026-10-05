// =====================================================================
// Auth-abstraktio. Kaksi tilaa, valikoituu firebase-config.js:n mukaan:
//  - TUOTANTO (apiKey täytetty): oikea Firebase Auth (sähköposti + salasana).
//    Token liitetään jokaiseen API-kutsuun (Authorization: Bearer ...).
//  - DEV (apiKey tyhjä): ei Firebasea. Imitoi käyttäjää X-Dev-User-Id
//    -otsakkeella (backend tukee tätä kun AUTH_DISABLED=true).
// =====================================================================
import { firebaseConfig } from './firebase-config.js';

// DEV-tila: kun Firebase-configia ei ole, TAI paikallinen lippu localStorage('vuoro_dev')==='1'.
// Lippu vaikuttaa vain selaimeen jossa se on asetettu → ei vaikuta tuotantoon.
export const DEV_MODE =
  !firebaseConfig ||
  !firebaseConfig.apiKey ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('vuoro_dev') === '1');

let fb = null; // { auth, m } kun Firebase ladattu
let currentUser = null; // Firebase user -objekti
const listeners = [];
export function onAuthChange(cb) { listeners.push(cb); }
function emit(uid) { listeners.forEach((cb) => cb(uid)); }

// Lupaus joka resolvoituu kun alkutila on tiedossa (Firebase tai dev).
let readyResolve;
export const authReady = new Promise((r) => (readyResolve = r));
function markReady() { if (readyResolve) { readyResolve(); readyResolve = null; } }

// --- DEV-imitointi ---
let devUserId = null;
export function setDevUserId(id) { devUserId = id || null; }
export function getDevUserId() { return devUserId; }
export function newDevUid() { return 'web-' + Math.random().toString(36).slice(2, 10); }

// --- Firebase-alustus (vain tuotannossa) ---
async function initFirebase() {
  const V = '10.12.5';
  const [{ initializeApp }, authMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  fb = { auth, m: authMod };
  authMod.onAuthStateChanged(auth, (u) => {
    currentUser = u;
    emit(u ? u.uid : null);
    markReady();
  });
}
if (!DEV_MODE) {
  initFirebase().catch((e) => { console.error('[auth] Firebase-alustus epäonnistui', e); markReady(); });
} else {
  markReady();
}

// --- Julkinen rajapinta ---
export async function getAuthHeaders() {
  if (DEV_MODE) return devUserId ? { 'X-Dev-User-Id': devUserId } : {};
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return { Authorization: 'Bearer ' + token };
  }
  return {};
}

export async function registerEmail(email, password) {
  const cred = await fb.m.createUserWithEmailAndPassword(fb.auth, email, password);
  return cred.user.uid;
}
export async function loginEmail(email, password) {
  await fb.m.signInWithEmailAndPassword(fb.auth, email, password);
}
export async function logout() {
  if (DEV_MODE) { setDevUserId(null); emit(null); return; }
  await fb.m.signOut(fb.auth);
}
export function currentUid() {
  return DEV_MODE ? devUserId : (currentUser ? currentUser.uid : null);
}

// Muunna Firebase-virhekoodit suomeksi.
export function authErrorMsg(e) {
  const c = e && e.code ? e.code : '';
  const map = {
    'auth/email-already-in-use': 'Sähköposti on jo käytössä — kirjaudu sisään.',
    'auth/invalid-email': 'Virheellinen sähköpostiosoite.',
    'auth/weak-password': 'Salasana on liian heikko (väh. 6 merkkiä).',
    'auth/invalid-credential': 'Väärä sähköposti tai salasana.',
    'auth/wrong-password': 'Väärä salasana.',
    'auth/user-not-found': 'Tunnusta ei löytynyt.',
    'auth/too-many-requests': 'Liian monta yritystä — yritä hetken kuluttua.',
  };
  return map[c] || (e && e.message) || 'Kirjautuminen epäonnistui';
}
