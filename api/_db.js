import { neon } from '@neondatabase/serverless';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!DATABASE_URL) {
  throw new Error(
    'Missing database URL env var. Set one of: DATABASE_URL, NEON_DATABASE_URL, POSTGRES_URL, POSTGRES_URL_NON_POOLING.'
  );
}

export const sql = neon(DATABASE_URL);

let ensuredDraft = false;
let ensuredSubmissions = false;

export async function ensureDraftTable() {
  if (ensuredDraft) return;

  await sql`
    CREATE TABLE IF NOT EXISTS dno_form_drafts (
      id TEXT PRIMARY KEY,
      contact_email TEXT,
      current_step INTEGER NOT NULL DEFAULT 1,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_dno_form_drafts_updated_at
    ON dno_form_drafts (updated_at DESC)
  `;

  ensuredDraft = true;
}

export async function ensureSubmissionTable() {
  if (ensuredSubmissions) return;

  await sql`
    CREATE TABLE IF NOT EXISTS dno_form_submissions (
      id TEXT PRIMARY KEY,
      form_type TEXT NOT NULL,
      applicant_name TEXT,
      applicant_email TEXT,
      applicant_phone TEXT,
      project_postcode TEXT,
      mpan_number TEXT,
      payload JSONB NOT NULL,
      files JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_dno_form_submissions_created_at
    ON dno_form_submissions (created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_dno_form_submissions_form_type
    ON dno_form_submissions (form_type)
  `;

  ensuredSubmissions = true;
}
