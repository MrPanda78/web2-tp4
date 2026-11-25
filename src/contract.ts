export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'propose'; ids: number[] }
  | { type: 'vote'; productId: number }
  | { type: 'unvote'; productId: number }
  | { type: 'remove'; productId: number };

export interface CatalogProduct {
  id: number;
  title: string;
  price: number;
  image: string;
}
export interface RankedProduct extends CatalogProduct {
  proposedBy: string;
  votes: number;
}
export interface ParticipantProduct extends RankedProduct {
  votedByMe: boolean;
}
export interface ScreenState {
  type: 'ranking';
  participantCount: number;
  products: RankedProduct[];
}
export type FailureCode = 'not_found' | 'timeout' | 'duplicate' | 'catalog_error';
export interface ProposalFailure { id: number; code: FailureCode; message: string }
export type ErrorCode = 'invalid_json' | 'invalid_message' | 'unknown_type' | 'invalid_name'
  | 'name_taken' | 'already_joined' | 'not_joined' | 'product_not_found'
  | 'already_voted' | 'not_voted' | 'internal_error';
export type ServerMessage =
  | { type: 'joined'; name: string }
  | { type: 'state'; participants: string[]; products: ParticipantProduct[] }
  | { type: 'proposal_result'; added: number[]; failures: ProposalFailure[] }
  | { type: 'error'; code: ErrorCode; message: string };

export class MessageError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => keys.includes(key));
}
export function parseMessage(raw: string): ClientMessage {
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { throw new MessageError('invalid_json', 'El mensaje no es JSON válido.'); }
  if (!isRecord(data) || typeof data.type !== 'string') {
    throw new MessageError('invalid_message', 'El mensaje debe ser un objeto con un tipo.');
  }
  switch (data.type) {
    case 'join': {
      if (!exactKeys(data, ['type', 'name']) || typeof data.name !== 'string') {
        throw new MessageError('invalid_message', 'join requiere un nombre de texto.');
      }
      const name = data.name.trim();
      if (name.length < 1 || name.length > 30 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new MessageError('invalid_name', 'El nombre debe tener entre 1 y 30 caracteres, sin controles.');
      }
      return { type: 'join', name };
    }
    case 'propose':
      if (!exactKeys(data, ['type', 'ids']) || !Array.isArray(data.ids) ||
          data.ids.length < 1 || data.ids.length > 10 || !data.ids.every(isId)) {
        throw new MessageError('invalid_message', 'propose requiere entre 1 y 10 IDs enteros positivos seguros.');
      }
      return { type: 'propose', ids: data.ids };
    case 'vote': case 'unvote': case 'remove':
      if (!exactKeys(data, ['type', 'productId']) || !isId(data.productId)) {
        throw new MessageError('invalid_message', 'La acción requiere un productId entero positivo seguro.');
      }
      return { type: data.type, productId: data.productId };
    default: throw new MessageError('unknown_type', 'Tipo de mensaje desconocido.');
  }
}
