
async function main(interval = "15m") {
    const res = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=" + interval + "&limit=1000");
    let raw = await res.json();
    raw.sort((a, b) => a[0] - b[0]);

    // MA - EMA - SMA ve RSİ için kullanılan değişken
    const closes = raw.map(d => parseFloat(d[4]));

    // 1. Hesaplamaları yap
    const indicators = {
        sma7: getSMA(closes, 7),
        ema25: getEMA(closes, 25),
        ma50: getSMA(closes, 50),
        macd: getMACDData(closes),
        rsi: getRSIData(closes, 14),
        kdj: getKDJData(raw, 9),
        bb: getBBData(closes, 20, 2),
        atr: getATR(raw, 14)
    };
    bbchart(raw, indicators.bb)
    kdjchart(raw, indicators.kdj)
    rsichart(raw, indicators.rsi)
    macdchart(raw, indicators.macd)
    ma_ema_smaChart(raw, indicators)
    const historySignals = scanHistory(raw, indicators);
    renderAnalizPanel(historySignals);  // ← buraya
    mainChart(raw, historySignals)
}

document.querySelectorAll('.times button').forEach(btn => {
    btn.addEventListener('click', () => main(btn.id));
});

function scanHistory(raw, indicators) {
    const closes = raw.map(d => parseFloat(d[4]));

    // Her indikatör kendi pozisyonunu bağımsız takip eder
    const indicatorConfigs = [
        {
            name: "RSI",
            getSignal: (i) => {
                const rsi = indicators.rsi[i];
                if (rsi < 30) return 'buy';
                if (rsi > 70) return 'sell';
                return null;
            }
        },
        {
            name: "MACD (Güçlü)",
            getSignal: (i) => {
                const macd = indicators.macd.macdLine[i];
                const signal = indicators.macd.signalLine[i];
                const prevMacd = indicators.macd.macdLine[i - 1];
                const prevSignal = indicators.macd.signalLine[i - 1];
                if (prevMacd < prevSignal && macd > signal && macd < 0) return 'buy';
                if (prevMacd > prevSignal && macd < signal && macd > 0) return 'sell';
                return null;
            }
        },
        {
            name: "MACD (Zayıf)",
            getSignal: (i) => {
                const macd = indicators.macd.macdLine[i];
                const signal = indicators.macd.signalLine[i];
                const prevMacd = indicators.macd.macdLine[i - 1];
                const prevSignal = indicators.macd.signalLine[i - 1];
                if (prevMacd < prevSignal && macd > signal && macd >= 0) return 'buy';
                if (prevMacd > prevSignal && macd < signal && macd <= 0) return 'sell';
                return null;
            }
        },
        {
            name: "Bollinger Bands",
            getSignal: (i) => {
                if (closes[i] <= indicators.bb.lower[i] && indicators.bb.lower[i] !== null) return 'buy';
                if (closes[i] >= indicators.bb.upper[i] && indicators.bb.upper[i] !== null) return 'sell';
                return null;
            }
        },
        {
            name: "KDJ",
            getSignal: (i) => {
                const kdj = indicators.kdj;
                const wasBelow = kdj.jValues[i-1] < kdj.kValues[i-1] && kdj.jValues[i-1] < kdj.dValues[i-1];
                const isAbove  = kdj.jValues[i]   > kdj.kValues[i]   && kdj.jValues[i]   > kdj.dValues[i];
                const wasAbove = kdj.jValues[i-1] > kdj.kValues[i-1] && kdj.jValues[i-1] > kdj.dValues[i-1];
                const isBelow  = kdj.jValues[i]   < kdj.kValues[i]   && kdj.jValues[i]   < kdj.dValues[i];
                if (wasBelow && isAbove && kdj.kValues[i] < 30 && kdj.dValues[i] < 30) return 'buy';
                if (wasAbove && isBelow && kdj.kValues[i] > 70 && kdj.dValues[i] > 70) return 'sell';
                return null;
            }
        }
    ];

    const allResults = {};

    for (const config of indicatorConfigs) {
        const trades = [];
        let position = null; // { entryPrice, entryIndex, entryTime }

        for (let i = 51; i < closes.length; i++) {
            const signal = config.getSignal(i);
            const price = closes[i];

            if (!position && signal === 'buy') {
                // Pozisyon yok → gir
                position = {
                    entryPrice: price,
                    entryIndex: i,
                    entryTime: new Date(raw[i][0]).toLocaleString('tr-TR')
                };
            } else if (position && signal === 'sell') {
                // Pozisyon var → çık
                const pnl = ((price - position.entryPrice) / position.entryPrice) * 100;
                const duration = i - position.entryIndex;

                trades.push({
                    entryTime: position.entryTime,
                    exitTime: new Date(raw[i][0]).toLocaleString('tr-TR'),
                    entryPrice: position.entryPrice,
                    exitPrice: price,
                    pnl: parseFloat(pnl.toFixed(3)),
                    duration, // mum sayısı
                    isSuccess: pnl > 0
                });

                position = null;
            }
            // Pozisyon varken tekrar al → yok say (seçenek 1)
        }

        // İstatistikler
        const total = trades.length;
        const wins = trades.filter(t => t.isSuccess).length;
        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const avgPnl = total > 0 ? totalPnl / total : 0;
        const avgDuration = total > 0
            ? trades.reduce((sum, t) => sum + t.duration, 0) / total
            : 0;

        allResults[config.name] = {
            trades,
            stats: {
                total,
                wins,
                losses: total - wins,
                winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
                totalPnl: parseFloat(totalPnl.toFixed(2)),
                avgPnl: parseFloat(avgPnl.toFixed(3)),
                avgDuration: parseFloat(avgDuration.toFixed(1))
            }
        };
    }

    return allResults;
}

