import { describe, it, expect } from 'vitest';
import {
    formatCurrency, normalize, monthKey, monthLabel, locationOf, escapeHtml,
    unitInfo, monthsBetween, filterExpenses,
    computeLocationTotals, computeTimelineData,
    findProductMatches, buildProductChartData, computeMinUnitPrice, buildProductTableHtml
} from '../js/analise.js';

describe('formatCurrency', () => {
    it('formats a value as BRL', () => {
        expect(formatCurrency(1234.5)).toBe('R$ 1.234,50');
    });

    it('defaults null/undefined to zero', () => {
        expect(formatCurrency(null)).toBe('R$ 0,00');
        expect(formatCurrency(undefined)).toBe('R$ 0,00');
    });
});

describe('normalize', () => {
    it('strips accents and lowercases', () => {
        expect(normalize('Café com Açúcar')).toBe('cafe com acucar');
        expect(normalize('PÃO FRANCÊS')).toBe('pao frances');
    });

    it('treats null/undefined as empty string', () => {
        expect(normalize(null)).toBe('');
        expect(normalize(undefined)).toBe('');
    });
});

describe('monthKey / monthLabel', () => {
    it('slices the date string down to YYYY-MM', () => {
        expect(monthKey('2026-07-05T15:44')).toBe('2026-07');
        expect(monthKey('')).toBe('');
        expect(monthKey(undefined)).toBe('');
    });

    it('renders a short month/2-digit-year label', () => {
        const label = monthLabel('2026-07');
        expect(label).toContain('26');
    });
});

describe('locationOf', () => {
    it('trims the location and falls back to "Sem local"', () => {
        expect(locationOf({ location: '  Bonanza  ' })).toBe('Bonanza');
        expect(locationOf({ location: '' })).toBe('Sem local');
        expect(locationOf({})).toBe('Sem local');
    });
});

describe('escapeHtml', () => {
    it('escapes & < > " but not single quotes', () => {
        expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe(`&lt;b&gt;&quot;x&quot; &amp; 'y'&lt;/b&gt;`);
    });

    it('treats null/undefined as empty string', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });
});

describe('unitInfo', () => {
    it('extracts quantity and unit price from a "NxR$X" description', () => {
        expect(unitInfo({ description: 'Pão francês (3x R$10,00)', amount: 30 }))
            .toEqual({ qty: 3, unit: 10, derived: true });
    });

    it('accepts a dot as decimal separator and extra spacing', () => {
        expect(unitInfo({ description: 'Item 2 x R$ 5.50', amount: 11 }))
            .toEqual({ qty: 2, unit: 5.5, derived: true });
    });

    it('is case-insensitive on the "x" separator', () => {
        expect(unitInfo({ description: '4X R$2,00', amount: 8 }))
            .toEqual({ qty: 4, unit: 2, derived: true });
    });

    it('falls back to 1 unit at the full amount when no pattern matches', () => {
        expect(unitInfo({ description: 'Café expresso', amount: 7.5 }))
            .toEqual({ qty: 1, unit: 7.5, derived: false });
    });

    it('falls back when quantity is zero (invalid match)', () => {
        expect(unitInfo({ description: '0x R$10,00', amount: 10 }))
            .toEqual({ qty: 1, unit: 10, derived: false });
    });
});

