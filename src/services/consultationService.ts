import { query } from '../database/db';
import {
  Consultation,
  HandwrittenSummaryImage,
  ConsultationRevision,
  ConsultationWithCustomer,
  Customer
} from '../types/consultation';
import { normalizePhone } from './customerService';

export interface CreateConsultationInput {
  customerId: number;
  summary: string;
  topic?: string | null;
  consultedAt: string;
  handwrittenSummaryImage?: {
    fileName: string;
    mimeType: string;
    base64Data: string;
    byteSize: number;
    sha256: string;
  };
}

export interface UpdateConsultationInput {
  summary?: string;
  topic?: string | null;
  consultedAt?: string;
  changeNote?: string | null;
}

export async function createConsultation(input: CreateConsultationInput): Promise<Consultation> {
  const rows = await query<Consultation>(
    `WITH inserted AS (
       INSERT INTO consultations ("customerId", summary, topic, "consultedAt")
       VALUES ($1, $2, $3, $4)
       RETURNING *
     ), image AS (
       INSERT INTO consultation_handwritten_summary_images
         ("consultationId", "fileName", "mimeType", "base64Data", "byteSize", sha256)
       SELECT id, $5, $6, $7, $8, $9
       FROM inserted
       WHERE $7::TEXT IS NOT NULL
       RETURNING id, "consultationId", "fileName", "mimeType", "byteSize", sha256, "createdAt"
     ), revision AS (
       INSERT INTO consultation_revisions ("consultationId", "revisionNumber", summary, topic, "consultedAt", "changeNote")
       SELECT id, 1, summary, topic, "consultedAt", 'Initial summary'
       FROM inserted
     )
     SELECT inserted.*,
       (SELECT json_build_object(
          'id', image.id,
          'consultationId', image."consultationId",
          'fileName', image."fileName",
          'mimeType', image."mimeType",
          'byteSize', image."byteSize",
          'sha256', image.sha256,
          'createdAt', image."createdAt"
        ) FROM image) AS "handwrittenSummaryImage"
     FROM inserted`,
    [
      input.customerId,
      input.summary,
      input.topic ?? null,
      input.consultedAt,
      input.handwrittenSummaryImage?.fileName ?? null,
      input.handwrittenSummaryImage?.mimeType ?? null,
      input.handwrittenSummaryImage?.base64Data ?? null,
      input.handwrittenSummaryImage?.byteSize ?? null,
      input.handwrittenSummaryImage?.sha256 ?? null
    ]
  );
  return rows[0];
}

