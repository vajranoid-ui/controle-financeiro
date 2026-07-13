// =====================================================
// LÓGICA PURA DA PÁGINA DE ANÁLISE DE PREÇOS (sem DOM / sem Firebase)
// Extraído de analise.html para permitir testes automatizados.
// =====================================================

export function formatCurrency(val) {
    return (val ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function normalize(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function monthKey(dateStr) {
    return String(dateStr || '').slice(0, 7);
}

export function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

export function locationOf(t) {
    return (t.location || '').trim() || 'Sem local';
}

export function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Extrai quantidade e preço unitário de descrições como "(3x R$10,00)". Quando o padrão não
// é encontrado, assume 1 unidade e usa o valor total do registro como preço unitário.
export function unitInfo(t) {
    const desc = String(t.description || '');
    const m = desc.match(/(\d+)\s*x\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i);
    if (m) {
        const qty = parseInt(m[1], 10);
        const unit = parseFloat(m[2].replace(',', '.'));
        if (qty > 0 && !isNaN(unit)) return { qty, unit, derived: true };
    }
    return { qty: 1, unit: t.amount, derived: false };
}

export function monthsBetween(from, to) {
    const out = [];
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m++; if (m > 12) { m = 1; y++; }
        if (out.length > 60) break; // trava de segurança
    }
    return out;
}

// =====================================================
// FILTRO PRINCIPAL DO PAINEL
// =====================================================
export function filterExpenses(transactions, { from, to, origin } = {}) {
    const f = from || '0000-00';
    const t2 = to || '9999-99';
    return transactions.filter(t => {
        if (t.type !== 'gasto_cc' && t.type !== 'gasto_cartao') return false;
        if (origin && origin !== 'todos' && t.type !== origin) return false;
        const mk = monthKey(t.date);
        return mk >= f && mk <= t2;
    });
}

// =====================================================
// GRÁFICO 1: GASTOS POR ESTABELECIMENTO
// =====================================================
export function computeLocationTotals(items) {
    const totals = {};
    items.forEach(t => { totals[locationOf(t)] = (totals[locationOf(t)] || 0) + t.amount; });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

// =====================================================
// GRÁFICO 2: LINHA DO TEMPO (top 5 estabelecimentos + total geral)
// =====================================================
export function computeTimelineData(items, from, to) {
    const months = monthsBetween(from, to);
    const totalsByLoc = {};
    items.forEach(t => { totalsByLoc[locationOf(t)] = (totalsByLoc[locationOf(t)] || 0) + t.amount; });
    const topLocs = Object.entries(totalsByLoc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(r => r[0]);

    const series = topLocs.map(loc => ({
        label: loc,
        data: months.map(mk =>
            items.filter(t => locationOf(t) === loc && monthKey(t.date) === mk)
                 .reduce((s, t) => s + t.amount, 0)
        )
    }));

    // O total geral soma TODOS os estabelecimentos do mês, não apenas o top 5.
    const totalPerMonth = months.map(mk =>
        items.filter(t => monthKey(t.date) === mk).reduce((s, t) => s + t.amount, 0)
    );

    return { months, monthLabels: months.map(monthLabel), series, totalPerMonth };
}

// =====================================================
// GRÁFICO 3: COMPARADOR DE PREÇO DE PRODUTO
// =====================================================
// Busca em TODO o histórico de gastos (ignora o filtro de período do painel para dar visão completa).
export function findProductMatches(transactions, queryRaw, origin) {
    const query = normalize(queryRaw);
    return transactions.filter(t => {
        if (t.type !== 'gasto_cc' && t.type !== 'gasto_cartao') return false;
        if (origin && origin !== 'todos' && t.type !== origin) return false;
        return normalize(t.description).includes(query);
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Uma série por estabelecimento; pontos = preço unitário no tempo.
export function buildProductChartData(matches) {
    const byLoc = {};
    matches.forEach(t => {
        const loc = locationOf(t);
        if (!byLoc[loc]) byLoc[loc] = [];
        const u = unitInfo(t);
        byLoc[loc].push({ x: t.date.slice(0, 10), y: u.unit });
    });
    const allDates = [...new Set(matches.map(t => t.date.slice(0, 10)))].sort();
    return { byLoc, allDates };
}

export function computeMinUnitPrice(matches) {
    return Math.min(...matches.map(t => unitInfo(t).unit));
}

// Tabela de compras encontradas, destacando o menor preço unitário.
export function buildProductTableHtml(matches) {
    const minUnit = computeMinUnitPrice(matches);
    let html = '<table class="matches"><thead><tr><th>Data</th><th>Estabelecimento</th><th>Descrição</th><th>Qtd.</th><th>Preço unit.</th><th>Total pago</th></tr></thead><tbody>';
    [...matches].reverse().forEach(t => {
        const u = unitInfo(t);
        const d = new Date(t.date);
        const isBest = Math.abs(u.unit - minUnit) < 0.005;
        html += `<tr>
                    <td>${d.toLocaleDateString('pt-BR')}</td>
                    <td>${escapeHtml(locationOf(t))}</td>
                    <td>${escapeHtml(t.description || 'Sem descrição')}</td>
                    <td>${u.qty}${u.derived ? '' : '*'}</td>
                    <td class="${isBest ? 'best-price' : ''}">${formatCurrency(u.unit)}${isBest ? ' 🏆' : ''}</td>
                    <td>${formatCurrency(t.amount)}</td>
                </tr>`;
    });
    html += '</tbody></table><p class="hint">* Quantidade não identificada na descrição; considerado 1 unidade (preço unitário = valor do registro). 🏆 = menor preço unitário encontrado.</p>';
    return html;
}
