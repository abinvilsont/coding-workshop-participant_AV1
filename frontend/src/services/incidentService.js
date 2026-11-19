import { apiRequest } from './apiClient';

export const getDashboard = () => apiRequest('/dashboard');

export const getFacilities = () => apiRequest('/facilities');
export const getEngineers = () => apiRequest('/engineers');

// CRUD
export const listIncidents = (params) => apiRequest('/incidents', { params });
export const getIncident = (id) => apiRequest(`/incidents/${id}`);
export const createIncident = (body) => apiRequest('/incidents', { method: 'POST', body });
export const updateIncident = (id, body) => apiRequest(`/incidents/${id}`, { method: 'PATCH', body });
export const deleteIncident = (id) => apiRequest(`/incidents/${id}`, { method: 'DELETE' });

// Workflow actions (each returns the updated incident)
export const changeStatus = (id, status, comment) =>
  apiRequest(`/incidents/${id}/status`, { method: 'POST', body: { status, comment } });
export const assignEngineer = (id, engineerId) =>
  apiRequest(`/incidents/${id}/assign`, { method: 'POST', body: { engineer_id: engineerId } });
export const escalateIncident = (id, reason, requestedPriority) =>
  apiRequest(`/incidents/${id}/escalate`, {
    method: 'POST',
    body: { reason, requested_priority: requestedPriority || null },
  });
export const addNote = (id, body, isInternal = false) =>
  apiRequest(`/incidents/${id}/notes`, { method: 'POST', body: { body, is_internal: isInternal } });

// Duplicates (admin): open incidents to merge into, likeliest first; merge returns the target incident
export const getMergeCandidates = (id) => apiRequest(`/incidents/${id}/merge-candidates`);
export const mergeIncident = (id, targetId) =>
  apiRequest(`/incidents/${id}/merge`, { method: 'POST', body: { target_id: targetId } });

// Engineer reviews (reporters of a closed incident). Reviews are never shown to engineers.
export const submitReview = (id, rating, comment) =>
  apiRequest(`/incidents/${id}/review`, { method: 'POST', body: { rating, comment } });
export const updateReview = (id, rating, comment) =>
  apiRequest(`/incidents/${id}/review`, { method: 'PUT', body: { rating, comment } });
export const deleteReview = (id) => apiRequest(`/incidents/${id}/review`, { method: 'DELETE' });

// Already reported? Open incidents in the same building + category (+ floor) as a report about to be sent
export const findSimilarIncidents = ({ building_id, category, floor_id }) =>
  apiRequest('/incidents/similar', { params: { building_id, category, floor_id } });
// Ask for someone else's incident to be escalated; the caller follows it from then on
export const requestEscalation = (id, reason) =>
  apiRequest(`/incidents/${id}/escalation-request`, { method: 'POST', body: { reason: reason || null } });
