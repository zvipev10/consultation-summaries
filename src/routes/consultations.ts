import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCustomerById, findOrCreateCustomer } from '../services/customerService';
import {
  clearAllConsultationRecords,
  createConsultation,
  getConsultation,
  getConsultationHistory,
  getHandwrittenSummaryImage,
  listConsultations,
  updateConsultation
} from '../services/consultationService';

export const consultationRouter = Router();

const positiveId = z.coerce.number().int().positive();
const customerInput = z.object({
  fullName: z.string().trim().min(1).max(300),
  phone: z.string().trim().min(1).max(50).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  externalCustomerId: z.string().trim().min(1).max(200).nullable().optional()
});

const MAX_HANDWRITTEN_IMAGE_BYTES = 3 * 1024 * 1024;
const base64Image = z.string()
  .min(4)
  .max(Math.ceil(MAX_HANDWRITTEN_IMAGE_BYTES / 3) * 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Invalid base64 image data')
  .refine((value) => Buffer.from(value, 'base64').length <= MAX_HANDWRITTEN_IMAGE_BYTES, 'Image must be 3 MB or smaller');

const handwrittenSummaryImageInput = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64Data: base64Image
});

const createConsultationInput = z.object({
  customerId: positiveId.optional(),
  customer: customerInput.optional(),
  summary: z.string().trim().min(1).max(100_000),
  topic: z.string().trim().min(1).max(500).nullable().optional(),
  consultedAt: z.coerce.date().optional(),
  handwrittenSummaryImage: handwrittenSummaryImageInput.optional()
}).superRefine((value, context) => {
  if (!value.customerId && !value.customer) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide customerId or customer details' });
  }
  if (value.customerId && value.customer) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide customerId or customer details, not both' });
  }
});

const updateConsultationInput = z.object({
  summary: z.string().trim().min(1).max(100_000).optional(),
  topic: z.string().trim().min(1).max(500).nullable().optional(),
  consultedAt: z.coerce.date().optional(),
  changeNote: z.string().trim().min(1).max(2_000).nullable().optional()
}).refine((value) => value.summary !== undefined || value.topic !== undefined || value.consultedAt !== undefined, {
  message: 'Provide at least one field to update'
});

consultationRouter.post('/', async (req, res, next) => {
  try {
    const input = createConsultationInput.parse(req.body);
    const customer = input.customerId
      ? await getCustomerById(input.customerId)
      : await findOrCreateCustomer(input.customer!);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const imageBuffer = input.handwrittenSummaryImage
      ? Buffer.from(input.handwrittenSummaryImage.base64Data, 'base64')
      : undefined;
    const consultation = await createConsultation({
      customerId: customer.id,
      summary: input.summary,
      topic: input.topic,
      consultedAt: (input.consultedAt || new Date()).toISOString(),
      handwrittenSummaryImage: input.handwrittenSummaryImage && imageBuffer ? {
        fileName: input.handwrittenSummaryImage.fileName,
        mimeType: input.handwrittenSummaryImage.mimeType,
        base64Data: imageBuffer.toString('base64'),
        byteSize: imageBuffer.length,
        sha256: createHash('sha256').update(imageBuffer).digest('hex')
      } : undefined
    });

    return res.status(201).json({ consultation: { ...consultation, customer } });
  } catch (error) {
    return next(error);
  }
});

consultationRouter.get('/', async (req, res, next) => {
  try {
    const customerId = req.query.customerId === undefined ? undefined : positiveId.parse(req.query.customerId);
    const query = req.query.query === undefined ? undefined : z.string().trim().min(1).max(500).parse(req.query.query);
    const from = req.query.from === undefined ? undefined : z.coerce.date().parse(req.query.from).toISOString();
    const to = req.query.to === undefined ? undefined : z.coerce.date().parse(req.query.to).toISOString();
    const limit = z.coerce.number().int().min(1).max(100).catch(20).parse(req.query.limit);
    const offset = z.coerce.number().int().min(0).catch(0).parse(req.query.offset);
    const consultations = await listConsultations({ customerId, query, from, to, limit, offset });
    return res.json({ consultations, count: consultations.length, limit, offset });
  } catch (error) {
    return next(error);
  }
});

// Temporary maintenance route: it is protected by the Hermes group middleware
// and is removed immediately after the requested production data reset.
consultationRouter.delete('/maintenance/all-records', async (_req, res, next) => {
  try {
    const deleted = await clearAllConsultationRecords();
    return res.json({ deleted });
  } catch (error) {
    return next(error);
  }
});

consultationRouter.get('/:id/history', async (req, res, next) => {
  try {
    const id = positiveId.parse(req.params.id);
    const consultation = await getConsultation(id);
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });
    const revisions = await getConsultationHistory(id);
    return res.json({ consultation, revisions });
  } catch (error) {
    return next(error);
  }
});

consultationRouter.get('/:id', async (req, res, next) => {
  try {
    const id = positiveId.parse(req.params.id);
    const consultation = await getConsultation(id);
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });
    return res.json({ consultation });
  } catch (error) {
    return next(error);
  }
});

consultationRouter.get('/:id/handwritten-summary-image', async (req, res, next) => {
  try {
    const id = positiveId.parse(req.params.id);
    const image = await getHandwrittenSummaryImage(id);
    if (!image) return res.status(404).json({ error: 'Handwritten summary image not found' });
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', image.byteSize);
    res.setHeader('Content-Disposition', `inline; filename="${image.fileName.replace(/["\\]/g, '_')}"`);
    return res.send(Buffer.from(image.base64Data, 'base64'));
  } catch (error) {
    return next(error);
  }
});

consultationRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = positiveId.parse(req.params.id);
    const input = updateConsultationInput.parse(req.body);
    const consultation = await updateConsultation(id, {
      ...input,
      consultedAt: input.consultedAt?.toISOString()
    });
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });
    return res.json({ consultation });
  } catch (error) {
    return next(error);
  }
});
