// =====================================================
// LÓGICA FINANCEIRA PURA (sem DOM / sem Firebase)
// Extraído de index.html para permitir testes automatizados.
// =====================================================

export const VALID_TYPES = ['entrada', 'gasto_cc', 'gasto_cartao'];

export const VALID_CATEGORIES = [
    'Lanche', 'Transporte', 'Assinatura',
    'Pets', 'Mercado', 'Farmácia', 'Contas', 'Educação & Esportes',
    'Receita / Salário', 'Outros'
];

export const VALID_OWNERS = ['Conjunta', 'Marcelo', 'Amanda'];

// Renomeações de categorias antigas para as atuais (migração de dados legados).
export const LEGACY_CATEGORY_RENAMES = {
    'Família & Pets': 'Pets',
    'Assinaturas (IA & Softwares)': 'Assinatura',
    'Assinaturas': 'Assinatura',
    'Alimentação / Fast Food': 'Lanche',
    'Lanches': 'Lanche'
};

export function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// =====================================================
// PLANEJAMENTO: MÉDIAS DIÁRIA E SEMANAL ATÉ UMA DATA
// =====================================================
export function daysUntilInclusive(targetDateStr, now) {
    // Conta o dia de hoje e o dia-alvo. Ex.: hoje dia 03, alvo dia 31 -> 29 dias.
    const [y, m, d] = targetDateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((target - today) / 86400000);
    return diff < 0 ? 0 : diff + 1;
}

export function calcPlanning(baseValue, targetDateStr, now) {
    const days = daysUntilInclusive(targetDateStr, now);
    if (days <= 0) return { days: 0, daily: 0, weekly: 0 };
    const daily = baseValue / days;
    return { days, daily, weekly: daily * 7 };
}

export function defaultTargetDate(now = new Date()) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return lastDay.toISOString().slice(0, 10);
}

// Fatura do cartão acumulada até uma data-limite. Não exclui lançamentos futuros dentro do
// mês: uma compra no cartão já é um compromisso assumido, diferente de uma entrada/saída de
// conta corrente que só se efetiva na data agendada.
export function sumCardInvoiceUpTo(transactions, endDate) {
    let total = 0;
    transactions.forEach(t => {
        if (new Date(t.date) > endDate) return;
        if (t.type === 'gasto_cartao' || t.type === 'ajuste_cartao_aumento') total += t.amount;
        if (t.type === 'pagamento_fatura' || t.type === 'ajuste_cartao_reducao') total -= t.amount;
    });
    return total;
}

// Saldo da Conta Corrente até uma data-limite, ignorando lançamentos ainda futuros (agendados
// mas não efetivados).
export function sumCCBalanceUpTo(transactions, endDate, now) {
    let total = 0;
    transactions.forEach(t => {
        const txDate = new Date(t.date);
        if (txDate > endDate || txDate > now) return;
        if (t.type === 'entrada' || t.type === 'ajuste_cc_entrada') total += t.amount;
        if (t.type === 'gasto_cc' || t.type === 'pagamento_fatura' || t.type === 'ajuste_cc_saida') total -= t.amount;
    });
    return total;
}

// Metadados de exibição por tipo de transação (compartilhado entre extrato, arquivo e exportações).
export function txDisplayMeta(t, isFuture) {
    switch (t.type) {
        case 'entrada': case 'ajuste_cc_entrada':
            return { origin: t.type === 'entrada' ? 'Conta Corrente' : 'Ajuste Sistêmico', cls: isFuture ? 'text-future' : 'text-in', sign: '+ ' };
        case 'gasto_cc': case 'ajuste_cc_saida':
            return { origin: t.type === 'gasto_cc' ? 'Conta Corrente' : 'Ajuste Sistêmico', cls: isFuture ? 'text-future' : 'text-out', sign: '- ' };
        case 'gasto_cartao': case 'ajuste_cartao_aumento':
            return { origin: t.type === 'gasto_cartao' ? 'Cartão de Crédito' : 'Ajuste Sistêmico', cls: 'text-out', sign: '- ' };
        case 'pagamento_fatura':
            return { origin: 'C. Corrente → Cartão', cls: 'text-neutral', sign: ' ' };
        case 'ajuste_cartao_reducao':
            return { origin: 'Ajuste Sistêmico', cls: 'text-in', sign: '+ ' };
        default:
            return { origin: '—', cls: 'text-neutral', sign: '' };
    }
}

