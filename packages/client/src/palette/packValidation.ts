/**
 * D2 — Paket doğrulama (tarayıcı).
 *
 * Sunucu tarafı yok: `manifest.json` HTTP üzerinden alınır ve modkit'in
 * zod şeması (`@chambler/modkit/browser`) + mantıksal kontrollerle
 * doğrulanır. Dosya sistemi kontrolleri (varlık mevcudiyeti) burada
 * `assets` haritasına karşı "mantıksal" olarak yapılır: her assetRef
 * tanımlı bir asset adına çözümlenmelidir.
 */

import {
  gamePackManifestSchema,
  ASSET_EXTENSIONS,
  type GamePackManifest,
} from '@chambler/modkit/browser';
import type { PackError } from '@chambler/modkit/browser';

export type { GamePackManifest, PackError };

export interface LogicalPackError {
  code: string;
  message: string;
  field?: string;
}

export type LogicalValidateResult =
  | { ok: true; manifest: GamePackManifest }
  | { ok: false; errors: LogicalPackError[] };

function err(code: string, message: string, field?: string): LogicalPackError {
  return { code, message, field };
}

/** Zod şeması + mantıksal kontroller; JSON verinin tamamı burada incelenir. */
export function validatePackManifest(data: unknown): LogicalValidateResult {
  const errors: LogicalPackError[] = [];

  const parsed = gamePackManifestSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      let code = 'SCHEMA';
      if (issue.code === 'unrecognized_keys') code = 'UNKNOWN_FIELD';
      else if (issue.code === 'invalid_type') code = 'TYPE';
      else if (issue.code === 'invalid_enum_value') code = 'OBJECT_KIND_UNKNOWN';
      const params = (issue as { params?: { code?: string } }).params;
      const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
      errors.push(err(params?.code ?? code, issue.message, field));
    }
  } else {
    const manifest = parsed.data;
    // Donanım yok: sadece manifest.json gezilebilir; MIME taraması şeması
    // (ASSET_EXTENSIONS) yeterli kabul edilir.
    const assetNames = new Set(Object.keys(manifest.assets));

    // Her assetRef, assets haritasında tanımlı olmalı.
    let index = 0;
    for (const component of manifest.components) {
      if (!assetNames.has(component.assetRef)) {
        errors.push(
          err(
            'ASSET_REF_UNKNOWN',
            `Component ${component.id} references unknown asset '${component.assetRef}'`,
            `components.${index}.assetRef`,
          ),
        );
      }
      index++;
    }
    for (const deck of manifest.decks ?? []) {
      let faceIndex = 0;
      for (const face of deck.faces) {
        if (!assetNames.has(face)) {
          errors.push(err('ASSET_REF_UNKNOWN', `Deck ${deck.id} face references unknown asset '${face}'`, `decks.faces.${faceIndex}`));
        }
        faceIndex++;
      }
      if (deck.backAssetRef !== undefined && !assetNames.has(deck.backAssetRef)) {
        errors.push(err('ASSET_REF_UNKNOWN', `Deck ${deck.id} backAssetRef references unknown asset '${deck.backAssetRef}'`, `decks.backAssetRef`));
      }
    }

    // ID çakışması: component ve deck id'leri ayriyeten tektir.
    const seenComponent = new Set<string>();
    let duplicateIndex = 0;
    for (const component of manifest.components) {
      if (seenComponent.has(component.id)) {
        errors.push(err('ID_DUPLICATE', `Duplicate component id '${component.id}'`, `components.${duplicateIndex}.id`));
      }
      seenComponent.add(component.id);
      duplicateIndex++;
    }
    const seenDeck = new Set<string>();
    for (const deck of manifest.decks ?? []) {
      if (seenDeck.has(deck.id)) {
        errors.push(err('ID_DUPLICATE', `Duplicate deck id '${deck.id}'`, 'decks.id'));
      }
      seenDeck.add(deck.id);
    }
    const seenSnap = new Set<string>();
    let snapIndex = 0;
    for (const snap of manifest.board?.snapPoints ?? []) {
      if (seenSnap.has(snap.id)) {
        errors.push(err('ID_DUPLICATE', `Duplicate snap point id '${snap.id}'`, `board.snapPoints.${snapIndex}.id`));
      }
      seenSnap.add(snap.id);
      snapIndex++;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: (parsed as { success: true; data: GamePackManifest }).data };
}

export { ASSET_EXTENSIONS };
