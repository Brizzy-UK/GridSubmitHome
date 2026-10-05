import { timingSafeEqual } from 'node:crypto';
import { ensurePartialCompletionTable, sql } from './_db.js';

const ABANDON_AFTER_MINUTES = 30;
const LOOKBACK_DAYS = 2;
const BATCH_LIMIT = 20;

const STEP_NAMES = {
  1: 'What Are You Installing?',
  2: 'Installer Details',
  3: 'Installation Details',
  4: 'Equipment Details',
};

const FIELD_GROUPS = [
  ['Installer', [
    ['installerCompanyName', 'Company'],
    ['installerFirstName', 'First name'],
    ['installerLastName', 'Last name'],
    ['installerPhone', 'Phone'],
    ['installerEmail', 'Email'],
    ['installerCompanyAddress', 'Company address'],
  ]],
  ['Project', [
    ['installationType', 'Installation type'],
    ['totalGenerationCapacity', 'Capacity (kW)'],
    ['plannedInstallationDate', 'Planned install'],
    ['projectStreetAddress', 'Street'],
    ['projectTown', 'Town'],
    ['projectPostcode', 'Postcode'],
    ['systemPhase', 'Phase'],
    ['cutoutRating', 'Cut-out rating'],
    ['mpanNumber', 'MPAN'],
  ]],
  ['Customer', [
    ['customerFirstName', 'First name'],
    ['customerLastName', 'Last name'],
    ['customerPhone', 'Phone'],
    ['customerEmail', 'Email'],
  ]],
  ['Equipment', [
    ['inverters', 'Inverters'],
    ['batteryBrand', 'Battery brand'],
    ['batteryModel', 'Battery model'],
    ['batteryTotalCapacityKwh', 'Battery (kWh)'],
    ['existingInstallation', 'Existing install'],
    ['existingInstallationDetails', 'Existing install details'],
    ['sldOption', 'SLD option'],
    ['sldCreateDetails', 'SLD details'],
    ['commissioningDocuments', 'Commissioning docs'],
  ]],
];

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(String(req.headers.authorization || ''));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatValue(key, value) {
  if (key === 'inverters') {
    if (!Array.isArray(value)) return '';
    return value
      .filter((inv) => inv && (inv.brand || inv.model || inv.capacityKw))
      .map((inv) => [inv.quantity && `${inv.quantity}×`, inv.brand, inv.model, inv.capacityKw && `${inv.capacityKw} kW`]
        .filter(Boolean).join(' '))
      .join('\n');
  }
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : '';
  return String(value ?? '').trim();
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function buildMessage(row, kind) {
  const payload = row.payload || {};
  const name = row.contact_name || 'Unknown name';
  const step = Number(row.current_step) || 1;
  const headline = kind === 'completed'
    ? `✅ DNO form completed: ${name}`
    : `⚠️ DNO form abandoned at step ${step}: ${name}`;

  const contactBits = [
    row.contact_email && `<mailto:${row.contact_email}|${esc(row.contact_email)}>`,
    row.contact_phone && esc(row.contact_phone),
  ].filter(Boolean).join('  •  ');

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: headline.slice(0, 150), emoji: true } },
  ];

  if (contactBits) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Contact:* ${contactBits}` } });
  }

  for (const [groupName, fields] of FIELD_GROUPS) {
    const filled = fields
      .map(([key, label]) => [label, formatValue(key, payload[key])])
      .filter(([, value]) => value);
    if (filled.length === 0) continue;

    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${groupName}*` } });
    for (let i = 0; i < filled.length; i += 10) {
      blocks.push({
        type: 'section',
        fields: filled.slice(i, i + 10).map(([label, value]) => ({
          type: 'mrkdwn',
          text: `*${esc(label)}*\n${esc(value).slice(0, 1900)}`,
        })),
      });
    }
  }

  const status = kind === 'completed'
    ? `Submitted ${formatTime(row.submitted_at)}`
    : `Last active ${formatTime(row.updated_at)} on step ${step} (${STEP_NAMES[step] || 'unknown'})`;
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${status}  •  Started ${formatTime(row.created_at)}  •  ID \`${esc(row.id)}\`` }],
  });

  return { text: headline, blocks };
}

async function postToSlack(message) {
  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    throw new Error(`Slack ${response.status}: ${await response.text()}`);
  }
}

async function claimCompleted() {
  return sql`
    WITH picked AS (
      SELECT id, slack_status AS prev_status
      FROM dno_form_partial_completions
      WHERE submitted_at IS NOT NULL
        AND slack_status IS DISTINCT FROM 'completed'
        AND submitted_at > NOW() - make_interval(days => ${LOOKBACK_DAYS})
      ORDER BY submitted_at
      LIMIT ${BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE dno_form_partial_completions t
    SET slack_status = 'completed', slack_notified_at = NOW()
    FROM picked
    WHERE t.id = picked.id
    RETURNING t.*, picked.prev_status
  `;
}

async function claimAbandoned() {
  return sql`
    WITH picked AS (
      SELECT id, slack_status AS prev_status
      FROM dno_form_partial_completions
      WHERE submitted_at IS NULL
        AND slack_status IS NULL
        AND updated_at < NOW() - make_interval(mins => ${ABANDON_AFTER_MINUTES})
        AND updated_at > NOW() - make_interval(days => ${LOOKBACK_DAYS})
        AND (contact_email IS NOT NULL OR contact_phone IS NOT NULL OR contact_name IS NOT NULL)
      ORDER BY updated_at
      LIMIT ${BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE dno_form_partial_completions t
    SET slack_status = 'abandoned', slack_notified_at = NOW()
    FROM picked
    WHERE t.id = picked.id
    RETURNING t.*, picked.prev_status
  `;
}

async function notify(rows, kind) {
  let sent = 0;
  for (const row of rows) {
    try {
      await postToSlack(buildMessage(row, kind));
      sent += 1;
    } catch (error) {
      console.error(`Slack post failed for ${row.id}:`, error);
      await sql`
        UPDATE dno_form_partial_completions
        SET slack_status = ${row.prev_status}
        WHERE id = ${row.id}
      `;
    }
  }
  return sent;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (String(process.env.VERCEL_ENV || '').toLowerCase() !== 'production') {
    return res.status(200).json({ skipped: true, reason: 'Slack digest only runs in production.' });
  }
  if (!process.env.SLACK_WEBHOOK_URL) {
    return res.status(500).json({ error: 'SLACK_WEBHOOK_URL is not set.' });
  }

  try {
    await ensurePartialCompletionTable();
    const completed = await notify(await claimCompleted(), 'completed');
    const abandoned = await notify(await claimAbandoned(), 'abandoned');
    return res.status(200).json({ success: true, completed, abandoned });
  } catch (error) {
    console.error('Slack digest error:', error);
    return res.status(500).json({ error: 'Slack digest failed.' });
  }
}
