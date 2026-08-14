// The backend's model catalogue, and whether one of them is answering.

import { request } from './http';

export interface ModelCaps {
  toolCall?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  attachment?: boolean;
}

export interface ModelOption {
  id: string;
  free: boolean;
  name?: string;
  promptPerM?: number;
  completionPerM?: number;
  contextLength?: number;
  outputLimit?: number;
  caps?: ModelCaps;
}

export interface ModelStatus {
  up: boolean;
  uptime?: number;
  endpoints: number;
}

export async function listModels(backend: string): Promise<ModelOption[]> {
  const url = `/api/models?backend=${encodeURIComponent(backend)}`;
  return (await request(url, {}, { fallback: 'Failed to load the model list' })).json();
}

export async function getModelStatus(id: string): Promise<ModelStatus | null> {
  const url = `/api/model-status?id=${encodeURIComponent(id)}`;
  const res = await request(url, {}, { fallback: 'Failed to check this model' });
  return (await res.json()).status;
}