describe('monthsBetween', () => {
    it('lists every month key inclusive of both ends', () => {
        expect(monthsBetween('2026-05', '2026-07')).toEqual(['2026-05', '2026-06', '2026-07']);
    });

    it('handles a single-month range', () => {
        expect(monthsBetween('2026-07', '2026-07')).toEqual(['2026-07']);
    });

    it('rolls over a year boundary', () => {
        expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('returns an empty list when "from" is after "to"', () => {
        expect(monthsBetween('2026-07', '2026-01')).toEqual([]);
    });
});

describe('filterExpenses', () => {
    const transactions = [
        { type: 'gasto_cc', amount: 10, date: '2026-06-01T10:00' },
        { type: 'gasto_cartao', amount: 20, date: '2026-07-01T10:00' },
        { type: 'entrada', amount: 999, date: '2026-06-15T10:00' },
        { type: 'gasto_cc', amount: 5, date: '2026-05-01T10:00' }
    ];

    it('keeps only gasto_cc/gasto_cartao within the month range', () => {
        const result = filterExpenses(transactions, { from: '2026-06', to: '2026-07' });
        expect(result).toHaveLength(2);
        expect(result.map(t => t.amount).sort()).toEqual([10, 20]);
    });

    it('filters by a specific origin type', () => {
        const result = filterExpenses(transactions, { from: '2026-06', to: '2026-07', origin: 'gasto_cartao' });
        expect(result).toEqual([transactions[1]]);
    });

    it('"todos" origin keeps both expense types', () => {
        const result = filterExpenses(transactions, { from: '2026-06', to: '2026-07', origin: 'todos' });
        expect(result).toHaveLength(2);
    });

    it('defaults to an unbounded range when from/to are omitted', () => {
        const result = filterExpenses(transactions, {});
        expect(result).toHaveLength(3); // every gasto_cc/gasto_cartao, any month
    });
});

describe('computeLocationTotals', () => {
    it('groups by location (falling back to "Sem local") and sorts descending', () => {
        const items = [
            { amount: 10, location: 'Bonanza' },
            { amount: 30, location: 'Bonanza' },
            { amount: 5, location: '' },
            { amount: 20, location: 'Posto Ipiranga' }
        ];
        expect(computeLocationTotals(items)).toEqual([
            ['Bonanza', 40],
            ['Posto Ipiranga', 20],
            ['Sem local', 5]
        ]);
    });
});

describe('computeTimelineData', () => {
    it('limits the per-location series to the top 5, but sums ALL locations into the monthly total', () => {
        const items = [];
        // 6 distinct locations, each with a single July purchase, decreasing amounts
        const locs = ['A', 'B', 'C', 'D', 'E', 'F'];
        locs.forEach((loc, i) => {
            items.push({ amount: 60 - i * 10, location: loc, date: '2026-07-10T10:00' });
        });

        const { months, series, totalPerMonth } = computeTimelineData(items, '2026-07', '2026-07');
        expect(months).toEqual(['2026-07']);
        expect(series).toHaveLength(5);
        expect(series.map(s => s.label)).toEqual(['A', 'B', 'C', 'D', 'E']); // top 5 by total, F excluded
        // total geral must include F's amount (10) too: 60+50+40+30+20+10 = 210
        expect(totalPerMonth).toEqual([210]);
    });

    it('spreads amounts into the correct month bucket', () => {
        const items = [
            { amount: 100, location: 'Bonanza', date: '2026-06-05T10:00' },
            { amount: 50, location: 'Bonanza', date: '2026-07-05T10:00' }
        ];
        const { months, series } = computeTimelineData(items, '2026-06', '2026-07');
        expect(months).toEqual(['2026-06', '2026-07']);
        expect(series[0]).toEqual({ label: 'Bonanza', data: [100, 50] });
    });
});

describe('findProductMatches', () => {
    const transactions = [
        { type: 'gasto_cc', description: 'Café expresso', date: '2026-07-05T10:00' },
        { type: 'gasto_cartao', description: 'Pão francês', date: '2026-07-01T10:00' },
        { type: 'entrada', description: 'Café em grãos', date: '2026-07-03T10:00' }, // wrong type
        { type: 'gasto_cc', description: 'CAFE gelado', date: '2026-06-01T10:00' }
    ];

    it('matches accent/case-insensitively on description, sorted by date ascending', () => {
        const result = findProductMatches(transactions, 'café', 'todos');
        expect(result.map(t => t.description)).toEqual(['CAFE gelado', 'Café expresso']);
    });

    it('respects the origin filter', () => {
        const result = findProductMatches(transactions, 'pão', 'gasto_cartao');
        expect(result).toHaveLength(1);
        expect(findProductMatches(transactions, 'pão', 'gasto_cc')).toHaveLength(0);
    });
});

describe('buildProductChartData', () => {
    it('groups points by location and lists unique sorted dates', () => {
        const matches = [
            { location: 'Bonanza', date: '2026-07-01T10:00', description: 'x', amount: 5 },
            { location: 'Bonanza', date: '2026-07-10T10:00', description: '2x R$3,00', amount: 6 },
            { location: '', date: '2026-06-15T10:00', description: 'x', amount: 4 }
        ];
        const { byLoc, allDates } = buildProductChartData(matches);
        expect(Object.keys(byLoc).sort()).toEqual(['Bonanza', 'Sem local']);
        expect(byLoc['Bonanza']).toEqual([
            { x: '2026-07-01', y: 5 },
            { x: '2026-07-10', y: 3 }
        ]);
        expect(allDates).toEqual(['2026-06-15', '2026-07-01', '2026-07-10']);
    });
});

describe('computeMinUnitPrice / buildProductTableHtml', () => {
    const matches = [
        { location: 'Bonanza', description: 'Café 1kg', amount: 25, date: '2026-07-01T10:00' },
        { location: 'Posto', description: 'Café 1kg (2x R$10,00)', amount: 20, date: '2026-07-05T10:00' }
    ];

    it('finds the minimum unit price across derived and non-derived entries', () => {
        expect(computeMinUnitPrice(matches)).toBe(10);
    });

    it('renders a table marking the cheapest row and escaping HTML in free-text fields', () => {
        const html = buildProductTableHtml([
            ...matches,
            { location: '<img onerror=alert(1)>', description: 'Malicious"item', amount: 1, date: '2026-07-06T10:00' }
        ]);
        expect(html).toContain('<table class="matches">');
        expect(html).toContain('best-price');
        expect(html).toContain('🏆');
        expect(html).not.toContain('<img onerror');
        expect(html).toContain('&lt;img onerror=alert(1)&gt;');
        expect(html).toContain('Malicious&quot;item');
    });

    it('marks non-derived quantities with an asterisk', () => {
        const html = buildProductTableHtml(matches);
        expect(html).toContain('1*'); // Bonanza entry has no "NxR$" pattern -> derived: false
    });
});