export async function getConsultation(id: number): Promise<ConsultationWithCustomer | null> {
  const rows = await query<ConsultationWithCustomer>(
    `SELECT
       c.id, c."customerId", c.summary, c.topic, c."consultedAt", c."createdAt", c."updatedAt",
       json_build_object(
         'id', cu.id,
         'fullName', cu."fullName",
         'normalizedPhone', cu."normalizedPhone",
         'email', cu.email,
         'externalCustomerId', cu."externalCustomerId",
         'createdAt', cu."createdAt",
         'updatedAt', cu."updatedAt"
       ) AS customer,
       CASE WHEN hs.id IS NULL THEN NULL ELSE json_build_object(
         'id', hs.id,
         'consultationId', hs."consultationId",
         'fileName', hs."fileName",
         'mimeType', hs."mimeType",
         'byteSize', hs."byteSize",
         'sha256', hs.sha256,
         'createdAt', hs."createdAt"
       ) END AS "handwrittenSummaryImage"
     FROM consultations c
     JOIN customers cu ON cu.id = c."customerId"
     LEFT JOIN consultation_handwritten_summary_images hs ON hs."consultationId" = c.id
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function getConsultationHistory(id: number): Promise<ConsultationRevision[]> {
  return query<ConsultationRevision>(
    `SELECT *
     FROM consultation_revisions
     WHERE "consultationId" = $1
     ORDER BY "revisionNumber" ASC`,
    [id]
  );
}

export async function listConsultations(filters: {
  customerId?: number;
  query?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}): Promise<ConsultationWithCustomer[]> {
  const rows = await query<ConsultationWithCustomer>(
    `SELECT
       c.id, c."customerId", c.summary, c.topic, c."consultedAt", c."createdAt", c."updatedAt",
       json_build_object(
         'id', cu.id,
         'fullName', cu."fullName",
         'normalizedPhone', cu."normalizedPhone",
         'email', cu.email,
         'externalCustomerId', cu."externalCustomerId",
         'createdAt', cu."createdAt",
         'updatedAt', cu."updatedAt"
       ) AS customer,
       CASE WHEN hs.id IS NULL THEN NULL ELSE json_build_object(
         'id', hs.id,
         'consultationId', hs."consultationId",
         'fileName', hs."fileName",
         'mimeType', hs."mimeType",
         'byteSize', hs."byteSize",
         'sha256', hs.sha256,
         'createdAt', hs."createdAt"
       ) END AS "handwrittenSummaryImage"
     FROM consultations c
     JOIN customers cu ON cu.id = c."customerId"
     LEFT JOIN consultation_handwritten_summary_images hs ON hs."consultationId" = c.id
     WHERE ($1::BIGINT IS NULL OR c."customerId" = $1)
       AND ($2::TEXT IS NULL OR c.summary ILIKE '%' || $2 || '%' OR c.topic ILIKE '%' || $2 || '%' OR cu."fullName" ILIKE '%' || $2 || '%' OR cu.email ILIKE '%' || $2 || '%' OR cu."externalCustomerId" ILIKE '%' || $2 || '%' OR ($3::TEXT IS NOT NULL AND cu."normalizedPhone" = $3))
       AND ($4::TIMESTAMPTZ IS NULL OR c."consultedAt" >= $4)
       AND ($5::TIMESTAMPTZ IS NULL OR c."consultedAt" <= $5)
     ORDER BY c."consultedAt" DESC, c.id DESC
     LIMIT $6 OFFSET $7`,
    [
      filters.customerId ?? null,
      filters.query?.trim() || null,
      normalizePhone(filters.query),
      filters.from ?? null,
      filters.to ?? null,
      filters.limit,
      filters.offset
    ]
  );
  return rows;
}

export interface HandwrittenSummaryImageContent extends HandwrittenSummaryImage {
  base64Data: string;
}

export async function getHandwrittenSummaryImage(consultationId: number): Promise<HandwrittenSummaryImageContent | null> {
  const rows = await query<HandwrittenSummaryImageContent>(
    `SELECT id, "consultationId", "fileName", "mimeType", "base64Data", "byteSize", sha256, "createdAt"
     FROM consultation_handwritten_summary_images
     WHERE "consultationId" = $1`,
    [consultationId]
  );
  return rows[0] || null;
}

export async function updateConsultation(id: number, input: UpdateConsultationInput): Promise<Consultation | null> {
  const existing = await query<Consultation>('SELECT * FROM consultations WHERE id = $1', [id]);
  if (!existing[0]) return null;

  const assignments: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (input.summary !== undefined) add('summary', input.summary);
  if (input.topic !== undefined) add('topic', input.topic);
  if (input.consultedAt !== undefined) add('"consultedAt"', input.consultedAt);
  assignments.push('"revisionCount" = "revisionCount" + 1');
  assignments.push('"updatedAt" = CURRENT_TIMESTAMP');

  values.push(input.changeNote?.trim() || null);
  const changeNoteParameter = values.length;
  values.push(id);
  const idParameter = values.length;
  const updatedRows = await query<Consultation & { revisionCount: number }>(
    `WITH updated AS (
       UPDATE consultations
       SET ${assignments.join(', ')}
       WHERE id = $${idParameter}
       RETURNING *
     ), revision AS (
       INSERT INTO consultation_revisions ("consultationId", "revisionNumber", summary, topic, "consultedAt", "changeNote")
       SELECT id, "revisionCount", summary, topic, "consultedAt", $${changeNoteParameter}
       FROM updated
     )
     SELECT * FROM updated`,
    values
  );
  const updated = updatedRows[0];
  return updated;
}

export async function getCustomerConsultations(customerId: number): Promise<Consultation[]> {
  return query<Consultation>(
    `SELECT * FROM consultations
     WHERE "customerId" = $1
     ORDER BY "consultedAt" DESC, id DESC`,
    [customerId]
  );
}