// =====================================================
// RESUMOS POR CATEGORIA / PESSOA (mês de referência selecionado)
// =====================================================
export function computeCategoryTotals(transactions, selYear, selMonth) {
    const totals = {};
    let grandTotal = 0;
    transactions.forEach(t => {
        if (t.type !== 'gasto_cc' && t.type !== 'gasto_cartao') return;
        const tDate = new Date(t.date);
        if (tDate.getMonth() !== selMonth || tDate.getFullYear() !== selYear) return;
        const cat = t.category || 'Outros';
        totals[cat] = (totals[cat] || 0) + t.amount;
        grandTotal += t.amount;
    });
    return { totals, grandTotal };
}

export function computeOwnerTotals(transactions, selYear, selMonth) {
    const totals = { 'Conjunta': 0, 'Marcelo': 0, 'Amanda': 0 };
    transactions.forEach(t => {
        if (t.type !== 'gasto_cc' && t.type !== 'gasto_cartao') return;
        const tDate = new Date(t.date);
        if (tDate.getMonth() !== selMonth || tDate.getFullYear() !== selYear) return;
        const owner = totals.hasOwnProperty(t.owner) ? t.owner : 'Conjunta';
        totals[owner] += t.amount;
    });
    return totals;
}

// =====================================================
// IMPORTAÇÃO VIA JSON (fluxo: foto do cupom → Claude → colar no app)
// =====================================================
export function validateImportItem(item, idx) {
    const errors = [];
    const tx = {
        type: String(item.type || 'gasto_cc').trim(),
        amount: parseFloat(item.amount),
        category: String(item.category || 'Outros').trim(),
        date: String(item.date || '').trim(),
        description: String(item.description || '').trim(),
        location: String(item.location || '').trim(),
        owner: VALID_OWNERS.includes(String(item.owner || '').trim()) ? String(item.owner).trim() : 'Conjunta'
    };
    if (!VALID_TYPES.includes(tx.type)) errors.push(`Item ${idx + 1}: tipo "${tx.type}" inválido (use: ${VALID_TYPES.join(', ')}).`);
    if (isNaN(tx.amount) || tx.amount <= 0) errors.push(`Item ${idx + 1}: valor inválido.`);
    if (!VALID_CATEGORIES.includes(tx.category)) tx.category = 'Outros';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(tx.date)) errors.push(`Item ${idx + 1}: data inválida (use AAAA-MM-DDTHH:MM).`);
    else tx.date = tx.date.slice(0, 16);
    return { tx, errors };
}

// =====================================================
// MIGRAÇÃO DE CATEGORIAS ANTIGAS
// =====================================================
// Retorna a lista de transações que precisam ser migradas para a nova categoria,
// ignorando as que já constam em alreadyMigratedIds (evita reenviar a mesma escrita).
export function findLegacyCategoryMigrations(transactions, renames, alreadyMigratedIds = new Set()) {
    const result = [];
    transactions.forEach(t => {
        const novaCat = renames[t.category];
        if (novaCat && !alreadyMigratedIds.has(t.id)) {
            result.push({ id: t.id, newCategory: novaCat });
        }
    });
    return result;
}

