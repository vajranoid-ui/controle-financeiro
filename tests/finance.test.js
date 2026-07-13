import { describe, it, expect } from 'vitest';
import {
    formatCurrency, formatDate, escapeHtml,
    daysUntilInclusive, calcPlanning, defaultTargetDate,
    sumCardInvoiceUpTo, sumCCBalanceUpTo, txDisplayMeta,
    computeCategoryTotals, computeOwnerTotals, validateImportItem,
    findLegacyCategoryMigrations, migrateLegacyBudgets,
    monthKeyOf, monthLabel, buildArchiveData, buildArchiveCsvLines, csvEscape,
    buildExportRows, buildExportSummary,
    VALID_TYPES, VALID_CATEGORIES, VALID_OWNERS, LEGACY_CATEGORY_RENAMES
} from '../js/finance.js';

describe('formatCurrency / formatDate / escapeHtml', () => {
    it('formats positive and negative values as BRL', () => {
        expect(formatCurrency(1234.5)).toBe('R$ 1.234,50');
        expect(formatCurrency(-10)).toContain('10');
        expect(formatCurrency(0)).toBe('R$ 0,00');
    });

    it('formats a date string with day/month/year and time', () => {
        expect(formatDate('2026-07-05T15:44')).toBe('05/07/2026, 15:44');
    });

    it('escapes all HTML-sensitive characters', () => {
        expect(escapeHtml(`<script>alert("x") & 'y'</script>`))
            .toBe('&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;');
    });

    it('treats null/undefined as empty string', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });
});

describe('daysUntilInclusive', () => {
    it('counts today and the target day (03 -> 31 in the same month)', () => {
        const now = new Date(2026, 6, 3); // 3 jul 2026
        expect(daysUntilInclusive('2026-07-31', now)).toBe(29);
    });

    it('returns 1 when the target date is today', () => {
        const now = new Date(2026, 6, 15);
        expect(daysUntilInclusive('2026-07-15', now)).toBe(1);
    });

    it('returns 0 when the target date already passed', () => {
        const now = new Date(2026, 6, 15);
        expect(daysUntilInclusive('2026-07-10', now)).toBe(0);
    });

    it('is not affected by the time-of-day component of "now"', () => {
        const morning = new Date(2026, 6, 15, 0, 1);
        const night = new Date(2026, 6, 15, 23, 59);
        expect(daysUntilInclusive('2026-07-16', morning)).toBe(2);
        expect(daysUntilInclusive('2026-07-16', night)).toBe(2);
    });
});

describe('calcPlanning', () => {
    it('divides the base value across the remaining days', () => {
        const now = new Date(2026, 6, 1);
        const result = calcPlanning(1000, '2026-07-11', now); // 11 days inclusive
        expect(result.days).toBe(11);
        expect(result.daily).toBeCloseTo(1000 / 11, 6);
        expect(result.weekly).toBeCloseTo((1000 / 11) * 7, 6);
    });

    it('returns all zeros when the target date already passed', () => {
        const now = new Date(2026, 6, 20);
        expect(calcPlanning(500, '2026-07-01', now)).toEqual({ days: 0, daily: 0, weekly: 0 });
    });
});

describe('defaultTargetDate', () => {
    it('returns the last day of the given month', () => {
        expect(defaultTargetDate(new Date(2026, 6, 5))).toBe('2026-07-31');
    });

    it('handles February in a leap year', () => {
        expect(defaultTargetDate(new Date(2028, 1, 10))).toBe('2028-02-29');
    });
});

