import { query } from '../database/db';
import { Customer } from '../types/consultation';

export interface CustomerDetails {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  externalCustomerId?: string | null;
}

export function normalizePhone(phone?: string | null): string | null {
  if (!phone?.trim()) return null;

  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return `+${digits.slice(1).replace(/\D/g, '')}`;

  const numbers = digits.replace(/\D/g, '');
  if (numbers.startsWith('00')) return `+${numbers.slice(2)}`;
  if (numbers.startsWith('972')) return `+${numbers}`;
  if (numbers.startsWith('0')) return `+972${numbers.slice(1)}`;
  return `+${numbers}`;
}

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || null;
}

function normalizeExternalId(value?: string | null) {
  return value?.trim() || null;
}

export async function getCustomerById(id: number): Promise<Customer | null> {
  const rows = await query<Customer>('SELECT * FROM customers WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function findOrCreateCustomer(input: CustomerDetails): Promise<Customer> {
  const normalizedPhone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const externalCustomerId = normalizeExternalId(input.externalCustomerId);
  const fullName = input.fullName.trim();

  const matches = await query<Customer>(
    `SELECT *
     FROM customers
     WHERE ($1::TEXT IS NOT NULL AND "normalizedPhone" = $1)
        OR ($2::TEXT IS NOT NULL AND LOWER(email) = LOWER($2))
        OR ($3::TEXT IS NOT NULL AND "externalCustomerId" = $3)`,
    [normalizedPhone, email, externalCustomerId]
  );

  const uniqueIds = new Set(matches.map((customer) => customer.id));
  if (uniqueIds.size > 1) {
    throw new Error('Customer details match more than one existing customer');
  }

  if (matches[0]) {
    const rows = await query<Customer>(
      `UPDATE customers
       SET "fullName" = $2,
           "normalizedPhone" = COALESCE($3, "normalizedPhone"),
           email = COALESCE($4, email),
           "externalCustomerId" = COALESCE($5, "externalCustomerId"),
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [matches[0].id, fullName, normalizedPhone, email, externalCustomerId]
    );
    return rows[0];
  }

  const rows = await query<Customer>(
    `INSERT INTO customers ("fullName", "normalizedPhone", email, "externalCustomerId")
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [fullName, normalizedPhone, email, externalCustomerId]
  );
  return rows[0];
}

export async function searchCustomers(search: string, limit: number): Promise<Customer[]> {
  const normalizedPhone = normalizePhone(search);
  return query<Customer>(
    `SELECT *
     FROM customers
     WHERE "fullName" ILIKE '%' || $1 || '%'
        OR email ILIKE '%' || $1 || '%'
        OR "externalCustomerId" ILIKE '%' || $1 || '%'
        OR ($2::TEXT IS NOT NULL AND "normalizedPhone" = $2)
     ORDER BY "updatedAt" DESC
     LIMIT $3`,
    [search.trim(), normalizedPhone, limit]
  );
}
