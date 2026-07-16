import cds from '@sap/cds';
import type { ISapAdapter, SapAdapterType } from './types.js';
import { MockAdapter } from './mock/index.js';
import { S4CloudAdapter } from './s4-cloud/index.js';
import { AdapterError } from '../util/errors.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('adapter:factory');

let _instance: ISapAdapter | null = null;

/**
 * Returns the active SAP adapter singleton.
 * Resolution order:
 *   1. AP_RECON_ADAPTER environment override
 *   2. AgentConfig DB row with key 'active_adapter'
 *   3. Default: MOCK
 */
export async function getAdapter(): Promise<ISapAdapter> {
  if (_instance) return _instance;

  const adapterType = await resolveAdapterType();
  log.info({ adapterType }, 'Initializing SAP adapter');

  switch (adapterType) {
    case 'MOCK':      _instance = new MockAdapter(); break;
    case 'S4_CLOUD':  _instance = new S4CloudAdapter(); break;
    default:
      throw new AdapterError(`Unknown adapter type: ${adapterType}`);
  }

  return _instance;
}

/** Force re-init — called by EvalService.switchAdapter(). */
export function resetAdapter(): void {
  _instance = null;
}

async function resolveAdapterType(): Promise<SapAdapterType> {
  // 1. Env var override
  const envVal = process.env.AP_RECON_ADAPTER as SapAdapterType | undefined;
  if (envVal) return envVal;

  // 2. DB config
  try {
    const db = await cds.connect.to('db');
    const row = await db.run(
      SELECT.one.from('ir.AgentConfig').where({ configKey: 'active_adapter' })
    );
    if (row?.configValue) return row.configValue as SapAdapterType;
  } catch {
    log.warn('Could not read active_adapter from DB — falling back to MOCK');
  }

  return 'MOCK';
}
