async function main() {
    const res = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1000");
    let raw = await res.json();
    raw.sort((a, b) => a[0] - b[0]);
    bbchart(raw)
    kdjchart(raw)
    rsichart(raw)
    macdchart(raw)
    ma_ema_smaChart(raw)
}
// Ma-Ema-Sma chart yardımcı fonksiyon
function calcSMA(data, p) {
    return data.map((_, i) => i < p - 1 ? null : data.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
}
// Ma-Ema-Sma chart yardımcı fonksiyon
function calcEMA(data, p) {
    const k = 2 / (p + 1);
    let prev = data[0];
    return data.map((v, i) => i < p - 1 ? null : (prev = v * k + prev * (1 - k)));
}

function ma_ema_smaChart(raw) {
    const closes = raw.map(d => parseFloat(d[4]));
    const candles = raw.map(d => ({
        x: d[0],
        o: parseFloat(d[1]),
        h: parseFloat(d[2]),
        l: parseFloat(d[3]),
        c: parseFloat(d[4])
    }));

    const sma7 = calcSMA(closes, 7).map((v, i) => ({ x: raw[i][0], y: v }));
    const ema25 = calcEMA(closes, 25).map((v, i) => ({ x: raw[i][0], y: v }));
    const ma50 = calcSMA(closes, 50).map((v, i) => ({ x: raw[i][0], y: v }));

    new Chart(document.getElementById('ma_ema_smaChart'), {
        type: 'candlestick',
        data: {
            datasets: [
                {
                    type: 'candlestick',
                    label: 'Fiyat',
                    data: candles,
                    // Renk ayarlarını buradaki gibi detaylandırabilirsin
                    color: {
                        up: '#26a69a',    // Yükseliş mumunun iç rengi
                        down: '#ef5350',  // Düşüş mumunun iç rengi
                        unchanged: '#9194a3'
                    },
                    // --- DEĞİŞİKLİK BURADA ---
                    borderColor: {
                        up: '#26a69a',    // Yükseliş mumunun kenar rengi
                        down: '#ef5350',  // Düşüş mumunun kenar rengi
                        unchanged: '#9194a3'
                    },
                    borderWidth: 1,       // 1 yaparak o kalınlığı inceltiyoruz
                    // ------------------------
                    order: 4
                },
                {
                    type: 'line',
                    label: 'SMA (7)',
                    data: sma7,
                    borderColor: '#f0b90b',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.1,
                    order: 1
                },
                {
                    type: 'line',
                    label: 'EMA (25)',
                    data: ema25,
                    borderColor: '#2196f3',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.1,
                    order: 2
                },
                {
                    type: 'line',
                    label: 'MA (50)',
                    data: ma50,
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

//Macd chart yardımcı fonksiyon
function calcEMA(data, period) {
    const k = 2 / (period + 1);
    return data.reduce((ema, val, i) => {
        ema.push(i === 0 ? val : val * k + ema[i - 1] * (1 - k));
        return ema;
    }, []);
}

function macdchart(raw) {
    const prices = raw.map(d => parseFloat(d[4]));
    const labels = raw.map(d => new Date(d[0]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    const ema12 = calcEMA(prices, 12);
    const ema26 = calcEMA(prices, 26);

    // MACD Çizgisi: 12 EMA - 26 EMA
    const macd = ema12.map((v, i) => v - ema26[i]);
    const signal = calcEMA(macd, 9);
    const hist = macd.map((m, i) => m - signal[i]);

    new Chart(document.getElementById('macdChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Histogram',
                    data: hist,
                    backgroundColor: hist.map(v => v >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)'),
                    borderWidth: 0,
                    order: 3
                },
                {
                    type: 'line',
                    label: 'MACD',
                    data: macd,
                    borderColor: '#2962FF',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.1,
                    order: 1
                },
                {
                    type: 'line',
                    label: 'Sinyal',
                    data: signal,
                    borderColor: '#FF6D00',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.1,
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
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}`
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
// Rsi chart yardımcı fonksiyon
function calculateRSI(closes, period) {
    let rsi = new Array(closes.length).fill(null);
    let gains = [], losses = [];

    for (let i = 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i - 1];
        gains.push(Math.max(0, diff));
        losses.push(Math.max(0, -diff));
    }

    let avgG = gains.slice(0, period).reduce((a, b) => a + b) / period;
    let avgL = losses.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < closes.length; i++) {
        rsi[i] = 100 - (100 / (1 + avgG / (avgL || 1e-5)));
        avgG = (avgG * (period - 1) + gains[i]) / period;
        avgL = (avgL * (period - 1) + losses[i]) / period;
    }
    return rsi;
}

function rsichart(raw) {

    const safeZonePlugin = {
        id: 'safeZone',
        beforeDraw: (chart) => {
            const { ctx, chartArea: { left, width }, scales: { y } } = chart;
            const y70 = y.getPixelForValue(70);
            const y30 = y.getPixelForValue(30);

            ctx.save();
            ctx.fillStyle = 'rgba(240, 185, 11, 0.03)';
            ctx.fillRect(left, y70, width, y30 - y70);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.setLineDash([5, 5]);
            [70, 30].forEach(v => {
                const yPos = y.getPixelForValue(v);
                ctx.beginPath();
                ctx.moveTo(left, yPos);
                ctx.lineTo(left + width, yPos);
                ctx.stroke();
            });
            ctx.restore();
        }
    };
    const labels = raw.map(d => new Date(d[0]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    const closes = raw.map(d => parseFloat(d[4]));
    const rsiData = calculateRSI(closes, 14);

    new Chart(document.getElementById('rsiChart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
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


function kdjchart(raw) {
    const data = raw.map(d => ({
        time: new Date(d[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4])
    }));

    // KDJ Hesaplama (Aynı Mantık)
    let K = 50, D = 50;
    const kdjData = data.map((m, i) => {
        if (i < 9) return { K: 50, D: 50, J: 50 };
        const last9 = data.slice(i - 8, i + 1);
        const hh = Math.max(...last9.map(x => x.high));
        const ll = Math.min(...last9.map(x => x.low));
        const rsv = hh === ll ? 50 : ((m.close - ll) / (hh - ll)) * 100;
        K = (2 / 3) * K + (1 / 3) * rsv;
        D = (2 / 3) * D + (1 / 3) * K;
        return { K, D, J: 3 * K - 2 * D };
    });

    const ctx = document.getElementById('kdjChart').getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.time),
            datasets: [
                { label: 'K', data: kdjData.map(r => r.K), borderColor: 'white', borderWidth: 1, pointRadius: 0, tension: 0.1 },
                { label: 'D', data: kdjData.map(r => r.D), borderColor: 'yellow', borderWidth: 1, pointRadius: 0, tension: 0.1 },
                { label: 'J', data: kdjData.map(r => r.J), borderColor: 'magenta', borderWidth: 1.5, pointRadius: 0, tension: 0.1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index', // Aynı X eksenindeki tüm verileri seç
                intersect: false // Fare tam çizginin üzerinde olmasa da çalış
            },
            plugins: {
                legend: { display: false }, // Üstteki lejantı gizle (köşede var zaten)
                tooltip: {
                    enabled: true,
                    external: function (context) {
                        // Tooltip her güncellendiğinde bu fonksiyon çalışır
                        const tooltipModel = context.tooltip;

                        if (tooltipModel.opacity === 0) {
                            return; // Tooltip gizliyse bir şey yapma
                        }

                        // O andaki verinin index'ini al
                        const dataIndex = tooltipModel.dataPoints[0].dataIndex;
                        const v = kdjData[dataIndex];

                    }
                }
            },
            scales: {
                y: { grid: { color: '#333' }, min: -20, max: 120 }, // J çizgisi için ekseni biraz genişlet
                x: { ticks: { maxTicksLimit: 15 }, grid: { display: false } }
            }
        }
    });
}

function bbchart(raw) {
    const prices = raw.map(d => parseFloat(d[4]));
    const labels = raw.map(d => new Date(d[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    const period = 20;
    const stdDevMult = 2;

    // Boşluk kalmaması için sadece hesaplanmış verileri tutacak diziler
    const finalLabels = [], finalPrices = [], upper = [], mid = [], lower = [];

    for (let i = period - 1; i < prices.length; i++) {
        const slice = prices.slice(i - period + 1, i + 1);
        const sma = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
        const stdDev = Math.sqrt(variance);

        finalLabels.push(labels[i]);
        finalPrices.push(prices[i]);
        upper.push(sma + (stdDev * stdDevMult));
        mid.push(sma);
        lower.push(sma - (stdDev * stdDevMult));
    }
    const ctx = document.getElementById('bbChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: finalLabels,
            datasets: [
                {
                    label: 'Üst Bant',
                    data: upper,
                    borderColor: 'rgba(33, 150, 243, 0.4)',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Fiyat',
                    data: finalPrices,
                    borderColor: '#ffffff',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Orta Bant',
                    data: mid,
                    borderColor: 'rgba(255, 152, 0, 0.4)',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Alt Bant',
                    data: lower,
                    borderColor: 'rgba(33, 150, 243, 0.4)',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: '-3', // Üst banda kadar olan alanı doldurur
                    backgroundColor: 'rgba(33, 150, 243, 0.05)'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    position: 'right',
                    grid: { color: '#23262d' },
                    ticks: { color: '#848e9c', font: { size: 11 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#848e9c', maxTicksLimit: 15, font: { size: 11 } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: '#1e222d', titleColor: '#f0b90b', bodyColor: '#fff' }
            }
        }
    });
}

main()