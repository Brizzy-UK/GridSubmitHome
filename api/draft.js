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

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function resolveOrigin(req, resumeBaseUrl) {
  try {
    if (resumeBaseUrl) {
      const parsed = new URL(String(resumeBaseUrl));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `${parsed.protocol}//${parsed.host}`;
      }
    }
  } catch (error) {
    console.warn('Invalid resumeBaseUrl provided for draft email.');
  }

  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'gridsubmit.co.uk');
  return `${proto}://${host}`;
}

async function sendDraftLinkEmail({ toEmail, resumeUrl }) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    throw new Error('Email service not configured.');
  }

  const payload = {
    sender: { name: 'GridSubmit', email: 'submit@gridsubmit.co.uk' },
    to: [{ email: toEmail }],
    replyTo: { email: 'submit@gridsubmit.co.uk', name: 'GridSubmit Team' },
    subject: 'Your GridSubmit return link',
    htmlContent: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#84CC16;padding:24px;border-radius:8px 8px 0 0;border:2px solid #000;border-bottom:none">
          <h1 style="margin:0;font-size:22px;color:#000;font-weight:700">Your Draft Has Been Saved</h1>
        </div>
        <div style="background:#fff;padding:28px;border:2px solid #000;border-top:none;border-radius:0 0 8px 8px">
          <p style="font-size:16px;margin-top:0">Thanks for using GridSubmit.</p>
          <p style="color:#374151;line-height:1.6">Use the link below to return and complete your DNO project submission.</p>
          <p style="margin:22px 0">
            <a href="${resumeUrl}" style="display:inline-block;background:#000;color:#84CC16;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Return to my submission</a>
          </p>
          <p style="color:#374151;line-height:1.6;word-break:break-all">${resumeUrl}</p>
          <p style="font-size:13px;color:#6b7280;margin:16px 0 0">If you did not request this email, you can ignore it.</p>
        </div>
      </div>
    `,
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo error: ${err}`);
  }
}

export default async function handler(req, res) {
  try {
    await ensureDraftTable();

    if (req.method === 'POST') {
      const { draftId, contactEmail, currentStep, payload, sendEmail, resumeBaseUrl } = req.body || {};
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

      const origin = resolveOrigin(req, resumeBaseUrl);
      const resumeUrl = `${origin}/dno-project-submission/?draft=${encodeURIComponent(rows[0].id)}`;

      if (sendEmail) {
        if (!email || !isLikelyEmail(email)) {
          return res.status(400).json({ error: 'A valid email is required to send the return link.' });
        }
        await sendDraftLinkEmail({ toEmail: email, resumeUrl });
      }

      return res.status(200).json({
        success: true,
        draftId: rows[0].id,
        updatedAt: rows[0].updated_at,
        emailSent: Boolean(sendEmail),
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