describe('sumCardInvoiceUpTo', () => {
    const endDate = new Date(2026, 6, 31, 23, 59, 59);

    it('adds card purchases and card-limit increases, subtracts payments and reductions', () => {
        const transactions = [
            { type: 'gasto_cartao', amount: 100, date: '2026-07-01T10:00' },
            { type: 'ajuste_cartao_aumento', amount: 50, date: '2026-07-02T10:00' },
            { type: 'pagamento_fatura', amount: 30, date: '2026-07-03T10:00' },
            { type: 'ajuste_cartao_reducao', amount: 20, date: '2026-07-04T10:00' }
        ];
        expect(sumCardInvoiceUpTo(transactions, endDate)).toBe(100);
    });

    it('includes card purchases scheduled later in the same period (unlike CC balance)', () => {
        const transactions = [
            { type: 'gasto_cartao', amount: 100, date: '2026-07-30T10:00' }
        ];
        expect(sumCardInvoiceUpTo(transactions, endDate)).toBe(100);
    });

    it('excludes transactions after the cutoff date', () => {
        const transactions = [
            { type: 'gasto_cartao', amount: 100, date: '2026-08-01T10:00' }
        ];
        expect(sumCardInvoiceUpTo(transactions, endDate)).toBe(0);
    });

    it('ignores unrelated transaction types', () => {
        const transactions = [{ type: 'entrada', amount: 999, date: '2026-07-01T10:00' }];
        expect(sumCardInvoiceUpTo(transactions, endDate)).toBe(0);
    });
});

describe('sumCCBalanceUpTo', () => {
    const now = new Date(2026, 6, 15, 12, 0, 0);
    const endDate = new Date(2026, 6, 31, 23, 59, 59);

    it('adds deposits and subtracts debit/invoice-payment/adjustment types', () => {
        const transactions = [
            { type: 'entrada', amount: 1000, date: '2026-07-01T10:00' },
            { type: 'ajuste_cc_entrada', amount: 100, date: '2026-07-02T10:00' },
            { type: 'gasto_cc', amount: 50, date: '2026-07-03T10:00' },
            { type: 'pagamento_fatura', amount: 30, date: '2026-07-04T10:00' },
            { type: 'ajuste_cc_saida', amount: 20, date: '2026-07-05T10:00' }
        ];
        expect(sumCCBalanceUpTo(transactions, endDate, now)).toBe(1000);
    });

    it('excludes transactions scheduled in the future relative to "now", even if before the cutoff', () => {
        const transactions = [
            { type: 'entrada', amount: 500, date: '2026-07-20T10:00' } // after "now" (Jul 15)
        ];
        expect(sumCCBalanceUpTo(transactions, endDate, now)).toBe(0);
    });

    it('excludes transactions after the period cutoff even if not future', () => {
        const past = new Date(2026, 6, 15, 12, 0, 0);
        const cutoff = new Date(2026, 6, 10, 23, 59, 59);
        const transactions = [{ type: 'entrada', amount: 500, date: '2026-07-12T10:00' }];
        expect(sumCCBalanceUpTo(transactions, cutoff, past)).toBe(0);
    });

    it('ignores card-only transaction types', () => {
        const transactions = [{ type: 'gasto_cartao', amount: 999, date: '2026-07-01T10:00' }];
        expect(sumCCBalanceUpTo(transactions, endDate, now)).toBe(0);
    });
});

describe('txDisplayMeta', () => {
    it('covers every known transaction type', () => {
        expect(txDisplayMeta({ type: 'entrada' }, false).origin).toBe('Conta Corrente');
        expect(txDisplayMeta({ type: 'ajuste_cc_entrada' }, false).origin).toBe('Ajuste Sistêmico');
        expect(txDisplayMeta({ type: 'gasto_cc' }, false).sign).toBe('- ');
        expect(txDisplayMeta({ type: 'ajuste_cc_saida' }, false).origin).toBe('Ajuste Sistêmico');
        expect(txDisplayMeta({ type: 'gasto_cartao' }, false).origin).toBe('Cartão de Crédito');
        expect(txDisplayMeta({ type: 'ajuste_cartao_aumento' }, false).origin).toBe('Ajuste Sistêmico');
        expect(txDisplayMeta({ type: 'pagamento_fatura' }, false).origin).toBe('C. Corrente → Cartão');
        expect(txDisplayMeta({ type: 'ajuste_cartao_reducao' }, false).sign).toBe('+ ');
    });

    it('marks entrada/gasto_cc as future-styled only when scheduled ahead', () => {
        expect(txDisplayMeta({ type: 'entrada' }, true).cls).toBe('text-future');
        expect(txDisplayMeta({ type: 'entrada' }, false).cls).toBe('text-in');
        expect(txDisplayMeta({ type: 'gasto_cc' }, true).cls).toBe('text-future');
    });

    it('gasto_cartao never gets the future style (card charges are already committed)', () => {
        expect(txDisplayMeta({ type: 'gasto_cartao' }, true).cls).toBe('text-out');
    });

    it('falls back to a neutral default for unknown types', () => {
        expect(txDisplayMeta({ type: 'something_new' }, false)).toEqual({ origin: '—', cls: 'text-neutral', sign: '' });
    });
});