function renderAnalizPanel(allResults) {
    const panel = document.querySelector('.analiz-panel');

    const rows = Object.entries(allResults).map(([name, data]) => {
        const s = data.stats;
        const pnlColor = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
        const avgColor = s.avgPnl >= 0 ? '#0ecb81' : '#f6465d';
        const wrColor  = s.winRate >= 50 ? '#0ecb81' : '#f6465d';

        return `
            <tr style="border-bottom: 1px solid #1e2329;">
                <td style="padding: 8px; color: #eaecef;">${name}</td>
                <td style="padding: 8px; text-align: center; color: #f0b90b;">${s.total}</td>
                <td style="padding: 8px; text-align: center; color: ${wrColor};">%${s.winRate}</td>
                <td style="padding: 8px; text-align: center; color: #0ecb81;">${s.wins}</td>
                <td style="padding: 8px; text-align: center; color: #f6465d;">${s.losses}</td>
                <td style="padding: 8px; text-align: center; color: ${pnlColor};">${s.totalPnl >= 0 ? '+' : ''}${s.totalPnl}%</td>
                <td style="padding: 8px; text-align: center; color: ${avgColor};">${s.avgPnl >= 0 ? '+' : ''}${s.avgPnl}%</td>
                <td style="padding: 8px; text-align: center; color: #848e9c;">${s.avgDuration} mum</td>
            </tr>
        `;
    }).join('');

    panel.innerHTML = `
        <div style="font-family: monospace; color: #eaecef;">
            <div style="padding: 12px 15px; border-bottom: 1px solid #2b2f36; font-size: 13px; color: #848e9c; letter-spacing: 1px;">
                İNDİKATÖR BAZINDA BACKTEST
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="color: #848e9c; border-bottom: 1px solid #2b2f36;">
                            <th style="padding: 8px; text-align: left;">İndikatör</th>
                            <th style="padding: 8px; text-align: center;">İşlem</th>
                            <th style="padding: 8px; text-align: center;">Win %</th>
                            <th style="padding: 8px; text-align: center;">Kazanan</th>
                            <th style="padding: 8px; text-align: center;">Kaybeden</th>
                            <th style="padding: 8px; text-align: center;">Toplam PnL</th>
                            <th style="padding: 8px; text-align: center;">Ort. PnL</th>
                            <th style="padding: 8px; text-align: center;">Ort. Süre</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

// Atr hesaplama
function getATR(raw, period) {
    const trValues = [];

    for (let i = 0; i < raw.length; i++) {
        const high = parseFloat(raw[i][2]);
        const low = parseFloat(raw[i][3]);
        const prevClose = i === 0 ? parseFloat(raw[i][4]) : parseFloat(raw[i - 1][4]);

        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trValues.push(tr);
    }

    const atrValues = new Array(raw.length).fill(null);

    // İlk ATR = ilk 14 TR'nin ortalaması
    let sum = trValues.slice(0, period).reduce((a, b) => a + b, 0);
    atrValues[period - 1] = sum / period;

    // Wilder's smoothing
    for (let i = period; i < raw.length; i++) {
        atrValues[i] = (atrValues[i - 1] * (period - 1) + trValues[i]) / period;
    }

    return atrValues;
}

// Ma-Ema-Sma chart yardımcı fonksiyon
function getSMA(data, period) {
    return data.map((_, i) => {
        if (i < period - 1) return null;
        const slice = data.slice(i - period + 1, i + 1);
        return slice.reduce((a, b) => a + b, 0) / period;
    });
}

// Üssel Hareketli Ortalama (EMA) - Saf Veri
function getEMA(data, period) {
    const k = 2 / (period + 1);
    let prev = data[0];
    return data.map((v, i) => {
        if (i < period - 1) return null;
        if (i === period - 1) {
            // İlk değer için SMA kullanılır (Genel kabul görmüş yöntem)
            const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
            prev = sma;
            return sma;
        }
        prev = v * k + prev * (1 - k);
        return prev;
    });
}

function ma_ema_smaChart(raw, indicators) {
    const candles = raw.map(d => ({
        x: d[0],
        o: parseFloat(d[1]),
        h: parseFloat(d[2]),
        l: parseFloat(d[3]),
        c: parseFloat(d[4])
    }));

    const formatData = (dataArray) => dataArray.map((v, i) => ({ x: raw[i][0], y: v }));
    const existing = Chart.getChart('ma_ema_smaChart'); // canvas id
    if (existing) existing.destroy();
    new Chart(document.getElementById('ma_ema_smaChart'), {
        type: 'candlestick',
        data: {
            datasets: [
                {
                    type: 'candlestick',
                    label: 'Fiyat',
                    data: candles,
                    color: { up: '#26a69a', down: '#ef5350', unchanged: '#9194a3' },
                    borderColor: { up: '#26a69a', down: '#ef5350', unchanged: '#9194a3' },
                    borderWidth: 1,
                    order: 10
                },
                {
                    type: 'line',
                    label: 'SMA (7)',
                    data: formatData(indicators.sma7),
                    borderColor: '#f0b90b',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.1,
                    order: 1
                },
                {
                    type: 'line',
                    label: 'EMA (25)',
                    data: formatData(indicators.ema25),
                    borderColor: '#2196f3',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.1,
                    order: 2
                },
                {
                    type: 'line',
                    label: 'MA (50)',
                    data: formatData(indicators.ma50),
                    borderColor: '#9c27b0',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.1,
                    order: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#131722',
                    borderColor: '#363a45',
                    borderWidth: 1,
                    titleColor: '#9194a3',
                    bodyColor: '#d1d4dc',
                    padding: 10,
                    callbacks: {
                        label: ctx => {
                            if (ctx.dataset.type === 'candlestick') {
                                const r = ctx.raw;
                                return ` O:${r.o.toFixed(2)} H:${r.h.toFixed(2)} L:${r.l.toFixed(2)} C:${r.c.toFixed(2)}`;
                            }
                            return ctx.parsed.y !== null ? ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}` : '';
                        }
                    }
                }
            },
            scales: {
                x: { type: 'timeseries', grid: { display: false }, ticks: { color: '#9194a3', maxTicksLimit: 10 } },
                y: { grid: { color: '#2a2e39' }, ticks: { color: '#9194a3' } }
            }
        }
    });
}
// macd data hesaplama
function getMACDData(closes) {
    // EMA 12 ve 26 hesapla
    // Not: Daha önce yazdığımız getEMA fonksiyonunu burada tekrar kullanabiliriz 
    // veya senin calcMACD mantığını "pure" hale getirebiliriz.
    const ema12 = getEMA(closes, 12);
    const ema26 = getEMA(closes, 26);

    const macdLine = ema12.map((v, i) => (v === null || ema26[i] === null) ? null : v - ema26[i]);

    // Sinyal Hattı = MACD Hattı'nın 9 periyotluk EMA'sı
    // Null değerleri filtreleyip EMA alıp sonra tekrar diziye yayıyoruz
    const validMacd = macdLine.filter(v => v !== null);
    const calculatedSignal = getEMA(validMacd, 9);

    // Sinyal hattını ana dizi uzunluğuyla senkronize et (Baştaki boşlukları null ile doldur)
    const signalLine = new Array(macdLine.length).fill(null);
    let signalIdx = 0;
    for (let i = 0; i < macdLine.length; i++) {
        if (macdLine[i] !== null && signalIdx < calculatedSignal.length) {
            signalLine[i] = calculatedSignal[signalIdx];
            signalIdx++;
        }
    }
    const histogram = macdLine.map((m, i) => (m === null || signalLine[i] === null) ? null : m - signalLine[i]);

    return { macdLine, signalLine, histogram };
}

