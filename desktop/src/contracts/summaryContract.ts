import { type ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import summaryContractSchema from './summary-contract.v0.1.0.schema.json';

// JSON Schema Draft 2020-12 defines oneOf as exact-one matching semantics:
// https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.1.3
// We use this to enforce an explicit discriminated union by `format`.
// Unknown top-level fields are rejected by schema `additionalProperties: false` on each variant
// to keep contract behavior deterministic across clients and backend validators.
// Ajv strict mode is enabled to catch ambiguous/ignored schema definitions early:
// https://ajv.js.org/options#strict
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictSchema: true,
});

const validateSummaryPayload = ajv.compile(summaryContractSchema);

export const SUMMARY_SCHEMA_VERSION = 1 as const;
export const SUMMARY_CONTRACT_VERSION = 'v0.1.0' as const;

export interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown[];
  children?: BlockNoteBlock[];
  [key: string]: unknown;
}

export interface SummaryMarkdownPayload {
  schema_version: typeof SUMMARY_SCHEMA_VERSION;
  contract_version: typeof SUMMARY_CONTRACT_VERSION;
  format: 'markdown';
  markdown: string;
}

export interface SummaryBlocknotePayload {
  schema_version: typeof SUMMARY_SCHEMA_VERSION;
  contract_version: typeof SUMMARY_CONTRACT_VERSION;
  format: 'blocknote';
  markdown: string;
  summary_json: BlockNoteBlock[];
}

export type SummaryPayload = SummaryMarkdownPayload | SummaryBlocknotePayload;

export interface SummaryPayloadErrorItem {
  instancePath: string;
  keyword: string;
  message: string;
}

export interface SummaryPayloadValidationError {
  code: 'SUMMARY_PAYLOAD_INVALID';
  message: string;
  errors: SummaryPayloadErrorItem[];
}

export type SummaryPayloadParseResult =
  | { ok: true; data: SummaryPayload }
  | { ok: false; error: SummaryPayloadValidationError };

function normalizeAjvErrors(errors: ErrorObject[] | null | undefined): SummaryPayloadErrorItem[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  const mapped = errors.map((error) => ({
    instancePath: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message || 'Invalid value',
  }));

  mapped.sort((left, right) => {
    const leftKey = `${left.instancePath}|${left.keyword}|${left.message}`;
    const rightKey = `${right.instancePath}|${right.keyword}|${right.message}`;
    return leftKey.localeCompare(rightKey);
  });

  return mapped;
}

export function parseSummaryPayload(input: unknown): SummaryPayloadParseResult {
  if (validateSummaryPayload(input)) {
    return { ok: true, data: input as unknown as SummaryPayload };
  }

  return {
    ok: false,
    error: {
      code: 'SUMMARY_PAYLOAD_INVALID',
      message: 'Summary payload does not match contract v0.1.0.',
      errors: normalizeAjvErrors(validateSummaryPayload.errors),
    },
  };
}

export function parseSummaryPayloadFromApiData(input: unknown): SummaryPayloadParseResult {
  if (typeof input === 'string') {
    try {
      return parseSummaryPayload(JSON.parse(input));
    } catch {
      return {
        ok: false,
        error: {
          code: 'SUMMARY_PAYLOAD_INVALID',
          message: 'Summary payload is not valid JSON.',
          errors: [],
        },
      };
    }
  }

  return parseSummaryPayload(input);
}

export function createMarkdownSummaryPayload(markdown: string): SummaryMarkdownPayload {
  return {
    schema_version: SUMMARY_SCHEMA_VERSION,
    contract_version: SUMMARY_CONTRACT_VERSION,
    format: 'markdown',
    markdown,
  };
}

// BlockNote documents are canonical and markdown conversion is explicitly lossy:
// https://www.blocknotejs.org/docs/foundations/supported-formats
export function createBlocknoteSummaryPayload(
  markdown: string,
  summary_json: BlockNoteBlock[],
): SummaryBlocknotePayload {
  return {
    schema_version: SUMMARY_SCHEMA_VERSION,
    contract_version: SUMMARY_CONTRACT_VERSION,
    format: 'blocknote',
    markdown,
    summary_json,
  };
}