describe('computeCategoryTotals', () => {
    const transactions = [
        { type: 'gasto_cc', amount: 50, category: 'Mercado', date: '2026-07-01T10:00' },
        { type: 'gasto_cartao', amount: 30, category: 'Mercado', date: '2026-07-02T10:00' },
        { type: 'gasto_cc', amount: 20, category: 'Lanche', date: '2026-07-03T10:00' },
        { type: 'entrada', amount: 1000, category: 'Receita / Salário', date: '2026-07-01T10:00' },
        { type: 'gasto_cc', amount: 999, category: 'Mercado', date: '2026-06-01T10:00' } // other month
    ];

    it('sums only expenses within the selected month, grouped by category', () => {
        const { totals, grandTotal } = computeCategoryTotals(transactions, 2026, 6); // July = month index 6
        expect(totals).toEqual({ Mercado: 80, Lanche: 20 });
        expect(grandTotal).toBe(100);
    });

    it('falls back to "Outros" when category is missing', () => {
        const { totals } = computeCategoryTotals(
            [{ type: 'gasto_cc', amount: 10, date: '2026-07-01T10:00' }], 2026, 6
        );
        expect(totals).toEqual({ Outros: 10 });
    });
});

describe('computeOwnerTotals', () => {
    it('groups expenses by known owners and folds unknown owners into Conjunta', () => {
        const transactions = [
            { type: 'gasto_cc', amount: 10, owner: 'Marcelo', date: '2026-07-01T10:00' },
            { type: 'gasto_cartao', amount: 20, owner: 'Amanda', date: '2026-07-02T10:00' },
            { type: 'gasto_cc', amount: 5, owner: 'SomeoneElse', date: '2026-07-03T10:00' },
            { type: 'gasto_cc', amount: 7, date: '2026-07-04T10:00' } // no owner at all
        ];
        expect(computeOwnerTotals(transactions, 2026, 6)).toEqual({
            Conjunta: 12,
            Marcelo: 10,
            Amanda: 20
        });
    });
});