function macdchart(raw, macdData) {
    const labels = raw.map(d => new Date(d[0]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    const existing = Chart.getChart('macdChart'); // canvas id
    if (existing) existing.destroy();
    new Chart(document.getElementById('macdChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Histogram',
                    data: macdData.histogram,
                    backgroundColor: macdData.histogram.map(v => v >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)'),
                    order: 3
                },
                {
                    type: 'line',
                    label: 'MACD',
                    data: macdData.macdLine,
                    borderColor: '#2962FF',
                    borderWidth: 1,
                    pointRadius: 0,
                    order: 1
                },
                {
                    type: 'line',
                    label: 'Sinyal',
                    data: macdData.signalLine,
                    borderColor: '#FF6D00',
                    borderWidth: 1,
                    pointRadius: 0,
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e2329',
                    borderColor: '#2b2f36',
                    borderWidth: 1,
                    titleColor: '#848e9c',
                    bodyColor: '#eaecef',
                    padding: 10,
                    callbacks: {
                        label: ctx => {
                            const val = ctx.parsed.y;
                            if (val === null || val === undefined) return '';
                            return ` ${ctx.dataset.label}: ${val.toFixed(4)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#848e9c', maxTicksLimit: 10 }
                },
                y: {
                    grid: { color: '#2b2f36' },
                    ticks: { color: '#848e9c' }
                }
            }
        }
    });
}
// Rsi data hesaplama
function getRSIData(closes, period = 14) {
    let rsi = new Array(closes.length).fill(null);
    let gains = [0], losses = [0]; // Uzunlukları senkron tutmak için 0 ile başlıyoruz

    for (let i = 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i - 1];
        gains.push(Math.max(0, diff));
        losses.push(Math.max(0, -diff));
    }

    let avgG = gains.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
    let avgL = losses.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < closes.length; i++) {
        rsi[i] = 100 - (100 / (1 + avgG / (avgL || 1e-5)));
        // Wilder's Smoothing Method (Senin kullandığın mantık)
        if (i + 1 < closes.length) {
            avgG = (avgG * (period - 1) + gains[i + 1]) / period;
            avgL = (avgL * (period - 1) + losses[i + 1]) / period;
        }
    }
    return rsi;
}

function rsichart(raw, rsiData) {

    const labels = raw.map(d => new Date(d[0]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));

    // Safe Zone (70-30 bölgesi) boyama eklentisi
    const safeZonePlugin = {
        id: 'safeZone',
        beforeDraw: (chart) => {
            const { ctx, chartArea: { left, width }, scales: { y } } = chart;
            const y70 = y.getPixelForValue(70);
            const y30 = y.getPixelForValue(30);
            ctx.save();
            ctx.fillStyle = 'rgba(240, 185, 11, 0.05)';
            ctx.fillRect(left, y70, width, y30 - y70);
            ctx.restore();
        }
    };

    const existing = Chart.getChart('rsiChart'); // canvas id
    if (existing) existing.destroy();
    new Chart(document.getElementById('rsiChart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'RSI',
                data: rsiData,
                borderColor: '#f0b90b',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#1e2329',
                    borderColor: '#f0b90b',
                    borderWidth: 1,
                    titleColor: '#848e9c',
                    bodyColor: '#f0b90b',
                    padding: 10,
                    callbacks: {
                        title: (items) => items[0].label,
                        label: (ctx) => ctx.parsed.y !== null ? ` RSI: ${ctx.parsed.y.toFixed(2)}` : ''
                    }
                }
            },
            scales: {
                y: { min: 0, max: 100, grid: { color: '#2b2f36' }, ticks: { color: '#848e9c' } },
                x: { grid: { display: false }, ticks: { color: '#848e9c', maxTicksLimit: 10 } }
            }
        },
        plugins: [safeZonePlugin]
    });
}

function getKDJData(raw, period = 9) {
    const data = raw.map(d => ({
        h: parseFloat(d[2]),
        l: parseFloat(d[3]),
        c: parseFloat(d[4])
    }));

    let K = 50, D = 50;
    const kValues = [];
    const dValues = [];
    const jValues = [];

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            kValues.push(50);
            dValues.push(50);
            jValues.push(50);
            continue;
        }

        const lastN = data.slice(i - (period - 1), i + 1);
        const hh = Math.max(...lastN.map(x => x.h));
        const ll = Math.min(...lastN.map(x => x.l));

        const rsv = hh === ll ? 50 : ((data[i].c - ll) / (hh - ll)) * 100;

        K = (2 / 3) * K + (1 / 3) * rsv;
        D = (2 / 3) * D + (1 / 3) * K;
        let J = 3 * K - 2 * D;

        kValues.push(K);
        dValues.push(D);
        jValues.push(J);
    }

    return { kValues, dValues, jValues };
}

function kdjchart(raw, kdjData) {
    const labels = raw.map(d => new Date(d[0]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));

    const existing = Chart.getChart('kdjChart'); // canvas id
    if (existing) existing.destroy();
    const chart = new Chart(document.getElementById('kdjChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'K', data: kdjData.kValues, borderColor: 'white', borderWidth: 1, pointRadius: 0, tension: 0.1 },
                { label: 'D', data: kdjData.dValues, borderColor: 'yellow', borderWidth: 1, pointRadius: 0, tension: 0.1 },
                { label: 'J', data: kdjData.jValues, borderColor: 'magenta', borderWidth: 1.5, pointRadius: 0, tension: 0.1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e2329',
                    callbacks: {
                        label: (ctx) => {
                            const val = ctx.parsed.y;
                            return val !== null ? ` ${ctx.dataset.label}: ${val.toFixed(2)}` : '';
                        }
                    }
                }
            },
            scales: {
                y: { grid: { color: '#2b2f36' }, min: -20, max: 120, ticks: { color: '#848e9c' } },
                x: { ticks: { color: '#848e9c', maxTicksLimit: 15 }, grid: { display: false } }
            }
        }
    });
}
// Bollinger Bantı data çekme 
function getBBData(closes, period = 20, stdDevMult = 2) {
    let upper = new Array(closes.length).fill(null);
    let mid = new Array(closes.length).fill(null);
    let lower = new Array(closes.length).fill(null);

    for (let i = period - 1; i < closes.length; i++) {
        const slice = closes.slice(i - period + 1, i + 1);
        const sma = slice.reduce((a, b) => a + b, 0) / period;

        const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
        const stdDev = Math.sqrt(variance);

        mid[i] = sma;
        upper[i] = sma + (stdDev * stdDevMult);
        lower[i] = sma - (stdDev * stdDevMult);
    }
    return { upper, mid, lower };
}

function bbchart(raw, bbData) {
    const prices = raw.map(d => parseFloat(d[4]));
    const labels = raw.map(d => new Date(d[0]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));

    const existing = Chart.getChart('bbChart'); // canvas id
    if (existing) existing.destroy();
    new Chart(document.getElementById('bbChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Üst Bant',
                    data: bbData.upper,
                    borderColor: 'rgba(33, 150, 243, 0.4)',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Fiyat',
                    data: prices,
                    borderColor: '#ffffff',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Orta Bant',
                    data: bbData.mid,
                    borderColor: 'rgba(255, 152, 0, 0.4)',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Alt Bant',
                    data: bbData.lower,
                    borderColor: 'rgba(33, 150, 243, 0.4)',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: '-3', // Üst banda (index 0) kadar olan alanı doldurur
                    backgroundColor: 'rgba(33, 150, 243, 0.05)'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e222d',
                    titleColor: '#f0b90b',
                    bodyColor: '#fff',
                    callbacks: {
                        label: (ctx) => ctx.parsed.y !== null ? ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}` : ''
                    }
                }
            },
            scales: {
                y: { position: 'right', grid: { color: '#23262d' }, ticks: { color: '#848e9c' } },
                x: { grid: { display: false }, ticks: { color: '#848e9c', maxTicksLimit: 15 } }
            }
        }
    });
}

