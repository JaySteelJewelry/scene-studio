// Provider registry. Add a new host by writing one adapter file (see providers/fal.js) and listing it here.
import * as fal from './fal.js';

export const providers = { fal };
export const defaultProvider = 'fal';
export function getProvider(id) { return providers[id] || providers[defaultProvider]; }