describe('validateImportItem', () => {
    it('accepts a well-formed item with no errors', () => {
        const { tx, errors } = validateImportItem({
            type: 'gasto_cc', amount: 7.32, category: 'Lanche',
            date: '2026-07-05T15:44', description: 'Pão', location: 'Bonanza', owner: 'Marcelo'
        }, 0);
        expect(errors).toEqual([]);
        expect(tx).toMatchObject({ type: 'gasto_cc', amount: 7.32, category: 'Lanche', owner: 'Marcelo' });
    });

    it('rejects an invalid type', () => {
        const { errors } = validateImportItem({ type: 'saque', amount: 10, date: '2026-07-05T15:44' }, 0);
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('tipo');
    });

    it('rejects zero, negative, and NaN amounts', () => {
        for (const amount of [0, -5, 'abc']) {
            const { errors } = validateImportItem({ type: 'gasto_cc', amount, date: '2026-07-05T15:44' }, 2);
            expect(errors.some(e => e.includes('Item 3') && e.includes('valor'))).toBe(true);
        }
    });

    it('rejects a malformed date', () => {
        const { errors } = validateImportItem({ type: 'gasto_cc', amount: 10, date: '05/07/2026' }, 0);
        expect(errors.some(e => e.includes('data'))).toBe(true);
    });

    it('truncates a date that includes seconds down to minute precision', () => {
        const { tx } = validateImportItem({ type: 'gasto_cc', amount: 10, date: '2026-07-05T15:44:30.000Z' }, 0);
        expect(tx.date).toBe('2026-07-05T15:44');
    });

    it('silently falls back unknown categories to "Outros" (no error)', () => {
        const { tx, errors } = validateImportItem({ type: 'gasto_cc', amount: 10, category: 'Made Up', date: '2026-07-05T15:44' }, 0);
        expect(tx.category).toBe('Outros');
        expect(errors).toEqual([]);
    });

    it('silently falls back an unrecognized owner to "Conjunta"', () => {
        const { tx } = validateImportItem({ type: 'gasto_cc', amount: 10, date: '2026-07-05T15:44', owner: 'Fulano' }, 0);
        expect(tx.owner).toBe('Conjunta');
    });

    it('defaults type to gasto_cc and category to Outros when omitted', () => {
        const { tx } = validateImportItem({ amount: 10, date: '2026-07-05T15:44' }, 0);
        expect(tx.type).toBe('gasto_cc');
        expect(tx.category).toBe('Outros');
    });
});

describe('findLegacyCategoryMigrations', () => {
    it('flags transactions using a legacy category name', () => {
        const transactions = [
            { id: 'a', category: 'Família & Pets' },
            { id: 'b', category: 'Pets' },
            { id: 'c', category: 'Lanches' }
        ];
        const result = findLegacyCategoryMigrations(transactions, LEGACY_CATEGORY_RENAMES);
        expect(result).toEqual([
            { id: 'a', newCategory: 'Pets' },
            { id: 'c', newCategory: 'Lanche' }
        ]);
    });

    it('skips transactions already recorded as migrated', () => {
        const transactions = [{ id: 'a', category: 'Família & Pets' }];
        const result = findLegacyCategoryMigrations(transactions, LEGACY_CATEGORY_RENAMES, new Set(['a']));
        expect(result).toEqual([]);
    });
});

describe('migrateLegacyBudgets', () => {
    it('moves a legacy budget to the new category name', () => {
        const { novos, mudou } = migrateLegacyBudgets({ 'Família & Pets': 200 }, LEGACY_CATEGORY_RENAMES);
        expect(mudou).toBe(true);
        expect(novos).toEqual({ Pets: 200 });
    });

    it('does not overwrite an existing budget already set on the new category', () => {
        const { novos, mudou } = migrateLegacyBudgets({ 'Família & Pets': 200, Pets: 500 }, LEGACY_CATEGORY_RENAMES);
        expect(mudou).toBe(true);
        expect(novos).toEqual({ Pets: 500 });
    });

    it('reports mudou=false when nothing needs migrating', () => {
        const { novos, mudou } = migrateLegacyBudgets({ Pets: 500 }, LEGACY_CATEGORY_RENAMES);
        expect(mudou).toBe(false);
        expect(novos).toEqual({ Pets: 500 });
    });
});

describe('monthKeyOf / monthLabel', () => {
    it('builds a zero-padded YYYY-MM key', () => {
        expect(monthKeyOf('2026-01-05T10:00')).toBe('2026-01');
        expect(monthKeyOf('2026-11-05T10:00')).toBe('2026-11');
    });

    it('renders a human month/year label', () => {
        expect(monthLabel('2026-01')).toContain('2026');
    });
});

