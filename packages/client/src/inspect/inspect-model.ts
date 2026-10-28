/**
 * A6 — InspectModel: bir ObjectDef'in panelde gösterilecek saf veri modeli.
 * Saf TS (DOM yok); Testsiz WebGL'e gerek yoktur.
 */

import type { ObjectDef, ObjectKind } from '@chambler/shared';
import { EDGE_DIRECTIONS, type EdgeValue } from '../grid/TileEdges.js';

export const INSPECTABLE_KINDS: readonly ObjectKind[] = ['card', 'board', 'tile', 'token'];

export function isInspectable(kind: ObjectKind): boolean {
  return (INSPECTABLE_KINDS as readonly string[]).includes(kind);
}

export interface InspectSlot {
  id: string;
  x: number;
  y: number;
}

export interface InspectEdges {
  north: EdgeValue;
  east: EdgeValue;
  south: EdgeValue;
  west: EdgeValue;
}

export interface InspectModel {
  id: string;
  kind: ObjectKind;
  name: string;
  typeLabel: string;
  description: string;
  /** 'Serbest' ya da sahip id ulaşığı. */
  ownerLabel: string;
  faceUp: boolean;
  color: string;
  meta: Record<string, unknown>;
  slots: InspectSlot[];
  edges: InspectEdges | null;
  rotation: number;
  tokenLabel: string | null;
}

const KIND_DEFAULT_NAME: Record<string, string> = {
  card: 'Kart',
  board: 'Tahta',
  tile: 'Karo',
  token: 'Token',
};

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseEdges(raw: unknown): InspectEdges | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const result: Partial<InspectEdges> = {};
  for (const dir of EDGE_DIRECTIONS) {
    const v = obj[dir];
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    result[dir] = v;
  }
  return result as InspectEdges;
}

function parseSlots(raw: unknown): InspectSlot[] {
  if (!Array.isArray(raw)) return [];
  const slots: InspectSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const pos = s.position;
    const x = (pos && typeof pos === 'object' ? num((pos as { x?: unknown }).x) : num(s.x)) ?? 0;
    const y = (pos && typeof pos === 'object' ? num((pos as { y?: unknown }).y) : num(s.y)) ?? 0;
    slots.push({ id: str(s.id) ?? str(s.name) ?? 'slot', x, y });
  }
  return slots;
}

export function buildInspectModel(def: ObjectDef): InspectModel {
  const meta = { ...def.meta } as Record<string, unknown>;
  const kindLabel = KIND_DEFAULT_NAME[def.kind] ?? def.kind;
  const name = str(meta.name) ?? str(meta.title) ?? str(meta.label) ?? kindLabel;
  const typeLabel = str(meta.type) ?? (def.assetRef ? `${kindLabel} · ${def.assetRef}` : kindLabel);
  const fallbackDescription =
    def.kind === 'token' ? 'Token meta bilgileri panel başlığında listelenir.' : 'İçerik paketinde açıklama yok.';
  const description = str(meta.description) ?? str(meta.text) ?? fallbackDescription;
  const edges = parseEdges(meta.edges);
  const rotation = def.kind === 'tile' ? num(meta.rotation) ?? 0 : 0;
  const color = str(meta.color) ?? str((def.meta.color as string) ?? '') ?? '';
  const tokenLabel =
    def.kind === 'token' ? str(meta.label) ?? str(meta.tokenLabel) ?? `#${def.id}` : null;
  return {
    id: def.id,
    kind: def.kind,
    name,
    typeLabel,
    description,
    ownerLabel: def.ownerId ? `Sahip: ${def.ownerId}` : 'Serbest',
    faceUp: def.faceUp,
    color,
    meta,
    slots: parseSlots(meta.slots),
    edges,
    rotation,
    tokenLabel,
  };
}

/** Panel başlığında gösterilen kısa açıklama (meta özeti). */
export function metaSummary(model: InspectModel, maxPairs = 4): string {
  const entries = Object.entries(model.meta)
    .filter(([, v]) => typeof v !== 'object')
    .slice(0, maxPairs)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return entries.length > 0 ? entries.join(' · ') : 'meta boş';
}
