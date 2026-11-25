import { CatalogProduct, FailureCode, isId, isRecord } from './contract';

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max || raw?.trim() === '') {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}
export const port = integerEnv('PORT', 3000, 1, 65535);
const base = new URL(process.env.CATALOG_URL || 'https://dummyjson.com');
if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) {
  throw new Error('CATALOG_URL debe ser una URL HTTP(S) base, sin query ni fragmento.');
}
const timeout = integerEnv('CATALOG_TIMEOUT_MS', 3000, 1, 60000);
const delay = integerEnv('CATALOG_DELAY_MS', 0, 0, 60000);
const slowIds = new Set((process.env.CATALOG_SLOW_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number));
if (![...slowIds].every(isId)) throw new Error('CATALOG_SLOW_IDS debe contener IDs positivos separados por coma.');

export class CatalogError extends Error {
  constructor(public readonly code: FailureCode, message: string) { super(message); }
}
export async function fetchProduct(id: number): Promise<CatalogProduct> {
  const url = new URL(`${base.href.replace(/\/+$/, '')}/products/${id}`);
  if (delay && (!slowIds.size || slowIds.has(id))) url.searchParams.set('delay', String(delay));
  const signal = AbortSignal.timeout(timeout);
  try {
    const response = await fetch(url, { signal });
    if (response.status === 404) {
      throw new CatalogError('not_found', 'El producto no existe en el catálogo.');
    }
    if (!response.ok) throw new CatalogError('catalog_error', `El catálogo respondió HTTP ${response.status}.`);
    const data: unknown = await response.json();
    if (!isRecord(data) || data.id !== id || typeof data.title !== 'string' || !data.title.trim() ||
        typeof data.price !== 'number' || !Number.isFinite(data.price) || data.price < 0 ||
        typeof data.thumbnail !== 'string') {
      throw new CatalogError('catalog_error', 'El catálogo devolvió datos inválidos.');
    }
    let image: URL;
    try { image = new URL(data.thumbnail); }
    catch { throw new CatalogError('catalog_error', 'La imagen del catálogo no es válida.'); }
    if (!['http:', 'https:'].includes(image.protocol)) throw new CatalogError('catalog_error', 'Imagen inválida.');
    return { id, title: data.title, price: data.price, image: image.href };
  } catch (error) {
    if (signal.aborted) throw new CatalogError('timeout', `El catálogo no respondió dentro de ${timeout} ms.`);
    if (error instanceof CatalogError) throw error;
    throw new CatalogError('catalog_error', 'No se pudo consultar el catálogo.');
  }
}