function mainChart(raw, signals = []) {
    const canvas = document.getElementById("mainChart");
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

    // --- DEĞİŞİKLİK BURADA: İlk açılışta tüm veriyi göster ---
    let visibleCount = raw.length;
    let viewStart = 0;
    // -------------------------------------------------------

    let isDragging = false;
    let dragStartX = 0, dragStartView = 0;
    let mouseX = -1, mouseY = -1;

    const syncSize = () => {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    };

    const draw = () => {
        const W = canvas.width, H = canvas.height;
        const PAD_TOP = 40, PAD_BOTTOM = 30, RIGHT_PANEL = 70;
        const chartW = W - RIGHT_PANEL, chartH = H - PAD_BOTTOM;

        ctx.fillStyle = '#181a20';
        ctx.fillRect(0, 0, W, H);

        const visible = raw.slice(
            Math.max(0, Math.floor(viewStart)),
            Math.min(raw.length, Math.floor(viewStart + visibleCount))
        );

        if (visible.length === 0) return;

        const minP = Math.min(...visible.map(d => +d[3]));
        const maxP = Math.max(...visible.map(d => +d[2]));
        const pRange = (maxP - minP) || 1;

        const getY = (p) => PAD_TOP + (1 - (p - minP) / pRange) * (chartH - PAD_TOP - 20);
        const cW = chartW / visibleCount;

        // 1. Izgara ve Fiyatlar
        ctx.strokeStyle = '#2b2f36';
        ctx.fillStyle = '#848e9c';
        ctx.font = '11px sans-serif';
        for (let i = 0; i <= 5; i++) {
            const p = minP + (pRange * i / 5);
            const y = getY(p);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
            ctx.fillText(p.toFixed(2), chartW + 5, y + 4);
        }

        // 2. Mumlar
        visible.forEach((d, i) => {
            const x = i * cW + cW / 2;
            const o = +d[1], h = +d[2], l = +d[3], c = +d[4];
            const color = c >= o ? '#0ecb81' : '#f6465d';
            ctx.strokeStyle = ctx.fillStyle = color;
            ctx.beginPath(); ctx.moveTo(x, getY(h)); ctx.lineTo(x, getY(l)); ctx.stroke();
            const bodyW = Math.max(0.5, cW * 0.8);
            ctx.fillRect(x - bodyW / 2, getY(Math.max(o, c)), bodyW, Math.max(1, Math.abs(getY(o) - getY(c))));
        });

        // 3. Sinyaller (Hassas Eşleşme Düzeltildi)
        signals.forEach(sig => {
            const candleIdx = visible.findIndex(d => d[0] === sig.timestamp);

            if (candleIdx !== -1) {
                const x = candleIdx * cW + cW / 2;
                const isBuy = sig.direction === 'buy';
                const candleData = visible[candleIdx];
                const yPos = isBuy ? getY(+candleData[3]) : getY(+candleData[2]);
                const color = isBuy ? '#00ff88' : '#ff3355'; // Daha canlı neon renkler

                ctx.save(); // Gölge efektinin diğer çizimleri bozmaması için sakla

                // --- IŞIK (NEON) EFEKTİ ---
                ctx.shadowBlur = 15;
                ctx.shadowColor = color;
                ctx.fillStyle = color;

                // Parlayan bir daire (Sinyal Lambası)
                ctx.beginPath();
                const circleY = isBuy ? yPos + 15 : yPos - 15;
                ctx.arc(x, circleY, 5, 0, Math.PI * 2);
                ctx.fill();

                // --- NEDEN YAZISI ---
                ctx.shadowBlur = 0; // Yazı net olsun diye gölgeyi kapat
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'center';

                // Nedenleri birleştirip yazalım (Örn: "RSI Dip + MACD")
                const reasonText = sig.reasons.join(' + ');
                const labelY = isBuy ? circleY + 15 : circleY - 10;

                // Yazı arkasına hafif bir koyuluk (Okunabilirlik için)
                const textWidth = ctx.measureText(reasonText).width;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(x - (textWidth / 2) - 5, labelY - 10, textWidth + 10, 14);

                // Yazıyı bas
                ctx.fillStyle = color;
                ctx.fillText(reasonText, x, labelY);

                ctx.restore(); // Ayarları sıfırla
            }
        });

        // 4. Crosshair
        if (mouseX > 0 && mouseX < chartW) {
            ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.beginPath(); ctx.moveTo(mouseX, 0); ctx.lineTo(mouseX, chartH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, mouseY); ctx.lineTo(chartW, mouseY); ctx.stroke();
            ctx.setLineDash([]);
        }
    };

    // --- İnteraktif Kontroller ---
    canvas.onmousedown = e => {
        isDragging = true; dragStartX = e.clientX; dragStartView = viewStart;
    };
    window.onmouseup = () => isDragging = false;
    canvas.onmousemove = e => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;
        if (isDragging) {
            const deltaX = (dragStartX - e.clientX);
            const moveRatio = deltaX / (canvas.width / visibleCount);
            viewStart = Math.max(0, Math.min(raw.length - visibleCount, dragStartView + moveRatio));
        }
        draw();
    };
    canvas.onwheel = e => {
        e.preventDefault();
        const zoomSpeed = 0.15;
        const delta = e.deltaY > 0 ? 1 : -1;
        const oldVisibleCount = visibleCount;
        visibleCount = Math.max(10, Math.min(raw.length, visibleCount * (1 + delta * zoomSpeed)));
        viewStart += (oldVisibleCount - visibleCount) * (mouseX / canvas.width);
        viewStart = Math.max(0, Math.min(raw.length - visibleCount, viewStart));
        draw();
    };

    window.addEventListener('resize', () => { syncSize(); draw(); });
    syncSize();
    draw();
}

main()