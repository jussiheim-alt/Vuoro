// Ohut fetch-kääre Vuoro-API:lle. Lisää auth-otsakkeet automaattisesti.
import { getAuthHeaders } from './auth.js';
import { API_BASE } from './config.js';

export { API_BASE };

async function req(method, path, body) {
  const headers = { ...(await getAuthHeaders()) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Virhe ${res.status}`);
    err.status = res.status;
    err.details = data && data.details;
    throw err;
  }
  return data;
}

export const api = {
  base: API_BASE,
  // Julkiset
  orgs: () => req('GET', '/public/orgs'),
  org: (slug) => req('GET', `/public/orgs/${slug}`),
  publicSessions: (slug, from, to) =>
    req('GET', `/public/orgs/${slug}/sessions?from=${from}&to=${to}`),
  icsUrl: (sessionId) => `${API_BASE}/public/sessions/${sessionId}/ics`,
  // Tili
  register: (payload) => req('POST', '/register', payload),
  me: () => req('GET', '/me'),
  // Treenit
  sessions: (from, to) => req('GET', `/sessions?from=${from}&to=${to}`),
  session: (id) => req('GET', `/sessions/${id}`),
  pending: () => req('GET', '/pending'),
  createSession: (payload) => req('POST', '/sessions', payload),
  updateSession: (id, payload) => req('PUT', `/sessions/${id}`, payload),
  deleteSession: (id, scope) => req('DELETE', `/sessions/${id}${scope ? `?scope=${scope}` : ''}`),
  // Varaukset
  book: (sessionId, payload) =>
    req('POST', `/sessions/${sessionId}/bookings`, payload ?? {}),
  removeBooking: (bookingId) => req('DELETE', `/bookings/${bookingId}`),
  approveBooking: (bookingId) => req('PATCH', `/bookings/${bookingId}/approve`, {}),
  confirmAttendance: (bookingId) => req('PATCH', `/bookings/${bookingId}/confirm`, {}),
  // Sijaisuus
  openSubstitute: (sessionId, reason) =>
    req('POST', `/sessions/${sessionId}/substitute`, { reason }),
  closeSubstitute: (subId) => req('PATCH', `/substitute/${subId}`, { open: false }),
  sendMessage: (subId, text) => req('POST', `/substitute/${subId}/messages`, { text }),
  // Asiakkaan sijaispyynnöt
  spotRequests: () => req('GET', '/spot-requests'),
  spotRequest: (id) => req('GET', `/spot-requests/${id}`),
  openSpotRequest: (sessionId, message) => req('POST', `/sessions/${sessionId}/spot-request`, { message }),
  spotMessage: (id, text) => req('POST', `/spot-requests/${id}/messages`, { text }),
  closeSpotRequest: (id) => req('PATCH', `/spot-requests/${id}`, {}),
  // Kutsut & tiimi (owner)
  invitePreview: (token) => req('GET', `/invite/${token}`),
  team: () => req('GET', '/team'),
  invite: (email, role) => req('POST', '/invitations', { email, role }),
  revokeInvite: (id) => req('DELETE', `/invitations/${id}`),
  setMemberRole: (id, role) => req('PUT', `/members/${id}/role`, { role }),
  deactivateMember: (id) => req('DELETE', `/members/${id}`),
  // Omat varaukset & asetukset
  myBookings: () => req('GET', '/my/bookings'),
  myData: () => req('GET', '/my/data'),
  deleteAccount: () => req('DELETE', '/my/account'),
  saveSettings: (payload) => req('PUT', '/org/settings', payload),
  // Superadmin
  adminOrgs: () => req('GET', '/admin/orgs'),
  createOrg: (payload) => req('POST', '/admin/orgs', payload),
  inviteOwner: (orgId, email) => req('POST', `/admin/orgs/${orgId}/invite-owner`, { email }),
  // Superadminin porautuva yrityksen hallinta
  adminOrgTeam: (orgId) => req('GET', `/admin/orgs/${orgId}/team`),
  adminInvite: (orgId, email, role) => req('POST', `/admin/orgs/${orgId}/invitations`, { email, role }),
  adminRevokeInvite: (id) => req('DELETE', `/admin/invitations/${id}`),
  adminSetMemberRole: (id, role) => req('PUT', `/admin/members/${id}/role`, { role }),
  adminDeactivate: (id) => req('DELETE', `/admin/members/${id}`),
  adminOrgSettings: (orgId, payload) => req('PUT', `/admin/orgs/${orgId}/settings`, payload),
};
