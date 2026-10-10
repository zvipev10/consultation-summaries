export interface Customer {
  id: number;
  fullName: string;
  normalizedPhone: string | null;
  email: string | null;
  externalCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Consultation {
  id: number;
  customerId: number;
  summary: string;
  topic: string | null;
  consultedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface HandwrittenSummaryImage {
  id: number;
  consultationId: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface ConsultationRevision {
  id: number;
  consultationId: number;
  revisionNumber: number;
  summary: string;
  topic: string | null;
  consultedAt: string;
  changeNote: string | null;
  createdAt: string;
}

export interface ConsultationWithCustomer extends Consultation {
  customer: Customer;
  handwrittenSummaryImage: HandwrittenSummaryImage | null;
}
