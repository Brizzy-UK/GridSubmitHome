import { put } from '@vercel/blob';

function sanitizeFilename(name) {
  return String(name || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

async function uploadAttachmentsToBlob(attachments, formType) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || !Array.isArray(attachments) || attachments.length === 0) return [];

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const basePath = `submissions/${formType || 'general'}/${yyyy}/${mm}`;

  const uploads = await Promise.all(
    attachments.map(async (file) => {
      const fileName = sanitizeFilename(file.name);
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`;
      const pathname = `${basePath}/${uniqueName}`;
      const buffer = Buffer.from(file.content, 'base64');
      const blob = await put(pathname, buffer, {
        access: 'public',
        token,
      });
      return {
        name: file.name,
        url: blob.url,
        pathname: blob.pathname,
      };
    })
  );

  return uploads;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    // shared / legacy fields
    formType,
    name,
    email,
    phone,
    postcode,
    systemSize,
    applicationType,
    dno,
    mpan,
    exportType,
    notes,
    attachments = [],

    // dno-project-submission fields
    installationType,
    totalGenerationCapacity,
    plannedInstallationDate,
    installerCompanyName,
    installerCompanyAddress,
    installerFirstName,
    installerLastName,
    installerPhone,
    installerEmail,
    projectStreetAddress,
    projectTown,
    projectPostcode,
    systemPhase,
    cutoutRating,
    mpanNumber,
    customerFirstName,
    customerLastName,
    customerPhone,
    customerEmail,
    inverters = [],
    inverterBrand,
    inverterModel,
    inverterCapacityKw,
    enaReference,
    batteryBrand,
    batteryModel,
    batteryTotalCapacityKwh,
    sldOption,
    sldCreateDetails,
    commissioningDocuments,
    consentConfirmation,
  } = req.body || {};

  const isProjectSubmission = formType === 'dno-project-submission';
  const applicantName = (name || `${installerFirstName || ''} ${installerLastName || ''}`.trim() || installerCompanyName || '').trim();
  const applicantEmail = (email || installerEmail || customerEmail || '').trim();
  const applicantPhone = (phone || installerPhone || customerPhone || '').trim();
  const sitePostcode = (postcode || projectPostcode || '').trim();
  const siteMpan = (mpan || mpanNumber || '').trim();
  const generationKw = (systemSize || totalGenerationCapacity || '').trim();
  const normalizedInverters = Array.isArray(inverters) && inverters.length > 0
    ? inverters
    : [{
        inverterId: 1,
        brand: inverterBrand,
        model: inverterModel,
        capacityKw: inverterCapacityKw,
        enaReference,
      }];
  const inverterSummary = normalizedInverters
    .map((inv) => {
      const id = inv?.inverterId || '?';
      const brand = inv?.brand || 'Not provided';
      const model = inv?.model || 'Not provided';
      const cap = inv?.capacityKw || 'Not provided';
      const qty = inv?.quantity || 'Not provided';
      const ena = inv?.enaReference || 'Not provided';
      return `Inverter #${id}: Brand ${brand}, Model ${model}, Capacity ${cap} kW, Quantity ${qty}, ENA Ref ${ena}`;
    })
    .join('<br>');
  const batterySummary = batteryBrand || batteryModel || batteryTotalCapacityKwh
    ? `Brand ${batteryBrand || 'Not provided'}, Model ${batteryModel || 'Not provided'}, Total Capacity ${batteryTotalCapacityKwh || 'Not provided'} kWh`
    : '';

  if (!applicantName || !applicantEmail) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured.' });
  }
  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.filter((a) => a && typeof a.name === 'string' && a.name && typeof a.content === 'string' && a.content)
    : [];

  const row = (label, value) =>
    `<tr>
      <td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;width:42%;font-size:14px">${label}</td>
      <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:14px">${value || '<span style="color:#9ca3af">Not provided</span>'}</td>
    </tr>`;

  const internalRows = isProjectSubmission
    ? [
        row('Form type', 'DNO Project Submission'),
        row('Installation type', installationType),
        row('Total generation capacity (kW)', generationKw),
        row('Planned installation date', plannedInstallationDate),
        row('Installer company name', installerCompanyName),
        row('Installer company address', installerCompanyAddress),
        row('Installer first name', installerFirstName),
        row('Installer last name', installerLastName),
        row('Installer phone', installerPhone),
        row('Installer email', installerEmail ? `<a href="mailto:${installerEmail}">${installerEmail}</a>` : ''),
        row('Project street address', projectStreetAddress),
        row('Town', projectTown),
        row('Project postcode', projectPostcode),
        row('System phase', systemPhase),
        row('Cut-out rating', cutoutRating),
        row('MPAN (13 digits)', siteMpan),
        row('Cut-out file uploaded', normalizedAttachments.length > 0 ? 'Yes' : 'No'),
        row('Customer first name', customerFirstName),
        row('Customer last name', customerLastName),
        row('Customer phone', customerPhone),
        row('Customer email', customerEmail ? `<a href="mailto:${customerEmail}">${customerEmail}</a>` : ''),
        row('Inverters', inverterSummary),
        row('Battery details', batterySummary),
        row('SLD / schematic option', sldOption),
        row('SLD details (if create requested)', sldCreateDetails ? sldCreateDetails.replace(/\n/g, '<br>') : ''),
        row('Commissioning documents', commissioningDocuments),
        row('Consent confirmation', consentConfirmation ? 'Yes' : 'No'),
        normalizedAttachments.length > 0 ? row('Attachments', normalizedAttachments.map((a) => a.name).join(', ')) : '',
      ].join('')
    : [
        row('Name / Company', applicantName),
        row('Email', `<a href="mailto:${applicantEmail}">${applicantEmail}</a>`),
        row('Phone', applicantPhone),
        row('Installation postcode', sitePostcode),
        row('System size (kW)', generationKw),
        row('Application type', applicationType),
        row('DNO', dno),
        row('MPAN / meter reference', siteMpan),
        row('Export type', exportType),
        row('Additional notes', notes ? notes.replace(/\n/g, '<br>') : ''),
        normalizedAttachments.length > 0 ? row('Attachments', normalizedAttachments.map((a) => a.name).join(', ')) : '',
      ].join('');

  const summaryRows = isProjectSubmission
    ? [
        row('Installation type', installationType),
        row('Total generation capacity (kW)', generationKw),
        row('Project postcode', projectPostcode),
        row('System phase', systemPhase),
        row('Inverter count', String(normalizedInverters.length)),
        row('Battery included', batterySummary ? 'Yes' : 'No'),
        row('SLD option', sldOption),
      ].join('')
    : [
        row('Application type', applicationType),
        row('System size (kW)', generationKw),
        row('Installation postcode', sitePostcode),
        row('DNO', dno || 'To be determined'),
        row('Export type', exportType),
      ].join('');

  const sourcePath = isProjectSubmission ? '/dno-project-submission' : '/contact';
  const subjectPrefix = isProjectSubmission ? 'New DNO Project Submission' : 'New Application';

  let blobUploads = [];
  try {
    blobUploads = await uploadAttachmentsToBlob(normalizedAttachments, formType);
  } catch (error) {
    console.error('Blob upload error:', error);
  }

  const internalEmail = {
    sender: { name: 'GridSubmit Website', email: 'submit@gridsubmit.co.uk' },
    to: [{ email: 'submit@gridsubmit.co.uk', name: 'GridSubmit Team' }],
    replyTo: { email: applicantEmail, name: applicantName },
    subject: `${subjectPrefix}: ${applicantName} - ${sitePostcode || 'No postcode'} - ${generationKw || '?'} kW`,
    htmlContent: `
      <div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto">
        <div style="background:#84CC16;padding:20px 24px;border-radius:8px 8px 0 0;border:2px solid #000;border-bottom:none">
          <h1 style="margin:0;font-size:20px;color:#000;font-weight:700">${subjectPrefix}</h1>
        </div>
        <div style="background:#fff;padding:24px;border:2px solid #000;border-top:none;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${internalRows}</table>
          <p style="font-size:13px;color:#6b7280;margin:0">Submitted via gridsubmit.co.uk${sourcePath}</p>
        </div>
      </div>
    `,
  };

  if (blobUploads.length > 0) {
    const blobLinks = blobUploads
      .map((file) => `<a href="${file.url}" target="_blank" rel="noopener noreferrer">${file.name}</a>`)
      .join('<br>');
    internalEmail.htmlContent = internalEmail.htmlContent.replace(
      '</table>',
      `${row('Stored file links', blobLinks)}</table>`
    );
  }

  if (normalizedAttachments.length > 0) {
    internalEmail.attachment = normalizedAttachments.map((a) => ({
      name: a.name,
      content: a.content,
    }));
  }

  const confirmationEmail = {
    sender: { name: 'GridSubmit', email: 'submit@gridsubmit.co.uk' },
    to: [{ email: applicantEmail, name: applicantName }],
    replyTo: { email: 'submit@gridsubmit.co.uk', name: 'GridSubmit Team' },
    subject: "We've received your DNO application - GridSubmit",
    htmlContent: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#84CC16;padding:24px;border-radius:8px 8px 0 0;border:2px solid #000;border-bottom:none">
          <h1 style="margin:0;font-size:22px;color:#000;font-weight:700">Application Received</h1>
        </div>
        <div style="background:#fff;padding:30px;border:2px solid #000;border-top:none;border-radius:0 0 8px 8px">
          <p style="font-size:16px;margin-top:0">Hi ${applicantName},</p>
          <p style="color:#374151;line-height:1.6">Thanks for submitting your application details to GridSubmit. We have received your request and our team will start review shortly.</p>
          <h3 style="font-size:15px;margin-bottom:12px">Your submission summary</h3>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${summaryRows}</table>
          <h3 style="font-size:15px;margin-bottom:12px">What happens next?</h3>
          <ol style="color:#374151;line-height:1.8;padding-left:20px;margin:0 0 24px">
            <li>We review your technical details</li>
            <li>We prepare the right DNO form set</li>
            <li>We submit and track progress on your behalf</li>
            <li>We update you when responses are received</li>
          </ol>
          <p style="font-size:14px;color:#6b7280;margin:0">Questions? Reply to this email and our team will help.</p>
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

    return res.status(200).json({ success: true, files: blobUploads });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: 'Failed to send. Please try again or email submit@gridsubmit.co.uk directly.' });
  }
}
