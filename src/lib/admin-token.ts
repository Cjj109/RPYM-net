/**
 * RPYM - Admin Token Generation/Validation
 *
 * Generates secure tokens for admin-only presupuesto views.
 * Uses HMAC-SHA256 with a secret key.
 */

// Simple hash function using Web Crypto API (works in Cloudflare Workers)
async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

/**
 * Generate admin token for a presupuesto ID
 */
export async function generateAdminToken(presupuestoId: string, secret: string): Promise<string> {
  return await hmacSha256(`presupuesto-admin-${presupuestoId}`, secret);
}

/**
 * Validate admin token for a presupuesto ID
 */
export async function validateAdminToken(presupuestoId: string, token: string, secret: string): Promise<boolean> {
  const expectedToken = await generateAdminToken(presupuestoId, secret);
  return token === expectedToken;
}

/**
 * Generate admin URL for a presupuesto
 */
export async function getAdminPresupuestoUrl(presupuestoId: string, secret: string, baseUrl: string = ''): Promise<string> {
  const token = await generateAdminToken(presupuestoId, secret);
  return `${baseUrl}/presupuesto/admin?id=${presupuestoId}&token=${token}`;
}
