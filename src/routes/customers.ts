import { Router } from 'express';
import { z } from 'zod';
import { getCustomerById, searchCustomers } from '../services/customerService';
import { getCustomerConsultations } from '../services/consultationService';

export const customerRouter = Router();

const positiveId = z.coerce.number().int().positive();

customerRouter.get('/search', async (req, res, next) => {
  try {
    const search = z.string().trim().min(1).parse(req.query.query);
    const limit = z.coerce.number().int().min(1).max(100).catch(20).parse(req.query.limit);
    const customers = await searchCustomers(search, limit);
    res.json({ customers, count: customers.length });
  } catch (error) {
    next(error);
  }
});

customerRouter.get('/:id', async (req, res, next) => {
  try {
    const id = positiveId.parse(req.params.id);
    const customer = await getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const consultations = await getCustomerConsultations(id);
    return res.json({ customer, consultations });
  } catch (error) {
    return next(error);
  }
});