describe('buildArchiveData', () => {
    const now = new Date(2026, 6, 15); // reference month: July 2026

    it('groups only months strictly before the current one', () => {
        const transactions = [
            { type: 'entrada', amount: 1000, date: '2026-06-01T10:00' },
            { type: 'gasto_cc', amount: 100, date: '2026-06-05T10:00' },
            { type: 'gasto_cc', amount: 50, date: '2026-07-01T10:00' } // current month: excluded
        ];
        const archive = buildArchiveData(transactions, now);
        expect(archive).toHaveLength(1);
        expect(archive[0]).toMatchObject({ key: '2026-06', entradas: 1000, saidas: 100, count: 2 });
    });

    it('excludes transactions scheduled in a future month', () => {
        const transactions = [{ type: 'entrada', amount: 100, date: '2026-08-01T10:00' }];
        expect(buildArchiveData(transactions, now)).toEqual([]);
    });

    it('sorts groups by month key descending (most recent closed month first)', () => {
        const transactions = [
            { type: 'entrada', amount: 10, date: '2025-12-01T10:00' },
            { type: 'entrada', amount: 10, date: '2026-05-01T10:00' },
            { type: 'entrada', amount: 10, date: '2026-01-01T10:00' }
        ];
        const archive = buildArchiveData(transactions, now);
        expect(archive.map(g => g.key)).toEqual(['2026-05', '2026-01', '2025-12']);
    });
});

describe('csvEscape / buildArchiveCsvLines', () => {
    it('wraps values in quotes and doubles internal quotes', () => {
        expect(csvEscape('Padaria "Bom Pão"')).toBe('"Padaria ""Bom Pão"""');
        expect(csvEscape(null)).toBe('""');
    });

    it('builds a header, one line per transaction, and summary totals', () => {
        const group = {
            key: '2026-06',
            entradas: 1000,
            saidas: 100,
            items: [
                { id: '1', type: 'entrada', amount: 1000, date: '2026-06-01T10:00', description: 'Salário' },
                { id: '2', type: 'gasto_cc', amount: 100, date: '2026-06-05T10:00', category: 'Mercado' }
            ]
        };
        const lines = buildArchiveCsvLines(group);
        expect(lines[0]).toBe('Data;Descricao;Local;Pessoa;Categoria;Tipo;Valor');
        expect(lines.length).toBe(1 + 2 + 1 + 3); // header + 2 tx + blank + 3 totals
        expect(lines.some(l => l.includes('TOTAL ENTRADAS'))).toBe(true);
        expect(lines.some(l => l.includes('RESULTADO'))).toBe(true);
    });
});

describe('buildExportRows / buildExportSummary', () => {
    it('sorts transactions most-recent-first and signs the value by type', () => {
        const now = new Date(2026, 6, 15);
        const transactions = [
            { type: 'entrada', amount: 100, date: '2026-07-01T10:00' },
            { type: 'gasto_cc', amount: 30, date: '2026-07-10T10:00' }
        ];
        const rows = buildExportRows(transactions, now);
        expect(rows[0].value).toBe(-30);
        expect(rows[1].value).toBe(100);
    });

    it('defaults missing description/location/owner/category', () => {
        const rows = buildExportRows([{ type: 'gasto_cc', amount: 5, date: '2026-07-01T10:00' }], new Date(2026, 6, 15));
        expect(rows[0]).toMatchObject({ description: 'Sem descrição', location: '', owner: 'Conjunta', category: 'Outros' });
    });

    it('builds the summary rows from the given balances/limit', () => {
        const summary = buildExportSummary({ currentCC: 100, projectedCC: 200 }, 500);
        expect(summary).toEqual([
            ['Conta Corrente (disponível hoje)', 100],
            ['Saldo Projetado (com agendados)', 200],
            ['Limite Total do Cartão', 500]
        ]);
    });
});

describe('exported constant lists stay in sync', () => {
    it('VALID_TYPES / VALID_CATEGORIES / VALID_OWNERS are non-empty and unique', () => {
        for (const list of [VALID_TYPES, VALID_CATEGORIES, VALID_OWNERS]) {
            expect(list.length).toBeGreaterThan(0);
            expect(new Set(list).size).toBe(list.length);
        }
    });
});
