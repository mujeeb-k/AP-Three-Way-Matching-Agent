import cds from '@sap/cds';
import type { AgentRuntimeConfig, DiscrepancyTypeName } from './types.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('agent:config');

const DEFAULTS: AgentRuntimeConfig = {
  autoCorrectThreshold: 0.92,
  autoApproveThreshold: 0.85,
  activeDiscrepancyTypes: [
    'FIELD_SWAP', 'PRICE_VARIANCE', 'QTY_VARIANCE', 'MISSING_GR',
    'INVOICE_BEFORE_GR', 'WRONG_PO_REFERENCE', 'LINE_STRUCTURE',
    'CURRENCY_MISMATCH', 'ENTITY_MISMATCH', 'MULTI_PO', 'DUPLICATE',
    'UOM_MISMATCH', 'SEPARATOR_AMBIGUITY', 'MATERIAL_MISMATCH',
  ],
  fieldSwapAlwaysLlm: true,
  tolPricePct: 10,
  tolPriceAbs: 1000,
  tolQtyPct: 5,
  tolQtyAbs: 500,
  tolReceiptVsPoPct: 5,
  tolInvoiceVsReceipt: 0,
  tolInvVsPoQtyPct: 10,
  tolInvVsPoQtyAbs: 1,
  tolInvVsPoAmountPct: 10,
  tolInvVsPoAmountAbs: 1000,
  amountThresholdCritical: 50000,
};

/**
 * Loads AgentRuntimeConfig from the DB, falling back to defaults for any missing keys.
 * Called once per pipeline run to pick up runtime changes without redeploy.
 */
export async function loadConfig(): Promise<AgentRuntimeConfig> {
  try {
    const db = await cds.connect.to('db');
    const rows: Array<{ configKey: string; configValue: string }> = await db.run(
      SELECT.from('ir.AgentConfig').columns('configKey', 'configValue')
    );

    const map = new Map(rows.map(r => [r.configKey, r.configValue]));
    const get = (key: string) => map.get(key);
    const getNum = (key: string, def: number) => {
      const v = get(key);
      return v !== undefined ? parseFloat(v) : def;
    };
    const getBool = (key: string, def: boolean) => {
      const v = get(key);
      return v !== undefined ? v === 'true' : def;
    };

    let activeTypes = DEFAULTS.activeDiscrepancyTypes;
    const typesRaw = get('active_discrepancy_types');
    if (typesRaw) {
      try { activeTypes = JSON.parse(typesRaw) as DiscrepancyTypeName[]; } catch { /* use default */ }
    }

    return {
      autoCorrectThreshold:   getNum('auto_correct_threshold', DEFAULTS.autoCorrectThreshold),
      autoApproveThreshold:   getNum('auto_approve_threshold', DEFAULTS.autoApproveThreshold),
      activeDiscrepancyTypes: activeTypes,
      fieldSwapAlwaysLlm:     getBool('field_swap_always_llm', DEFAULTS.fieldSwapAlwaysLlm),
      tolPricePct:            getNum('tol_price_pct', DEFAULTS.tolPricePct),
      tolPriceAbs:            getNum('tol_price_abs', DEFAULTS.tolPriceAbs),
      tolQtyPct:              getNum('tol_qty_pct', DEFAULTS.tolQtyPct),
      tolQtyAbs:              getNum('tol_qty_abs', DEFAULTS.tolQtyAbs),
      tolReceiptVsPoPct:      getNum('tol_receipt_vs_po_pct', DEFAULTS.tolReceiptVsPoPct),
      tolInvoiceVsReceipt:    getNum('tol_invoice_vs_receipt', DEFAULTS.tolInvoiceVsReceipt),
      tolInvVsPoQtyPct:       getNum('tol_inv_vs_po_qty_pct', DEFAULTS.tolInvVsPoQtyPct),
      tolInvVsPoQtyAbs:       getNum('tol_inv_vs_po_qty_abs', DEFAULTS.tolInvVsPoQtyAbs),
      tolInvVsPoAmountPct:    getNum('tol_inv_vs_po_amount_pct', DEFAULTS.tolInvVsPoAmountPct),
      tolInvVsPoAmountAbs:    getNum('tol_inv_vs_po_amount_abs', DEFAULTS.tolInvVsPoAmountAbs),
      amountThresholdCritical: getNum('amount_threshold_critical', DEFAULTS.amountThresholdCritical),
    };
  } catch (err) {
    log.warn({ err }, 'Could not load AgentConfig from DB — using defaults');
    return { ...DEFAULTS };
  }
}