// Migra as metas de categoria (categoryBudgets) que usam nomes antigos, mesclando o valor na
// categoria nova quando ela ainda não tiver meta definida.
export function migrateLegacyBudgets(categoryBudgets, renames) {
    const novos = { ...categoryBudgets };
    let mudou = false;
    Object.entries(renames).forEach(([antiga, nova]) => {
        if (!(antiga in novos)) return;
        if (novos[nova] === undefined) novos[nova] = novos[antiga];
        delete novos[antiga];
        mudou = true;
    });
    return { novos, mudou };
}

// =====================================================
// ARQUIVO DE MESES ANTERIORES
// =====================================================
export function monthKeyOf(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function buildArchiveData(transactions, now) {
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const groups = {};
    transactions.forEach(t => {
        const key = monthKeyOf(t.date);
        if (key >= currentKey) return; // arquiva apenas meses já encerrados
        if (!groups[key]) groups[key] = { key, entradas: 0, saidas: 0, count: 0, items: [] };
        const g = groups[key];
        g.count++;
        g.items.push(t);
        if (t.type === 'entrada' || t.type === 'ajuste_cc_entrada') g.entradas += t.amount;
        if (t.type === 'gasto_cc' || t.type === 'gasto_cartao' || t.type === 'ajuste_cc_saida') g.saidas += t.amount;
    });
    return Object.values(groups).sort((a, b) => b.key.localeCompare(a.key));
}

export function csvEscape(v) {
    return `"${String(v ?? '').replaceAll('"', '""')}"`;
}

// Monta as linhas (sem BOM/Blob, que são detalhes do navegador) do CSV de um mês arquivado.
export function buildArchiveCsvLines(group) {
    const lines = ['Data;Descricao;Local;Pessoa;Categoria;Tipo;Valor'];
    const sorted = [...group.items].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach(t => {
        const meta = txDisplayMeta(t, false);
        const signedValue = (meta.sign.trim() === '-' ? -t.amount : t.amount).toFixed(2).replace('.', ',');
        lines.push([
            csvEscape(formatDate(t.date)),
            csvEscape(t.description || 'Sem descrição'),
            csvEscape(t.location || ''),
            csvEscape(t.owner || 'Conjunta'),
            csvEscape(t.category),
            csvEscape(meta.origin),
            csvEscape(signedValue)
        ].join(';'));
    });
    lines.push('');
    lines.push([csvEscape('TOTAL ENTRADAS'), '', '', '', '', '', csvEscape(group.entradas.toFixed(2).replace('.', ','))].join(';'));
    lines.push([csvEscape('TOTAL SAIDAS'), '', '', '', '', '', csvEscape(('-' + group.saidas.toFixed(2)).replace('.', ','))].join(';'));
    lines.push([csvEscape('RESULTADO'), '', '', '', '', '', csvEscape((group.entradas - group.saidas).toFixed(2).replace('.', ','))].join(';'));
    return lines;
}

// =====================================================
// EXPORTAR DADOS (Excel / PDF / Markdown)
// =====================================================
// Monta as linhas do extrato completo (todas as transações, mais recentes primeiro)
// reaproveitadas pelas três exportações para manter os dados consistentes entre formatos.
export function buildExportRows(transactions, now = new Date()) {
    const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
    return sorted.map(t => {
        const isFuture = new Date(t.date) > now;
        const meta = txDisplayMeta(t, isFuture);
        const signedValue = meta.sign.trim() === '-' ? -t.amount : t.amount;
        return {
            date: formatDate(t.date),
            description: t.description || 'Sem descrição',
            location: t.location || '',
            owner: t.owner || 'Conjunta',
            category: t.category || 'Outros',
            origin: meta.origin,
            value: signedValue
        };
    });
}

export function buildExportSummary(lastComputedBalances, creditLimitTotal) {
    return [
        ['Conta Corrente (disponível hoje)', lastComputedBalances.currentCC],
        ['Saldo Projetado (com agendados)', lastComputedBalances.projectedCC],
        ['Limite Total do Cartão', creditLimitTotal]
    ];
}
