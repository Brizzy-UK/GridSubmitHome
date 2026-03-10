export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    name, email, phone, postcode,
    systemSize, applicationType, dno, mpan,
    exportType, notes, attachments = [],
  } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured.' });
  }

  const row = (label, value) =>
    `<tr>
      <td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;width:40%;font-size:14px">${label}</td>
      <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:14px">${value || '<span style="color:#9ca3af">Not provided</span>'}</td>
    </tr>`;

  // ── Internal notification to GridSubmit ───────────────────────────────────
  const internalEmail = {
    sender: { name: 'GridSubmit Website', email: 'submit@gridsubmit.co.uk' },
    to: [{ email: 'submit@gridsubmit.co.uk', name: 'GridSubmit Team' }],
    replyTo: { email, name },
    subject: `New Application: ${name} — ${postcode || 'No postcode'} — ${systemSize || '?'} kW`,
    htmlContent: `
      <div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto">
        <div style="background:#84CC16;padding:20px 24px;border-radius:8px 8px 0 0;border:2px solid #000;border-bottom:none">
          <h1 style="margin:0;font-size:20px;color:#000;font-weight:700">New DNO Application Received</h1>
        </div>
        <div style="background:#fff;padding:24px;border:2px solid #000;border-top:none;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            ${row('Name / Company', name)}
            ${row('Email', `<a href="mailto:${email}">${email}</a>`)}
            ${row('Phone', phone)}
            ${row('Installation postcode', postcode)}
            ${row('System size', systemSize ? systemSize + ' kW' : null)}
            ${row('Application type', applicationType)}
            ${row('DNO', dno)}
            ${row('MPAN / meter reference', mpan)}
            ${row('Export type', exportType)}
            ${row('Additional notes', notes ? notes.replace(/\n/g, '<br>') : null)}
            ${attachments.length > 0 ? row('Attachments', attachments.map(a => a.name).join(', ')) : ''}
          </table>
          <p style="font-size:13px;color:#6b7280;margin:0">Submitted via gridsubmit.co.uk/contact</p>
        </div>
      </div>
    `,
  };

  if (attachments.length > 0) {
    internalEmail.attachment = attachments.map(a => ({
      name: a.name,
      content: a.content,
    }));
  }

  // ── Confirmation email to applicant ──────────────────────────────────────
  const confirmationEmail = {
    sender: { name: 'GridSubmit', email: 'submit@gridsubmit.co.uk' },
    to: [{ email, name }],
    replyTo: { email: 'submit@gridsubmit.co.uk', name: 'GridSubmit Team' },
    subject: 'We\'ve received your DNO application — GridSubmit',
    htmlContent: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#84CC16;padding:24px;border-radius:8px 8px 0 0;border:2px solid #000;border-bottom:none">
          <h1 style="margin:0;font-size:22px;color:#000;font-weight:700">Application Received</h1>
        </div>
        <div style="background:#fff;padding:30px;border:2px solid #000;border-top:none;border-radius:0 0 8px 8px">
          <p style="font-size:16px;margin-top:0">Hi ${name},</p>
          <p style="color:#374151;line-height:1.6">Thanks for submitting your application details to GridSubmit. We've received your request and our team will get to work on it shortly.</p>

          <h3 style="font-size:15px;margin-bottom:12px">Your submission summary</h3>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            ${row('Application type', applicationType)}
            ${row('System size', systemSize ? systemSize + ' kW' : null)}
            ${row('Installation postcode', postcode)}
            ${row('DNO', dno || 'To be determined')}
            ${row('Export type', exportType)}
          </table>

          <h3 style="font-size:15px;margin-bottom:12px">What happens next?</h3>
          <ol style="color:#374151;line-height:1.8;padding-left:20px;margin:0 0 24px">
            <li>We'll review your application details</li>
            <li>We'll prepare and submit the correct DNO application on your behalf</li>
            <li>We'll chase the DNO and keep you updated</li>
            <li>We'll forward your export number as soon as it's issued</li>
          </ol>

          <div style="background:#fefce8;border:2px solid #000;border-radius:8px;padding:16px;margin-bottom:24px">
            <p style="margin:0;font-size:14px;color:#374151">If you have any files to send (site plans, datasheets, SLDs), simply reply to this email with them attached.</p>
          </div>

          <p style="font-size:14px;color:#6b7280;margin:0">Questions? Reply to this email — it goes straight to our team.</p>
          <p style="font-size:14px;margin:16px 0 0"><strong>GridSubmit</strong><br><span style="color:#6b7280">The UK's specialist DNO application service for solar installers.</span></p>
        </div>
      </div>
    `,
  };

  try {
    const [internalRes, confirmRes] = await Promise.all([
      fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(internalEmail),
      }),
      fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmationEmail),
      }),
    ]);

    if (!internalRes.ok) {
      const err = await internalRes.text();
      throw new Error(`Brevo error (internal): ${err}`);
    }
    if (!confirmRes.ok) {
      const err = await confirmRes.text();
      throw new Error(`Brevo error (confirmation): ${err}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: 'Failed to send — please try again or email submit@gridsubmit.co.uk directly.' });
  }
}
