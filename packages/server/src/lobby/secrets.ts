import type { HandInfo, ObjectDef } from '@chambler/shared';

/** Fields that may carry a card's secret identity. */
const SECRET_META_KEYS = ['cardId', 'cardIds', 'hiddenCard', 'secret'];

/**
 * Returns a copy of `object` with secret card identity removed when the
 * recipient is not the owner and the card is face-down.
 */
export function sanitizeObjectForClient(
  object: ObjectDef,
  recipientSessionId: string,
): ObjectDef {
  const isOwner = object.ownerId === recipientSessionId;
  if (object.faceUp || isOwner) {
    return { ...object, meta: { ...object.meta }, transform: { ...object.transform, position: { ...object.transform.position }, rotation: { ...object.transform.rotation }, scale: { ...object.transform.scale } } };
  }
  const meta = { ...object.meta };
  for (const key of SECRET_META_KEYS) delete meta[key];
  // Replace assetRef with a generic back-face reference to avoid leaking art.
  const assetRef = object.assetRef ? `${object.assetRef}#back` : object.assetRef;
  return {
    ...object,
    assetRef,
    meta,
    transform: { ...object.transform, position: { ...object.transform.position }, rotation: { ...object.transform.rotation }, scale: { ...object.transform.scale } },
  };
}

/** Returns the hand only when the recipient is the owner; otherwise null. */
export function filterHandForClient(
  hand: HandInfo,
  recipientSessionId: string,
): HandInfo | null {
  if (hand.ownerId !== recipientSessionId) return null;
  return { ownerId: hand.ownerId, cardIds: [...hand.cardIds] };
}
