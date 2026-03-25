import { randomUUID } from 'node:crypto';
import { ensurePartialCompletionTable, sql } from './_db.js';

function normalizeStep(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) return 1;
  return parsed;
}

function normalizeEventType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'step_change' || v === 'page_exit') return v;
  return 'step_change';
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function normalizePhone(value) {
  const phone = String(value || '').trim();
  return phone || null;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function deriveContactFields(payload) {
  const installerName = pickFirst(
    `${pickFirst(payload?.installerFirstName)} ${pickFirst(payload?.installerLastName)}`.trim(),
    payload?.installerCompanyName
  );
  const customerName = `${pickFirst(payload?.customerFirstName)} ${pickFirst(payload?.customerLastName)}`.trim();

  return {
    contactName: pickFirst(installerName, customerName) || null,
    contactEmail: normalizeEmail(
      pickFirst(payload?.installerEmail, payload?.customerEmail, payload?.contactEmail, payload?.email)
    ),
    contactPhone: normalizePhone(
      pickFirst(payload?.installerPhone, payload?.customerPhone, payload?.contactPhone, payload?.phone)
    ),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensurePartialCompletionTable();

    const body =
      req.body && typeof req.body === 'string'
        ? (() => {
            try {
              return JSON.parse(req.body);
            } catch (error) {
              return null;
            }
          })()
        : req.body;

    const { partialId, currentStep, payload, eventType } = body || {};
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Partial payload is required.' });
    }

    const id = typeof partialId === 'string' && partialId.trim() ? partialId.trim() : randomUUID();
    const step = normalizeStep(currentStep);
    const normalizedEventType = normalizeEventType(eventType);
    const payloadJson = JSON.stringify(payload);
    const { contactName, contactEmail, contactPhone } = deriveContactFields(payload);
    const lastSeenPath = String(req.headers.referer || req.headers.referrer || '').slice(0, 500) || null;
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500) || null;

    const rows = await sql`
      INSERT INTO dno_form_partial_completions (
        id,
        current_step,
        event_type,
        contact_name,
        contact_email,
        contact_phone,
        payload,
        last_seen_path,
        user_agent
      )
      VALUES (
        ${id},
        ${step},
        ${normalizedEventType},
        ${contactName},
        ${contactEmail},
        ${contactPhone},
        ${payloadJson}::jsonb,
        ${lastSeenPath},
        ${userAgent}
      )
      ON CONFLICT (id) DO UPDATE
      SET current_step = EXCLUDED.current_step,
          event_type = EXCLUDED.event_type,
          contact_name = COALESCE(EXCLUDED.contact_name, dno_form_partial_completions.contact_name),
          contact_email = COALESCE(EXCLUDED.contact_email, dno_form_partial_completions.contact_email),
          contact_phone = COALESCE(EXCLUDED.contact_phone, dno_form_partial_completions.contact_phone),
          payload = EXCLUDED.payload,
          last_seen_path = COALESCE(EXCLUDED.last_seen_path, dno_form_partial_completions.last_seen_path),
          user_agent = COALESCE(EXCLUDED.user_agent, dno_form_partial_completions.user_agent),
          updated_at = NOW()
      RETURNING id, updated_at
    `;

    return res.status(200).json({
      success: true,
      partialId: rows[0].id,
      updatedAt: rows[0].updated_at,
    });
  } catch (error) {
    console.error('Partial completion API error:', error);
    return res.status(500).json({ error: 'Partial completion service unavailable right now.' });
  }
}
