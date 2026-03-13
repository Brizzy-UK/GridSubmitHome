import { randomUUID } from 'node:crypto';
import { ensureDraftTable, sql } from './_db.js';

function normalizeStep(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) return 1;
  return parsed;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

export default async function handler(req, res) {
  try {
    await ensureDraftTable();

    if (req.method === 'POST') {
      const { draftId, contactEmail, currentStep, payload } = req.body || {};
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Draft payload is required.' });
      }

      const id = typeof draftId === 'string' && draftId.trim() ? draftId.trim() : randomUUID();
      const step = normalizeStep(currentStep);
      const email = normalizeEmail(contactEmail);
      const payloadJson = JSON.stringify(payload);

      const rows = await sql`
        INSERT INTO dno_form_drafts (id, contact_email, current_step, payload)
        VALUES (${id}, ${email}, ${step}, ${payloadJson}::jsonb)
        ON CONFLICT (id) DO UPDATE
        SET contact_email = EXCLUDED.contact_email,
            current_step = EXCLUDED.current_step,
            payload = EXCLUDED.payload,
            updated_at = NOW()
        RETURNING id, updated_at
      `;

      return res.status(200).json({
        success: true,
        draftId: rows[0].id,
        updatedAt: rows[0].updated_at,
      });
    }

    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Draft ID is required.' });

      const rows = await sql`
        SELECT id, contact_email, current_step, payload, updated_at
        FROM dno_form_drafts
        WHERE id = ${id}
        LIMIT 1
      `;

      if (rows.length === 0) return res.status(404).json({ error: 'Draft not found.' });

      return res.status(200).json({
        success: true,
        draftId: rows[0].id,
        contactEmail: rows[0].contact_email || '',
        currentStep: rows[0].current_step || 1,
        payload: rows[0].payload || {},
        updatedAt: rows[0].updated_at,
      });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Draft ID is required.' });

      await sql`DELETE FROM dno_form_drafts WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Draft API error:', error);
    return res.status(500).json({ error: 'Draft service unavailable right now.' });
  }
}
