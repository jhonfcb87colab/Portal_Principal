(() => {
    'use strict';

    const DATA = window.DASHBOARD_DATA;
    if (!DATA) return;

    const { meta, facts } = DATA;
    const D = meta.dims;
    const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const YEAR_COLORS = ['#B0C4DE', '#7FFFD4', '#12239E', '#000000'];
    const CATEGORY_COLORS = ['#B0C4DE', '#7FFFD4', '#12239E'];
    const ACCENT = '#12239E';

    const nfInt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
    const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const state = {
        years: new Set(meta.years.map(String)),
        regions: new Set(D.regions),
        categories: new Set(D.categories),
        segments: new Set(D.segments),
        tab: 'resumen',
        productSearch: '',
        productSort: 'sales',
        productDir: 'desc',
        productPage: 0
    };

    const FILTER_DEFS = [
        { key: 'years', label: 'Año', values: meta.years.map(String) },
        { key: 'regions', label: 'Región', values: D.regions },
        { key: 'categories', label: 'Categoría', values: D.categories },
        { key: 'segments', label: 'Segmento', values: D.segments }
    ];

    const $ = (id) => document.getElementById(id);
    const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = (value) => String(value).replace(/[&<>"']/g, (char) => escMap[char]);
    const escAttr = esc;

    let lastStats = null;
    let toastTimer = null;

    function formatNumber(value) {
        return nfInt.format(Number.isFinite(value) ? value : 0);
    }

    function formatPercent(fraction) {
        if (!Number.isFinite(fraction)) return '—';
        return `${nf1.format(fraction * 100)} %`;
    }

    function compactMoney(value) {
        const amount = Number.isFinite(value) ? value : 0;
        const abs = Math.abs(amount);
        const sign = amount < 0 ? '-' : '';
        if (abs >= 1000000) return `${sign}$${nf2.format(abs / 1000000)} M`;
        if (abs >= 1000) return `${sign}$${nf1.format(abs / 1000)} K`;
        return `${sign}$${nfInt.format(abs)}`;
    }

    function fullMoney(value) {
        const amount = Number.isFinite(value) ? value : 0;
        const sign = amount < 0 ? '-' : '';
        return `${sign}$${nf2.format(Math.abs(amount))}`;
    }

    function axisMoney(value) {
        const amount = Number.isFinite(value) ? value : 0;
        if (amount >= 1000000) return `$${nf1.format(amount / 1000000)} M`;
        if (amount >= 1000) return `$${Math.round(amount / 1000)} K`;
        return `$${Math.round(amount)}`;
    }

    function shortText(value, max) {
        const text = String(value);
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    function newGroup() {
        return { sales: 0, profit: 0, qty: 0, discount: 0, orders: new Set(), customers: new Set() };
    }

    function absorb(group, row) {
        group.sales += row[6];
        group.profit += row[7];
        group.qty += row[8];
        group.discount += row[9];
        group.orders.add(row[10]);
        group.customers.add(row[11]);
    }

    function finalize(group) {
        const sales = group.sales;
        const orders = group.orders.size;
        const customers = group.customers.size;
        return {
            sales,
            profit: group.profit,
            qty: group.qty,
            discount: group.discount,
            orders,
            customers,
            margin: sales ? group.profit / sales : 0,
            ticket: orders ? sales / orders : 0
        };
    }

    function summarize(rows) {
        const group = newGroup();
        rows.forEach((row) => absorb(group, row));
        return finalize(group);
    }

    function computeStats(rows) {
        const totals = newGroup();
        const byCategory = D.categories.map(() => newGroup());
        const byRegion = D.regions.map(() => newGroup());
        const bySegment = D.segments.map(() => newGroup());
        const monthly = Array.from({ length: 12 }, () => newGroup());
        const byYear = new Map();
        const yearMonth = new Map();
        const byProduct = new Map();
        const byCustomer = new Map();

        rows.forEach((row) => {
            const month = (row[0] % 100) - 1;
            const year = Math.floor(row[0] / 100);
            const productIndex = row[4];
            const customerToken = row[11];

            absorb(totals, row);
            absorb(byCategory[row[2]], row);
            absorb(byRegion[row[1]], row);
            absorb(bySegment[row[3]], row);
            absorb(monthly[month], row);

            if (!byYear.has(year)) byYear.set(year, newGroup());
            absorb(byYear.get(year), row);

            if (!yearMonth.has(year)) yearMonth.set(year, Array.from({ length: 12 }, () => newGroup()));
            absorb(yearMonth.get(year)[month], row);

            if (!byProduct.has(productIndex)) {
                const group = newGroup();
                group.category = row[2];
                group.subcategory = row[5];
                byProduct.set(productIndex, group);
            }
            absorb(byProduct.get(productIndex), row);

            if (!byCustomer.has(customerToken)) {
                const group = newGroup();
                group.segment = row[3];
                byCustomer.set(customerToken, group);
            }
            absorb(byCustomer.get(customerToken), row);
        });

        const productList = [...byProduct].map(([idx, group]) => ({
            idx,
            category: group.category,
            subcategory: group.subcategory,
            ...finalize(group)
        })).sort((a, b) => b.sales - a.sales);

        const customerList = [...byCustomer].map(([token, group]) => ({
            token,
            segment: group.segment,
            ...finalize(group)
        })).sort((a, b) => b.sales - a.sales);

        return {
            totals: finalize(totals),
            byCategory: byCategory.map(finalize),
            byRegion: byRegion.map(finalize),
            bySegment: bySegment.map(finalize),
            monthly: monthly.map(finalize),
            byYear: new Map([...byYear].map(([year, group]) => [year, finalize(group)])),
            yearMonth: new Map([...yearMonth].map(([year, groups]) => [year, groups.map(finalize)])),
            productList,
            customerList
        };
    }

    function getFilteredRows() {
        return facts.filter((row) => {
            const year = String(Math.floor(row[0] / 100));
            return state.years.has(year)
                && state.regions.has(D.regions[row[1]])
                && state.categories.has(D.categories[row[2]])
                && state.segments.has(D.segments[row[3]]);
        });
    }

    function getComparison() {
        const selectedYears = [...state.years].map(Number);
        if (!selectedYears.length) return null;
        const latest = Math.max(...selectedYears);
        const prior = latest - 1;

        const base = facts.filter((row) => {
            const year = Math.floor(row[0] / 100);
            return (year === latest || year === prior)
                && state.regions.has(D.regions[row[1]])
                && state.categories.has(D.categories[row[2]])
                && state.segments.has(D.segments[row[3]]);
        });

        const current = summarize(base.filter((row) => Math.floor(row[0] / 100) === latest));
        const previous = summarize(base.filter((row) => Math.floor(row[0] / 100) === prior));

        return {
            latest,
            prior,
            current,
            previous,
            hasPrevious: previous.orders > 0 || previous.sales !== 0
        };
    }

    function deltaPct(current, previous) {
        if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
        return ((current - previous) / Math.abs(previous)) * 100;
    }

    function deltaChip(value, unit) {
        if (!Number.isFinite(value)) return '<span class="delta flat">s/d</span>';
        const up = value >= 0;
        const suffix = unit || '%';
        return `<span class="delta ${up ? 'up' : 'down'}">${up ? '+' : '−'}${nf1.format(Math.abs(value))} ${suffix}</span>`;
    }

    function sparkline(values) {
        if (!values || !values.length) return '';
        const width = 66;
        const height = 23;
        const pad = 2;
        const max = Math.max(...values);
        const min = Math.min(...values);
        const range = max - min || 1;
        const points = values.map((value, index) => {
            const x = pad + (index * (width - pad * 2)) / Math.max(values.length - 1, 1);
            const y = height - pad - ((value - min) / range) * (height - pad * 2);
            return [x, y];
        });
        const line = points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
        const last = points[points.length - 1];
        return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true">
            <path d="${line}" fill="none" stroke="#B0C4DE" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.8" fill="#000000"></circle>
        </svg>`;
    }

    function emptyState(message) {
        return `<div class="empty"><span class="empty-mark">∅</span><span>${esc(message || 'Sin datos para los filtros seleccionados.')}</span></div>`;
    }

    function kpiCard({ label, value, full, delta, unit, note, spark }) {
        return `<article class="kpi">
            <div class="kpi-head">
                <span class="kpi-label">${esc(label)}</span>
                ${deltaChip(delta, unit)}
            </div>
            <div class="kpi-value" title="${escAttr(full || value)}">${value}</div>
            <div class="kpi-foot">
                <span class="kpi-note">${esc(note)}</span>
                ${spark ? sparkline(spark) : ''}
            </div>
        </article>`;
    }

    function renderKpis(stats, comparison) {
        const periodNote = comparison ? `${comparison.latest} vs ${comparison.prior}` : 'Sin comparativo';
        const hasPrevious = comparison && comparison.hasPrevious;
        const deltas = {
            sales: hasPrevious ? deltaPct(comparison.current.sales, comparison.previous.sales) : null,
            profit: hasPrevious ? deltaPct(comparison.current.profit, comparison.previous.profit) : null,
            margin: hasPrevious ? (comparison.current.margin - comparison.previous.margin) * 100 : null,
            ticket: hasPrevious ? deltaPct(comparison.current.ticket, comparison.previous.ticket) : null,
            orders: hasPrevious ? deltaPct(comparison.current.orders, comparison.previous.orders) : null,
            customers: hasPrevious ? deltaPct(comparison.current.customers, comparison.previous.customers) : null
        };

        const cards = [
            {
                label: 'Ventas totales',
                value: compactMoney(stats.totals.sales),
                full: fullMoney(stats.totals.sales),
                delta: deltas.sales,
                note: periodNote,
                spark: stats.monthly.map((item) => item.sales)
            },
            {
                label: 'Ganancia total',
                value: compactMoney(stats.totals.profit),
                full: fullMoney(stats.totals.profit),
                delta: deltas.profit,
                note: periodNote,
                spark: stats.monthly.map((item) => item.profit)
            },
            {
                label: 'Margen',
                value: formatPercent(stats.totals.margin),
                full: `Margen sobre ventas: ${formatPercent(stats.totals.margin)}`,
                delta: deltas.margin,
                unit: 'pp',
                note: periodNote,
                spark: stats.monthly.map((item) => item.margin)
            },
            {
                label: 'Ticket promedio',
                value: compactMoney(stats.totals.ticket),
                full: fullMoney(stats.totals.ticket),
                delta: deltas.ticket,
                note: periodNote,
                spark: stats.monthly.map((item) => item.ticket)
            },
            {
                label: 'Pedidos',
                value: formatNumber(stats.totals.orders),
                full: formatNumber(stats.totals.orders),
                delta: deltas.orders,
                note: periodNote,
                spark: stats.monthly.map((item) => item.orders)
            },
            {
                label: 'Clientes únicos',
                value: formatNumber(stats.totals.customers),
                full: formatNumber(stats.totals.customers),
                delta: deltas.customers,
                note: periodNote,
                spark: stats.monthly.map((item) => item.customers)
            }
        ];

        $('kpiGrid').innerHTML = cards.map(kpiCard).join('');
    }

    function niceMax(value) {
        if (!Number.isFinite(value) || value <= 0) return 1;
        const exponent = Math.floor(Math.log10(value));
        const fraction = value / (10 ** exponent);
        const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
        const niceFraction = steps.find((step) => fraction <= step) || 10;
        return niceFraction * (10 ** exponent);
    }

    function monthTooltip(monthIndex, series, formatValue) {
        const rows = series.map((item) => `<div class="tooltip-row">
            <span><i class="tooltip-dot" style="background:${item.color}"></i>${esc(item.label)}</span>
            <b>${formatValue(item.values[monthIndex])}</b>
        </div>`).join('');
        return `<div class="tooltip-title">${MONTHS_LONG[monthIndex]}</div>${rows}`;
    }

    function renderLineChart(target, series, options) {
        const opts = options || {};
        const width = 760;
        const height = opts.height || 300;
        const pad = { left: 57, right: 14, top: 16, bottom: 30 };
        const values = series.flatMap((item) => item.values);
        const rawMax = Math.max(...values, 0);

        if (!values.length || rawMax <= 0) {
            target.innerHTML = emptyState('Sin ventas para la selección actual.');
            return;
        }

        const max = niceMax(rawMax);
        const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / 11;
        const y = (value) => pad.top + (height - pad.top - pad.bottom) * (1 - value / max);
        const step = (width - pad.left - pad.right) / 11;
        const formatValue = opts.tipFormat || fullMoney;
        let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escAttr(opts.aria || 'Serie mensual de ventas')}">`;

        for (let index = 0; index <= 4; index += 1) {
            const value = (max * index) / 4;
            const lineY = y(value);
            svg += `<line class="grid-line" x1="${pad.left}" y1="${lineY.toFixed(2)}" x2="${width - pad.right}" y2="${lineY.toFixed(2)}"></line>`;
            svg += `<text class="axis-label" x="${pad.left - 8}" y="${(lineY + 3).toFixed(2)}" text-anchor="end">${axisMoney(value)}</text>`;
        }

        MONTHS.forEach((month, index) => {
            svg += `<text class="axis-label" x="${x(index).toFixed(2)}" y="${height - 10}" text-anchor="middle">${month}</text>`;
        });

        series.forEach((item) => {
            if (!item.area) return;
            const points = item.values.map((value, index) => `${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(' L ');
            svg += `<path class="area-path" d="M ${points} L ${x(11).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z" fill="${item.color}"></path>`;
        });

        series.forEach((item, seriesIndex) => {
            const line = item.values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(' ');
            svg += `<path class="line-path" pathLength="1" d="${line}" stroke="${item.color}" style="animation-delay:${seriesIndex * 90}ms"></path>`;
        });

        series.forEach((item) => {
            item.values.forEach((value, index) => {
                svg += `<circle class="point" cx="${x(index).toFixed(2)}" cy="${y(value).toFixed(2)}" r="2.1" fill="${item.color}"></circle>`;
            });
        });

        for (let index = 0; index < 12; index += 1) {
            const tip = monthTooltip(index, series, formatValue);
            svg += `<rect class="hit" x="${(x(index) - step / 2).toFixed(2)}" y="${pad.top}" width="${step.toFixed(2)}" height="${height - pad.top - pad.bottom}" data-tip="${escAttr(tip)}" aria-label="${MONTHS_LONG[index]}"></rect>`;
        }

        svg += '</svg>';

        const legend = series.length > 1
            ? `<div class="chart-legend">${series.map((item) => `<span class="legend-item"><span class="legend-dot" style="background:${item.color}"></span>${esc(item.label)}</span>`).join('')}</div>`
            : '';

        target.innerHTML = svg + legend;
    }

    function renderCategoryDonut(stats) {
        const target = $('chartCategory');
        const total = stats.totals.sales;
        if (!total) {
            target.innerHTML = emptyState('Sin ventas para la selección actual.');
            return;
        }

        const items = D.categories.map((label, index) => ({
            label,
            value: stats.byCategory[index].sales,
            color: CATEGORY_COLORS[index % CATEGORY_COLORS.length]
        })).sort((a, b) => b.value - a.value);

        const radius = 58;
        const circumference = 2 * Math.PI * radius;
        let offset = 0;
        const segments = items.map((item) => {
            const fraction = item.value / total;
            const length = fraction * circumference;
            const tip = `<div class="tooltip-title">${esc(item.label)}</div>
                <div class="tooltip-row"><span>Ventas</span><b>${fullMoney(item.value)}</b></div>
                <div class="tooltip-row"><span>Participación</span><b>${formatPercent(fraction)}</b></div>`;
            const segment = `<circle class="donut-segment" cx="80" cy="80" r="${radius}" stroke="${item.color}" stroke-dasharray="${length.toFixed(3)} ${(circumference - length).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}" data-tip="${escAttr(tip)}"></circle>`;
            offset += length;
            return segment;
        }).join('');

        const legend = items.map((item) => `<div class="legend-row">
            <span class="legend-dot" style="background:${item.color}"></span>
            <span class="legend-name">${esc(item.label)}</span>
            <span class="legend-value">${compactMoney(item.value)}<small>${formatPercent(item.value / total)}</small></span>
        </div>`).join('');

        target.innerHTML = `<div class="donut-wrap">
            <div class="donut">
                <svg viewBox="0 0 160 160" role="img" aria-label="Participación de ventas por categoría">${segments}</svg>
                <div class="donut-center"><strong>${compactMoney(total)}</strong><span>Ventas</span></div>
            </div>
            <div class="donut-legend">${legend}</div>
        </div>`;
    }

    function renderBars(target, items, options) {
        const opts = options || {};
        if (!items.length) {
            target.innerHTML = emptyState();
            return;
        }
        const max = Math.max(...items.map((item) => item.value), 1);
        target.innerHTML = items.map((item, index) => {
            const width = item.value > 0 ? Math.max(1.5, (item.value / max) * 100) : 0;
            const tip = `<div class="tooltip-title">${esc(item.label)}</div>
                <div class="tooltip-row"><span>${esc(opts.valueLabel || 'Ventas')}</span><b>${opts.valueFormat ? opts.valueFormat(item.value) : compactMoney(item.value)}</b></div>
                ${item.tip ? `<div class="tooltip-note">${esc(item.tip)}</div>` : ''}`;
            return `<div class="bar-row" data-tip="${escAttr(tip)}">
                <span class="bar-name" title="${escAttr(item.label)}">${esc(item.label)}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${width.toFixed(1)}%; animation-delay:${index * 45}ms"></span></span>
                <span class="bar-value">${opts.valueFormat ? opts.valueFormat(item.value) : compactMoney(item.value)}<small>${esc(item.note || '')}</small></span>
            </div>`;
        }).join('');
    }

    function renderResumen(stats, comparison) {
        const monthlySales = stats.monthly.map((item) => item.sales);
        const selectedYears = [...state.years].map(Number).sort((a, b) => a - b);
        const trendLabel = selectedYears.length === 0
            ? 'Sin periodo'
            : selectedYears.length === 1
                ? String(selectedYears[0])
                : `${selectedYears[0]}–${selectedYears[selectedYears.length - 1]}`;

        $('trendTag').textContent = trendLabel;
        renderLineChart($('chartTrend'), [{
            label: 'Ventas',
            values: monthlySales,
            color: '#000000',
            area: true
        }], {
            height: 300,
            aria: 'Ventas acumuladas por mes',
            tipFormat: fullMoney
        });

        renderCategoryDonut(stats);

        const regions = D.regions.map((label, index) => ({
            label,
            value: stats.byRegion[index].sales,
            note: `${formatPercent(stats.byRegion[index].margin)} margen`,
            tip: `${formatNumber(stats.byRegion[index].orders)} pedidos`
        })).sort((a, b) => b.value - a.value);

        renderBars($('chartRegion'), regions, {
            valueLabel: 'Ventas',
            valueFormat: compactMoney
        });

        const segments = D.segments.map((label, index) => ({
            label,
            value: stats.bySegment[index].sales,
            note: `${formatNumber(stats.bySegment[index].customers)} clientes`,
            tip: `${formatPercent(stats.bySegment[index].margin)} margen`
        })).sort((a, b) => b.value - a.value);

        renderBars($('chartSegment'), segments, {
            valueLabel: 'Ventas',
            valueFormat: compactMoney
        });

        renderInsights(stats, comparison);
    }

    function renderInsights(stats, comparison) {
        const target = $('insights');
        const categories = D.categories.map((label, index) => ({
            label,
            ...stats.byCategory[index]
        })).sort((a, b) => b.sales - a.sales);

        const regions = D.regions.map((label, index) => ({
            label,
            ...stats.byRegion[index]
        })).filter((item) => item.sales > 0).sort((a, b) => b.margin - a.margin);

        const topCategory = categories[0];
        const bestRegion = regions[0];
        const topProduct = stats.productList[0];
        const growth = comparison && comparison.hasPrevious
            ? deltaPct(comparison.current.sales, comparison.previous.sales)
            : null;

        const items = [];

        if (topCategory && stats.totals.sales) {
            items.push({
                title: `${topCategory.label} lidera la mezcla`,
                text: `${formatPercent(topCategory.sales / stats.totals.sales)} de las ventas y ${formatPercent(topCategory.margin)} de margen.`
            });
        } else {
            items.push({ title: 'Sin mezcla de categorías', text: 'No hay ventas para los filtros activos.' });
        }

        if (bestRegion) {
            items.push({
                title: `${bestRegion.label} · mejor margen`,
                text: `${formatPercent(bestRegion.margin)} sobre ventas, con ${formatNumber(bestRegion.orders)} pedidos.`
            });
        } else {
            items.push({ title: 'Sin territorios activos', text: 'Ajusta los filtros para ver el comparativo regional.' });
        }

        if (topProduct) {
            items.push({
                title: shortText(D.products[topProduct.idx], 44),
                text: `${compactMoney(topProduct.sales)} en ventas · ${formatPercent(topProduct.margin)} de margen.`
            });
        } else {
            items.push({ title: 'Sin productos en el filtro', text: 'La búsqueda actual no devuelve productos.' });
        }

        if (Number.isFinite(growth)) {
            items.push({
                title: `Ventas ${growth >= 0 ? '+' : '−'}${nf1.format(Math.abs(growth))} % en ${comparison.latest}`,
                text: `Variación frente a ${comparison.prior}. ${growth >= 0 ? 'El ritmo mejora' : 'El ritmo se contrae'} respecto al año anterior.`
            });
        } else {
            items.push({
                title: 'Comparativo anual pendiente',
                text: 'No hay base del año anterior con los filtros actuales.'
            });
        }

        target.innerHTML = items.map((item, index) => `<div class="insight">
            <span class="insight-index">${String(index + 1).padStart(2, '0')}</span>
            <strong>${esc(item.title)}</strong>
            <p>${esc(item.text)}</p>
        </div>`).join('');
    }

    function renderTrends(stats) {
        const years = [...state.years].map(Number).sort((a, b) => a - b);
        const yearCards = $('yearCards');
        const lineTag = $('lineTag');
        const lineTarget = $('chartYears');

        if (!years.length) {
            yearCards.innerHTML = emptyState('Selecciona al menos un año.');
            lineTarget.innerHTML = emptyState('Sin serie temporal.');
            $('heatmap').innerHTML = emptyState('Sin mapa de calor.');
            $('yearTable').innerHTML = emptyState('Sin comparativo.');
            lineTag.textContent = 'Sin periodo';
            return;
        }

        lineTag.textContent = years.length === 1 ? String(years[0]) : `${years.length} años`;
        const maxYearSales = Math.max(...years.map((year) => (stats.byYear.get(year) || { sales: 0 }).sales), 1);

        yearCards.innerHTML = years.map((year) => {
            const current = stats.byYear.get(year);
            if (!current) return '';
            const previous = stats.byYear.get(year - 1);
            const growth = previous ? deltaPct(current.sales, previous.sales) : null;
            return `<article class="year-card">
                <div class="year-card-top">
                    <span class="year-card-year">${year}</span>
                    ${deltaChip(growth, '%')}
                </div>
                <div>
                    <div class="year-card-sales">${compactMoney(current.sales)}</div>
                    <div class="year-card-meta">${formatPercent(current.margin)} margen · ${formatNumber(current.orders)} pedidos</div>
                    <div class="year-card-bar"><span style="width:${Math.max(2, (current.sales / maxYearSales) * 100).toFixed(1)}%"></span></div>
                </div>
            </article>`;
        }).join('');

        const series = years.map((year) => {
            const yearIndex = meta.years.indexOf(year);
            const monthGroups = stats.yearMonth.get(year) || Array.from({ length: 12 }, () => ({ sales: 0 }));
            return {
                label: String(year),
                values: monthGroups.map((item) => item.sales),
                color: YEAR_COLORS[yearIndex >= 0 ? yearIndex : 0]
            };
        });

        renderLineChart(lineTarget, series, {
            height: 340,
            aria: 'Comparativo mensual de ventas por año',
            tipFormat: fullMoney
        });

        renderHeatmap(stats, years);
        renderYearTable(stats, years);
    }

    function renderHeatmap(stats, years) {
        const target = $('heatmap');
        let max = 0;
        years.forEach((year) => {
            const months = stats.yearMonth.get(year) || [];
            months.forEach((month) => {
                max = Math.max(max, month.sales);
            });
        });

        if (!max) {
            target.innerHTML = emptyState('Sin ventas para el mapa de calor.');
            return;
        }

        let html = `<div class="heatmap-grid"><span></span>${MONTHS.map((month) => `<span class="heat-label">${month}</span>`).join('')}<span class="heat-label">Total</span></div>`;

        years.forEach((year) => {
            const months = stats.yearMonth.get(year) || Array.from({ length: 12 }, () => ({ sales: 0, profit: 0 }));
            const total = months.reduce((sum, month) => sum + month.sales, 0);
            html += `<div class="heatmap-grid"><span class="heat-year">${year}</span>`;
            months.forEach((month, index) => {
                const ratio = month.sales / max;
                const alpha = (0.05 + ratio * 0.61).toFixed(2);
                const tip = `<div class="tooltip-title">${MONTHS_LONG[index]} ${year}</div>
                    <div class="tooltip-row"><span>Ventas</span><b>${fullMoney(month.sales)}</b></div>
                    <div class="tooltip-row"><span>Ganancia</span><b>${fullMoney(month.profit)}</b></div>`;
                html += `<span class="heat-cell" style="background:rgba(18,35,158,${alpha})" data-tip="${escAttr(tip)}" aria-label="${MONTHS_LONG[index]} ${year}: ${fullMoney(month.sales)}"></span>`;
            });
            html += `<span class="heat-total">${compactMoney(total)}</span></div>`;
        });

        html += `<div class="heat-legend"><span>Menos</span><span class="heat-scale"><span></span><span></span><span></span><span></span><span></span></span><span>Más</span></div>`;
        target.innerHTML = html;
    }

    function renderYearTable(stats, years) {
        const target = $('yearTable');
        let previousSales = null;
        const rows = years.map((year) => {
            const current = stats.byYear.get(year);
            if (!current) return '';
            const growth = previousSales ? deltaPct(current.sales, previousSales) : null;
            previousSales = current.sales;
            return `<tr>
                <td><strong>${year}</strong></td>
                <td class="num">${compactMoney(current.sales)}</td>
                <td class="num">${formatPercent(current.margin)}</td>
                <td class="num">${deltaChip(growth, '%')}</td>
            </tr>`;
        }).join('');

        target.innerHTML = `<table>
            <thead><tr><th>Año</th><th class="num">Ventas</th><th class="num">Margen</th><th class="num">Var.</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="table-empty">Sin años con datos.</td></tr>'}</tbody>
        </table>`;
    }

    function getFilteredProducts(stats) {
        const term = state.productSearch.trim().toLowerCase();
        if (!term) return stats.productList.slice();
        return stats.productList.filter((product) => {
            const haystack = `${D.products[product.idx]} ${D.categories[product.category]} ${D.subcategories[product.subcategory]}`.toLowerCase();
            return haystack.includes(term);
        });
    }

    function sortProducts(products) {
        const sorted = products.slice();
        const direction = state.productDir === 'asc' ? 1 : -1;
        sorted.sort((a, b) => {
            if (state.productSort === 'name') {
                return D.products[a.idx].localeCompare(D.products[b.idx], 'es') * direction;
            }
            const valueA = a[state.productSort] || 0;
            const valueB = b[state.productSort] || 0;
            return (valueA - valueB) * direction;
        });
        return sorted;
    }

    function productTip(product) {
        return `<div class="tooltip-title">${esc(D.products[product.idx])}</div>
            <div class="tooltip-row"><span>Ventas</span><b>${fullMoney(product.sales)}</b></div>
            <div class="tooltip-row"><span>Ganancia</span><b>${fullMoney(product.profit)}</b></div>
            <div class="tooltip-row"><span>Margen</span><b>${formatPercent(product.margin)}</b></div>`;
    }

    function renderProductChart(products, stats) {
        const target = $('productChart');
        const top = products.slice().sort((a, b) => b.sales - a.sales).slice(0, 10);
        if (!top.length) {
            target.innerHTML = emptyState('La búsqueda no devuelve productos.');
            return;
        }
        const max = top[0].sales || 1;
        const rows = top.map((product, index) => {
            const width = Math.max(1.5, (product.sales / max) * 100);
            return `<button class="product-row" type="button" data-product="${product.idx}" data-tip="${escAttr(productTip(product))}">
                <span class="product-rank">${String(index + 1).padStart(2, '0')}</span>
                <span class="product-main">
                    <span class="product-name" title="${escAttr(D.products[product.idx])}">${esc(D.products[product.idx])}</span>
                    <span class="product-meta">${esc(D.categories[product.category])} · ${esc(D.subcategories[product.subcategory])}</span>
                    <span class="product-progress"><span style="width:${width.toFixed(1)}%; animation-delay:${index * 40}ms"></span></span>
                </span>
                <span class="product-value">${compactMoney(product.sales)}<small>${formatPercent(product.margin)}</small></span>
            </button>`;
        }).join('');

        const subcategories = new Map();
        products.forEach((product) => {
            subcategories.set(product.subcategory, (subcategories.get(product.subcategory) || 0) + product.sales);
        });
        const topSubcategory = [...subcategories].sort((a, b) => b[1] - a[1])[0];
        const negative = products.filter((product) => product.margin < 0).length;

        target.innerHTML = rows + `<div class="mini-stats">
            <div><span>Catálogo</span><strong>${formatNumber(stats.productList.length)}</strong></div>
            <div><span>Margen negativo</span><strong>${formatNumber(negative)}</strong></div>
            <div><span>Subcategoría líder</span><strong title="${topSubcategory ? escAttr(D.subcategories[topSubcategory[0]]) : ''}">${topSubcategory ? esc(shortText(D.subcategories[topSubcategory[0]], 18)) : '—'}</strong></div>
        </div>`;
    }

    function productTableHead() {
        const columns = [
            { key: 'name', label: 'Producto', numeric: false },
            { key: null, label: 'Categoría', numeric: false },
            { key: 'sales', label: 'Ventas', numeric: true },
            { key: 'profit', label: 'Ganancia', numeric: true },
            { key: 'margin', label: 'Margen', numeric: true },
            { key: 'qty', label: 'Unid.', numeric: true },
            { key: 'orders', label: 'Pedidos', numeric: true }
        ];
        return columns.map((column) => {
            if (!column.key) return `<th>${column.label}</th>`;
            const active = state.productSort === column.key;
            const mark = active ? `<span class="sort-mark">${state.productDir === 'asc' ? '▲' : '▼'}</span>` : '';
            return `<th class="sortable${column.numeric ? ' num' : ''}" data-sort="${column.key}">${column.label}${mark}</th>`;
        }).join('');
    }

    function renderProductTable(products, stats) {
        const target = $('productTable');
        const sorted = sortProducts(products);
        const pages = Math.max(1, Math.ceil(sorted.length / 10));
        state.productPage = Math.min(Math.max(0, state.productPage), pages - 1);
        const start = state.productPage * 10;
        const pageItems = sorted.slice(start, start + 10);

        $('productTableCount').textContent = `${formatNumber(sorted.length)} resultados`;
        $('productCount').textContent = `${formatNumber(stats.productList.length)} productos`;

        if (!pageItems.length) {
            target.innerHTML = emptyState('No hay productos que coincidan con la búsqueda.');
        } else {
            const rows = pageItems.map((product) => {
                const marginClass = product.margin < 0 ? ' margin-low' : '';
                return `<tr data-product="${product.idx}">
                    <td class="table-product">
                        <strong title="${escAttr(D.products[product.idx])}">${esc(D.products[product.idx])}</strong>
                        <span>${esc(D.subcategories[product.subcategory])}</span>
                    </td>
                    <td><span class="category-badge">${esc(D.categories[product.category])}</span></td>
                    <td class="num">${compactMoney(product.sales)}</td>
                    <td class="num">${compactMoney(product.profit)}</td>
                    <td class="num${marginClass}">${formatPercent(product.margin)}</td>
                    <td class="num">${formatNumber(product.qty)}</td>
                    <td class="num">${formatNumber(product.orders)}</td>
                </tr>`;
            }).join('');
            target.innerHTML = `<table>
                <thead><tr>${productTableHead()}</tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        }

        $('pagerInfo').textContent = `Página ${state.productPage + 1} de ${pages}`;
        $('pagerPrev').disabled = state.productPage === 0;
        $('pagerNext').disabled = state.productPage >= pages - 1;
    }

    function renderProducts(stats) {
        const filtered = getFilteredProducts(stats);
        renderProductChart(filtered, stats);
        renderProductTable(filtered, stats);
    }

    function kpiClient(label, value, note, spark) {
        return `<article class="kpi">
            <div class="kpi-head"><span class="kpi-label">${esc(label)}</span><span class="delta flat">agregado</span></div>
            <div class="kpi-value">${value}</div>
            <div class="kpi-foot"><span class="kpi-note">${esc(note)}</span>${spark ? sparkline(spark) : ''}</div>
        </article>`;
    }

    function renderClients(stats) {
        const totalCustomers = stats.totals.customers;
        const ordersPerCustomer = totalCustomers ? stats.totals.orders / totalCustomers : 0;
        const recurrent = stats.customerList.filter((customer) => customer.orders > 1).length;
        const recurrentShare = totalCustomers ? recurrent / totalCustomers : 0;

        $('clientKpis').innerHTML = [
            kpiClient('Clientes únicos', formatNumber(totalCustomers), 'Con al menos un pedido', stats.monthly.map((item) => item.customers)),
            kpiClient('Pedidos por cliente', nf1.format(ordersPerCustomer), 'Promedio del periodo', stats.monthly.map((item) => (item.customers ? item.orders / item.customers : 0))),
            kpiClient('Ticket promedio', compactMoney(stats.totals.ticket), 'Ventas / pedidos', stats.monthly.map((item) => item.ticket)),
            kpiClient('Clientes recurrentes', formatPercent(recurrentShare), `${formatNumber(recurrent)} con 2+ pedidos`)
        ].join('');

        const segmentItems = D.segments.map((label, index) => ({
            label,
            value: stats.bySegment[index].customers,
            note: `${formatPercent(stats.bySegment[index].sales / (stats.totals.sales || 1))} ventas`,
            tip: `${formatNumber(stats.bySegment[index].orders)} pedidos`
        })).sort((a, b) => b.value - a.value);

        renderBars($('clientSegments'), segmentItems, {
            valueLabel: 'Clientes',
            valueFormat: formatNumber
        });

        const topShareCount = Math.max(1, Math.ceil(stats.customerList.length * 0.1));
        const topShareSales = stats.customerList.slice(0, topShareCount).reduce((sum, customer) => sum + customer.sales, 0);
        const concentration = stats.totals.sales ? topShareSales / stats.totals.sales : 0;
        const topShareCustomers = stats.customerList.length ? topShareCount / stats.customerList.length : 0;
        if (stats.customerList.length && topShareSales > 0) {
            $('clientSegments').insertAdjacentHTML('beforeend', `<div class="mini-insight">
                <span class="mini-label">Concentración de valor</span>
                <strong>El ${formatPercent(concentration)} de las ventas se concentra en el ${formatPercent(topShareCustomers)} de clientes con mayor valor.</strong>
                <p>Dato agregado: no se muestran importes, nombres ni identificadores legibles.</p>
            </div>`);
        }

        const top = stats.customerList.slice(0, 12);
        const max = top.length ? top[0].sales : 1;
        $('clientTable').innerHTML = top.length
            ? `<table>
                <thead><tr><th>Alias</th><th>Token cifrado</th><th>Segmento</th><th class="num">Pedidos</th><th class="num">Índice</th></tr></thead>
                <tbody>${top.map((customer, index) => `<tr>
                    <td><strong>Cliente ${String(index + 1).padStart(2, '0')}</strong></td>
                    <td><span class="token">${esc(customer.token.slice(0, 12))}••</span></td>
                    <td><span class="category-badge">${esc(D.segments[customer.segment])}</span></td>
                    <td class="num">${formatNumber(customer.orders)}</td>
                    <td class="num"><strong>${Math.round((customer.sales / max) * 100)}</strong><span class="kpi-note"> / 100</span></td>
                </tr>`).join('')}</tbody>
            </table>`
            : emptyState('Sin clientes para los filtros activos.');

        $('maskDemo').innerHTML = [
            { label: 'Nombre de cliente', value: 'M••••• R•••••', note: 'No almacenado' },
            { label: 'ID de cliente', value: 'CLI-7F3A••••', note: 'Token irreversible' },
            { label: 'ID de pedido', value: 'ORD-91C2••••', note: 'Token irreversible' },
            { label: 'CPL / coste por lead', value: '•••••', note: 'No presente · bloqueado' }
        ].map((item) => `<div class="mask-item">
            <span>${esc(item.label)}</span>
            <code>${esc(item.value)}</code>
            <small>${esc(item.note)}</small>
        </div>`).join('');
    }

    function renderPrivacy() {
        const fields = [
            { field: 'Customer Name', treatment: 'Nombres eliminados del HTML', status: 'Excluido', className: 'removed' },
            { field: 'Customer ID', treatment: 'Token SHA-256 truncado (14 caracteres)', status: 'Cifrado', className: 'masked' },
            { field: 'Order ID', treatment: 'Token SHA-256 truncado (14 caracteres)', status: 'Cifrado', className: 'masked' },
            { field: 'City / State / Postal Code', treatment: 'Excluidos del conjunto publicado', status: 'Excluido', className: 'removed' },
            { field: 'Region', treatment: 'Agregado territorial, sin dirección', status: 'Agregado', className: '' },
            { field: 'Segment', treatment: 'Agregado por segmento comercial', status: 'Agregado', className: '' },
            { field: 'Sales / Profit', treatment: 'Agregados por periodo, producto y territorio', status: 'Agregado', className: '' },
            { field: 'CPL / Coste por lead', treatment: 'Enmascarado; no existe en el modelo de origen', status: 'Bloqueado', className: 'blocked' }
        ];

        $('fieldRegistry').innerHTML = `<table>
            <thead><tr><th>Campo</th><th>Tratamiento</th><th>Estado</th></tr></thead>
            <tbody>${fields.map((item) => `<tr>
                <td><strong>${esc(item.field)}</strong></td>
                <td>${esc(item.treatment)}</td>
                <td><span class="status ${item.className}">${esc(item.status)}</span></td>
            </tr>`).join('')}</tbody>
        </table>`;

        $('coverage').innerHTML = `<div class="coverage-grid">
            <div><span>Líneas procesadas</span><strong>${formatNumber(facts.length)}</strong></div>
            <div><span>Periodo</span><strong>${meta.years[0]}–${meta.years[meta.years.length - 1]}</strong></div>
            <div><span>Regiones</span><strong>${D.regions.length}</strong></div>
            <div><span>Nombres exportados</span><strong>0</strong></div>
        </div>`;
    }

    function updateFilterLabels() {
        FILTER_DEFS.forEach((definition) => {
            const selection = state[definition.key];
            const label = selection.size === definition.values.length
                ? 'Todos'
                : selection.size === 1
                    ? [...selection][0]
                    : `${selection.size} seleccionados`;
            const labelTarget = document.querySelector(`[data-filter-label="${definition.key}"]`);
            const trigger = document.querySelector(`[data-filter-trigger="${definition.key}"]`);
            if (labelTarget) labelTarget.textContent = label;
            if (trigger) trigger.classList.toggle('filtered', selection.size !== definition.values.length);
        });
    }

    function buildFilters() {
        const target = $('filters');
        target.innerHTML = FILTER_DEFS.map((definition) => `<div class="filter" data-key="${definition.key}">
            <button class="filter-trigger" type="button" data-filter-trigger="${definition.key}" aria-expanded="false" aria-haspopup="true">
                <span class="filter-name">${esc(definition.label)}</span>
                <span class="filter-selection" data-filter-label="${definition.key}">Todos</span>
                <svg class="filter-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
            </button>
            <div class="filter-panel" hidden>
                ${definition.values.map((value) => `<label class="filter-option">
                    <input type="checkbox" value="${escAttr(value)}" checked data-filter-input="${definition.key}">
                    <span>${esc(value)}</span>
                </label>`).join('')}
                <div class="filter-actions">
                    <button type="button" data-filter-all="${definition.key}">Todos</button>
                    <button type="button" data-filter-clear="${definition.key}">Limpiar</button>
                </div>
            </div>
        </div>`).join('');

        target.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-filter-trigger]');
            if (trigger) {
                toggleFilterPanel(trigger.dataset.filterTrigger);
                return;
            }

            const allButton = event.target.closest('[data-filter-all]');
            if (allButton) {
                setFilterAll(allButton.dataset.filterAll, true);
                return;
            }

            const clearButton = event.target.closest('[data-filter-clear]');
            if (clearButton) {
                setFilterAll(clearButton.dataset.filterClear, false);
            }
        });

        target.addEventListener('change', (event) => {
            const input = event.target.closest('[data-filter-input]');
            if (!input) return;
            const key = input.dataset.filterInput;
            if (input.checked) state[key].add(input.value);
            else state[key].delete(input.value);
            updateFilterLabels();
            refresh();
        });

        updateFilterLabels();
    }

    function closeFilterPanels(exceptKey) {
        document.querySelectorAll('.filter-trigger').forEach((trigger) => {
            if (trigger.dataset.filterTrigger !== exceptKey) {
                trigger.setAttribute('aria-expanded', 'false');
                const panel = trigger.parentElement.querySelector('.filter-panel');
                if (panel) panel.hidden = true;
            }
        });
    }

    function toggleFilterPanel(key) {
        const trigger = document.querySelector(`[data-filter-trigger="${key}"]`);
        if (!trigger) return;
        const panel = trigger.parentElement.querySelector('.filter-panel');
        const isOpen = trigger.getAttribute('aria-expanded') === 'true';
        closeFilterPanels(key);
        trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        panel.hidden = isOpen;
    }

    function setFilterAll(key, checked) {
        const definition = FILTER_DEFS.find((item) => item.key === key);
        if (!definition) return;
        state[key] = new Set(checked ? definition.values : []);
        document.querySelectorAll(`[data-filter-input="${key}"]`).forEach((input) => {
            input.checked = checked;
        });
        updateFilterLabels();
        refresh();
    }

    function updateSummary(rows, stats) {
        const selectedYears = [...state.years].map(Number).sort((a, b) => a - b);
        let period = 'Sin periodo';
        if (selectedYears.length === 1) period = String(selectedYears[0]);
        else if (selectedYears.length > 1) {
            const contiguous = selectedYears.every((year, index) => index === 0 || year === selectedYears[index - 1] + 1);
            period = contiguous
                ? `${selectedYears[0]}–${selectedYears[selectedYears.length - 1]}`
                : selectedYears.join(' · ');
        }

        $('periodStamp').textContent = period;
        $('filterSummary').textContent = rows.length
            ? `${formatNumber(rows.length)} líneas · ${formatNumber(stats.totals.orders)} pedidos · ${formatNumber(stats.totals.customers)} clientes`
            : 'Sin líneas para la selección actual';
    }

    function activateTab(tab, updateHash) {
        const buttons = [...document.querySelectorAll('[role="tab"]')];
        const panels = [...document.querySelectorAll('[role="tabpanel"]')];
        const known = buttons.some((button) => button.dataset.tab === tab);
        const nextTab = known ? tab : 'resumen';

        buttons.forEach((button) => {
            const active = button.dataset.tab === nextTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
            button.tabIndex = active ? 0 : -1;
        });

        panels.forEach((panel) => {
            const active = panel.id === `tab-${nextTab}`;
            panel.hidden = !active;
            panel.classList.toggle('active', active);
        });

        state.tab = nextTab;
        if (updateHash !== false) {
            try {
                history.replaceState(null, '', `#${nextTab}`);
            } catch (error) {
                /* noop */
            }
        }
    }

    function refresh() {
        const rows = getFilteredRows();
        const stats = computeStats(rows);
        const comparison = getComparison();
        lastStats = stats;

        renderKpis(stats, comparison);
        renderResumen(stats, comparison);
        renderTrends(stats);
        renderProducts(stats);
        renderClients(stats);
        updateSummary(rows, stats);
    }

    function openModal(title, body) {
        const modal = $('modal');
        $('modalTitle').textContent = title;
        $('modalBody').innerHTML = body;
        if (typeof modal.showModal === 'function') modal.showModal();
        else modal.setAttribute('open', '');
    }

    function openProduct(productIndex) {
        if (!lastStats) return;
        const product = lastStats.productList.find((item) => item.idx === productIndex);
        if (!product) return;
        const name = D.products[product.idx];
        const share = lastStats.totals.sales ? product.sales / lastStats.totals.sales : 0;
        openModal('Ficha de producto', `
            <h3>${esc(name)}</h3>
            <div class="product-detail-meta">
                <span>${esc(D.categories[product.category])}</span>
                <span>${esc(D.subcategories[product.subcategory])}</span>
                <span>${formatNumber(product.orders)} pedidos</span>
            </div>
            <div class="product-detail-grid">
                <div><span>Ventas</span><strong>${fullMoney(product.sales)}</strong></div>
                <div><span>Ganancia</span><strong>${fullMoney(product.profit)}</strong></div>
                <div><span>Margen</span><strong>${formatPercent(product.margin)}</strong></div>
                <div><span>Unidades</span><strong>${formatNumber(product.qty)}</strong></div>
                <div><span>Participación</span><strong>${formatPercent(share)}</strong></div>
                <div><span>Ticket del producto</span><strong>${fullMoney(product.orders ? product.sales / product.orders : 0)}</strong></div>
            </div>
            <p>Datos agregados del producto. Esta ficha no incluye clientes, pedidos individuales ni información logística.</p>
        `);
    }

    function showToast(message) {
        const toast = $('toast');
        toast.textContent = message;
        toast.hidden = false;
        requestAnimationFrame(() => toast.classList.add('show'));
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { toast.hidden = true; }, 220);
        }, 2400);
    }

    function exportSummary() {
        const rows = getFilteredRows();
        const stats = computeStats(rows);
        const years = [...state.years].map(Number).sort((a, b) => a - b);
        const payload = {
            generatedAt: new Date().toISOString(),
            source: meta.source,
            filters: {
                years,
                regions: [...state.regions],
                categories: [...state.categories],
                segments: [...state.segments]
            },
            totals: {
                sales: Number(stats.totals.sales.toFixed(2)),
                profit: Number(stats.totals.profit.toFixed(2)),
                margin: Number((stats.totals.margin * 100).toFixed(2)),
                orders: stats.totals.orders,
                customers: stats.totals.customers,
                ticket: Number(stats.totals.ticket.toFixed(2))
            },
            byCategory: D.categories.map((label, index) => ({
                category: label,
                sales: Number(stats.byCategory[index].sales.toFixed(2)),
                profit: Number(stats.byCategory[index].profit.toFixed(2)),
                margin: Number((stats.byCategory[index].margin * 100).toFixed(2))
            })),
            byRegion: D.regions.map((label, index) => ({
                region: label,
                sales: Number(stats.byRegion[index].sales.toFixed(2)),
                profit: Number(stats.byRegion[index].profit.toFixed(2)),
                margin: Number((stats.byRegion[index].margin * 100).toFixed(2))
            })),
            byYear: [...stats.byYear].sort(([a], [b]) => a - b).map(([year, item]) => ({
                year,
                sales: Number(item.sales.toFixed(2)),
                profit: Number(item.profit.toFixed(2)),
                margin: Number((item.margin * 100).toFixed(2)),
                orders: item.orders,
                customers: item.customers
            })),
            privacy: {
                customerNames: 'not_exported',
                customerIdentifiers: 'sha256_tokenized',
                orderIdentifiers: 'sha256_tokenized',
                cpl: 'masked_not_present',
                rawRows: 0
            }
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `actividad-resumen-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Resumen exportado sin datos personales');
    }

    function positionTooltip(event) {
        const tooltip = $('tooltip');
        const gap = 13;
        const bounds = tooltip.getBoundingClientRect();
        let x = event.clientX + gap;
        let y = event.clientY + gap;
        if (x + bounds.width > window.innerWidth - 10) x = event.clientX - bounds.width - gap;
        if (y + bounds.height > window.innerHeight - 10) y = event.clientY - bounds.height - gap;
        tooltip.style.left = `${Math.max(8, x)}px`;
        tooltip.style.top = `${Math.max(8, y)}px`;
    }

    function bindEvents() {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs.forEach((button, index) => {
            button.addEventListener('click', () => activateTab(button.dataset.tab));
            button.addEventListener('keydown', (event) => {
                let nextIndex = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = tabs.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                tabs[nextIndex].focus();
                activateTab(tabs[nextIndex].dataset.tab);
            });
        });

        $('privacyBtn').addEventListener('click', () => activateTab('metodologia'));
        $('resetFilters').addEventListener('click', () => {
            FILTER_DEFS.forEach((definition) => {
                state[definition.key] = new Set(definition.values);
                document.querySelectorAll(`[data-filter-input="${definition.key}"]`).forEach((input) => {
                    input.checked = true;
                });
            });
            updateFilterLabels();
            state.productPage = 0;
            refresh();
            showToast('Filtros restablecidos');
        });

        $('exportBtn').addEventListener('click', exportSummary);
        $('exportBtn2').addEventListener('click', exportSummary);

        $('productSearch').addEventListener('input', (event) => {
            state.productSearch = event.target.value;
            state.productPage = 0;
            if (lastStats) renderProducts(lastStats);
        });

        $('productTable').addEventListener('click', (event) => {
            const header = event.target.closest('th[data-sort]');
            if (header) {
                const key = header.dataset.sort;
                if (state.productSort === key) state.productDir = state.productDir === 'asc' ? 'desc' : 'asc';
                else {
                    state.productSort = key;
                    state.productDir = key === 'name' ? 'asc' : 'desc';
                }
                state.productPage = 0;
                if (lastStats) renderProducts(lastStats);
                return;
            }

            const row = event.target.closest('tr[data-product]');
            if (row) openProduct(Number(row.dataset.product));
        });

        $('productChart').addEventListener('click', (event) => {
            const row = event.target.closest('[data-product]');
            if (row) openProduct(Number(row.dataset.product));
        });

        $('pagerPrev').addEventListener('click', () => {
            state.productPage = Math.max(0, state.productPage - 1);
            if (lastStats) renderProducts(lastStats);
        });

        $('pagerNext').addEventListener('click', () => {
            state.productPage += 1;
            if (lastStats) renderProducts(lastStats);
        });

        $('modalClose').addEventListener('click', () => $('modal').close());
        $('modal').addEventListener('click', (event) => {
            if (event.target === $('modal')) $('modal').close();
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.filter')) closeFilterPanels(null);
        });

        document.addEventListener('pointerover', (event) => {
            const target = event.target.closest('[data-tip]');
            if (!target) return;
            const html = target.getAttribute('data-tip');
            if (!html) return;
            const tooltip = $('tooltip');
            tooltip.innerHTML = html;
            tooltip.hidden = false;
            positionTooltip(event);
        });

        document.addEventListener('pointermove', (event) => {
            const target = event.target.closest('[data-tip]');
            const tooltip = $('tooltip');
            if (!target || tooltip.hidden) return;
            positionTooltip(event);
        });

        document.addEventListener('pointerout', (event) => {
            const target = event.target.closest('[data-tip]');
            if (!target) return;
            if (event.relatedTarget && target.contains(event.relatedTarget)) return;
            $('tooltip').hidden = true;
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeFilterPanels(null);
                $('tooltip').hidden = true;
            }
        });
    }

    function init() {
        buildFilters();
        renderPrivacy();
        bindEvents();

        const initial = location.hash.replace('#', '');
        activateTab(initial || 'resumen', false);
        refresh();
    }

    init();
})();
