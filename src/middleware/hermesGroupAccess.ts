import { createHash, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const GROUP_HEADER = 'x-hermes-whatsapp-group-id';
const BEARER_PREFIX = 'Bearer ';

function matchesSecret(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

/**
 * Allows API access only when Hermes identifies the configured WhatsApp group
 * and supplies the shared server-side secret. The group ID alone is not an
 * authenticator, so both checks are required.
 */
export function requireHermesGroup(req: Request, res: Response, next: NextFunction): void {
  const allowedGroupId = process.env.HERMES_ALLOWED_WHATSAPP_GROUP_ID;
  const apiSecret = process.env.HERMES_API_SECRET;

  if (!allowedGroupId || !apiSecret) {
    res.status(503).json({ error: 'Hermes group access is not configured' });
    return;
  }

  const groupId = req.header(GROUP_HEADER);
  const authorization = req.header('authorization') || '';
  const providedSecret = authorization.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length)
    : '';

  if (groupId !== allowedGroupId || !providedSecret || !matchesSecret(providedSecret, apiSecret)) {
    res.status(403).json({ error: 'This API is restricted to the configured WhatsApp group' });
    return;
  }

  next();
}
