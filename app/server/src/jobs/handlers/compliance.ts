import { writeActivity } from '../../services/activity.service.js';
import type { JobHandler } from '../worker.js';

// customers/data_request, customers/redact, shop/redact. No customer PII
// is stored yet - bundle_orders.customer_hash lands Day 3 - so there is
// nothing to purge. This still records that the mandatory request was
// received and processed, which is the actual GDPR webhook contract:
// Shopify requires an acknowledgement, not synchronous data deletion.
// See ARCHITECTURE.md §10 (PII posture) and README.md (Security notes).
export const handleCompliance: JobHandler = async (db, job) => {
  await writeActivity(db, {
    shopId: job.shopId,
    actorType: 'webhook',
    actorLabel: 'GDPR compliance webhook',
    entityType: 'shop',
    entityId: job.shopId,
    action: 'compliance.processed',
    metadata: { payload: job.payload },
  });
};
