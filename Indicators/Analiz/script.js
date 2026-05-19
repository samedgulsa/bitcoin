
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
        let position = null;

        for (let i = 51; i < closes.length; i++) {
            const signal = config.getSignal(i);
            const price = closes[i];

            if (!position && signal === 'buy') {
                position = {
                    entryPrice: price,
                    entryIndex: i,
                    entryTime: new Date(raw[i][0]).toLocaleString('tr-TR')
                };
            } else if (position && signal === 'sell') {
                const pnl = ((price - position.entryPrice) / position.entryPrice) * 100;
                const duration = i - position.entryIndex;

                trades.push({
                    entryTime: position.entryTime,
                    exitTime: new Date(raw[i][0]).toLocaleString('tr-TR'),
                    entryIndex: position.entryIndex,
                    exitIndex: i,
                    entryPrice: position.entryPrice,
                    exitPrice: price,
                    pnl: parseFloat(pnl.toFixed(3)),
                    duration,
                    isSuccess: pnl > 0
                });

                position = null;
            }
        }

        const total = trades.length;
        const wins = trades.filter(t => t.isSuccess).length;
        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const avgPnl = total > 0 ? totalPnl / total : 0;
        const avgDuration = total > 0
            ? trades.reduce((sum, t) => sum + t.duration, 0) / total
            : 0;

        const tradesForChart = trades.map((t, idx) => ({
            id: idx + 1,
            entryTimestamp: raw[t.entryIndex][0],
            exitTimestamp: raw[t.exitIndex][0],
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            entryIndex: t.entryIndex,
            exitIndex: t.exitIndex,
            pnl: t.pnl,
            duration: t.duration,
            isSuccess: t.isSuccess,
            entryTime: t.entryTime,
            exitTime: t.exitTime
        }));

        allResults[config.name] = {
            trades,
            tradesForChart,
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
// ============================================
// DEMO PANEL - KALDIRAÇLI İŞLEM SİMÜLASYONU
// ============================================
function calculateDemo(trades, initialBalance, leverage) {
    const liqThreshold = 100 / leverage;
    let balance = initialBalance;
    let maxBalance = balance;
    let minBalance = balance;
    let firstLiquidationTrade = null;
    let totalWins = 0;
    let totalLosses = 0;
    let totalLiquidations = 0;

    const results = trades.map((trade, idx) => {
        const leveragedPnl = trade.pnl * leverage;
        const isLiquidated = trade.pnl < 0 && Math.abs(trade.pnl) >= liqThreshold;

        let tradeResult, endBalance, pnlDisplay;

        if (isLiquidated) {
            tradeResult = 'liquidated';
            endBalance = 0;
            pnlDisplay = -100;
            totalLiquidations++;
            if (!firstLiquidationTrade) firstLiquidationTrade = idx + 1;
        } else {
            const multiplier = 1 + (leveragedPnl / 100);
            endBalance = balance * multiplier;
            pnlDisplay = leveragedPnl;
            if (leveragedPnl > 0) totalWins++;
            else if (leveragedPnl < 0) totalLosses++;
            tradeResult = leveragedPnl >= 0 ? 'win' : 'loss';
        }

        const row = {
            id: idx + 1,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            entryTime: trade.entryTime,
            exitTime: trade.exitTime,
            realPnl: trade.pnl,
            leveragedPnl: pnlDisplay,
            startBalance: balance,
            endBalance: endBalance,
            result: tradeResult,
            isLiquidated: isLiquidated,
            duration: trade.duration
        };

        balance = endBalance;
        if (balance > maxBalance) maxBalance = balance;
        if (balance < minBalance) minBalance = balance;

        return row;
    });

    const totalChange = initialBalance > 0 ? ((balance - initialBalance) / initialBalance) * 100 : -100;
    const maxDrawdown = initialBalance > 0 ? ((minBalance - initialBalance) / initialBalance) * 100 : -100;

    return {
        rows: results,
        summary: {
            initialBalance,
            finalBalance: balance,
            totalChange,
            maxBalance,
            minBalance,
            maxDrawdown,
            totalWins,
            totalLosses,
            totalLiquidations,
            firstLiquidationTrade,
            totalTrades: trades.length
        }
    };
}

function renderDemoPanel(trades, indicatorName) {
    const panel = document.querySelector('.demo-panel');
    if (!panel) return;

    const leverageOptions = [1, 5, 10, 25, 50, 100];
    let selectedLeverage = 10;
    let userBalance = 1000;

    const runCalculation = () => {
        const data = calculateDemo(trades, userBalance, selectedLeverage);
        updateUI(data);
    };

    const updateUI = (data) => {
        const s = data.summary;
        const rows = data.rows;

        const finalColor = s.finalBalance >= s.initialBalance ? '#0ecb81' : '#f6465d';
        const changeColor = s.totalChange >= 0 ? '#0ecb81' : '#f6465d';
        const liqColor = s.totalLiquidations > 0 ? '#f6465d' : '#848e9c';

        const liqInfo = s.firstLiquidationTrade
            ? `<span style="color:#f6465d; font-weight:bold;">İlk likidasyon: #${s.firstLiquidationTrade}. işlemde</span>`
            : `<span style="color:#0ecb81;">Likidasyon olmadı</span>`;

        const tableRows = rows.map(r => {
            const pnlColor = r.leveragedPnl >= 0 ? '#0ecb81' : '#f6465d';
            const resultIcon = r.isLiquidated ? '🔥' : (r.leveragedPnl >= 0 ? '✅' : '❌');
            const resultText = r.isLiquidated ? 'LİKİT' : (r.leveragedPnl >= 0 ? 'Kazanç' : 'Kayıp');
            const resultColor = r.isLiquidated ? '#f6465d' : pnlColor;

            return `
                <tr style="border-bottom: 1px solid #1e2329; font-size: 11px;">
                    <td style="padding: 6px 8px; color: #848e9c;">#${r.id}</td>
                    <td style="padding: 6px 8px; color: #eaecef;">${r.entryPrice.toFixed(2)}</td>
                    <td style="padding: 6px 8px; color: #eaecef;">${r.exitPrice.toFixed(2)}</td>
                    <td style="padding: 6px 8px; color: ${r.realPnl >= 0 ? '#0ecb81' : '#f6465d'};">${r.realPnl > 0 ? '+' : ''}${r.realPnl}%</td>
                    <td style="padding: 6px 8px; color: ${pnlColor}; font-weight: bold;">${r.leveragedPnl > 0 ? '+' : ''}${r.leveragedPnl.toFixed(1)}%</td>
                    <td style="padding: 6px 8px; color: #eaecef;">${r.startBalance.toFixed(2)}</td>
                    <td style="padding: 6px 8px; color: ${r.endBalance >= r.startBalance ? '#0ecb81' : '#f6465d'};">${r.endBalance.toFixed(2)}</td>
                    <td style="padding: 6px 8px; color: ${resultColor}; font-weight: bold;">${resultIcon} ${resultText}</td>
                </tr>
            `;
        }).join('');

        panel.innerHTML = `
            <style>
                .demo-panel { font-family: monospace; color: #eaecef; background: #181a20; border-top: 1px solid #2b2f36; }
                .demo-header { padding: 12px 15px; border-bottom: 1px solid #2b2f36; font-size: 13px; color: #f0b90b; letter-spacing: 1px; display: flex; justify-content: space-between; align-items: center; }
                .demo-controls { padding: 12px 15px; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #2b2f36; }
                .demo-control-group { display: flex; flex-direction: column; gap: 4px; }
                .demo-control-group label { font-size: 10px; color: #848e9c; text-transform: uppercase; letter-spacing: 1px; }
                .demo-input { background: #1e2329; border: 1px solid #2b2f36; color: #eaecef; padding: 6px 10px; font-family: monospace; font-size: 12px; border-radius: 4px; width: 120px; outline: none; }
                .demo-input:focus { border-color: #f0b90b; }
                .lev-btn { background: #1e2329; border: 1px solid #2b2f36; color: #848e9c; padding: 5px 12px; font-family: monospace; font-size: 11px; cursor: pointer; border-radius: 4px; transition: all 0.15s; }
                .lev-btn:hover { border-color: #848e9c; color: #eaecef; }
                .lev-btn.active { background: #f0b90b; border-color: #f0b90b; color: #181a20; font-weight: bold; }
                .demo-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; padding: 12px 15px; border-bottom: 1px solid #2b2f36; }
                .stat-card { background: #1e2329; border: 1px solid #2b2f36; border-radius: 6px; padding: 10px; text-align: center; }
                .stat-label { font-size: 10px; color: #848e9c; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
                .stat-value { font-size: 16px; font-weight: bold; }
                .demo-table-wrap { overflow-x: auto; max-height: 300px; overflow-y: auto; }
                .demo-table { width: 100%; border-collapse: collapse; font-size: 11px; }
                .demo-table th { position: sticky; top: 0; background: #181a20; padding: 8px; color: #848e9c; border-bottom: 1px solid #2b2f36; text-align: left; font-weight: normal; }
                .demo-liq-banner { padding: 8px 15px; background: rgba(246, 70, 93, 0.08); border-bottom: 1px solid #2b2f36; font-size: 12px; text-align: center; }
            </style>

            <div class="demo-header">
                <span>🎰 KALDIRAÇLI DEMO — ${indicatorName}</span>
                <span style="font-size:11px; color:#848e9c;">Compound (Bileşik) Hesaplama</span>
            </div>

            <div class="demo-controls">
                <div class="demo-control-group">
                    <label>Başlangıç Bakiyesi (TL)</label>
                    <input type="number" class="demo-input" id="demoBalance" value="${userBalance}" min="1" step="10">
                </div>
                <div class="demo-control-group">
                    <label>Kaldıraç</label>
                    <div style="display:flex; gap:4px;" id="levButtons">
                        ${leverageOptions.map(lev => `
                            <button class="lev-btn ${lev === selectedLeverage ? 'active' : ''}" data-lev="${lev}">${lev}x</button>
                        `).join('')}
                    </div>
                </div>
                <div class="demo-control-group">
                    <label>Likit Eşiği</label>
                    <div style="color:#f6465d; font-size:12px; font-weight:bold;">%${(100/selectedLeverage).toFixed(2)}</div>
                    <div style="color:#5e6673; font-size:10px;">Fiyat bu kadar ters giderse</div>
                </div>
            </div>

            ${s.totalLiquidations > 0 ? `<div class="demo-liq-banner">${liqInfo}</div>` : ''}

            <div class="demo-stats">
                <div class="stat-card">
                    <div class="stat-label">Final Bakiye</div>
                    <div class="stat-value" style="color:${finalColor};">${s.finalBalance.toFixed(2)} TL</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Net Değişim</div>
                    <div class="stat-value" style="color:${changeColor};">${s.totalChange >= 0 ? '+' : ''}${s.totalChange.toFixed(2)}%</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">En Yüksek Bakiye</div>
                    <div class="stat-value" style="color:#0ecb81;">${s.maxBalance.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">En Düşük Bakiye</div>
                    <div class="stat-value" style="color:${s.minBalance <= 0 ? '#f6465d' : '#eaecef'};">${s.minBalance.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Kazanan</div>
                    <div class="stat-value" style="color:#0ecb81;">${s.totalWins}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Kaybeden</div>
                    <div class="stat-value" style="color:#f6465d;">${s.totalLosses}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Likidasyon</div>
                    <div class="stat-value" style="color:${liqColor};">${s.totalLiquidations}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Max Drawdown</div>
                    <div class="stat-value" style="color:${s.maxDrawdown >= 0 ? '#0ecb81' : '#f6465d'};">${s.maxDrawdown.toFixed(2)}%</div>
                </div>
            </div>

            <div class="demo-table-wrap">
                <table class="demo-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Giriş</th>
                            <th>Çıkış</th>
                            <th>Gerçek PnL</th>
                            <th>Kaldıraçlı PnL</th>
                            <th>Başlangıç</th>
                            <th>Bitiş</th>
                            <th>Sonuç</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        `;

        // Event listeners
        const balanceInput = panel.querySelector('#demoBalance');
        balanceInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (val > 0) {
                userBalance = val;
                runCalculation();
            }
        });

        panel.querySelectorAll('.lev-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedLeverage = parseInt(btn.dataset.lev);
                runCalculation();
            });
        });
    };

    runCalculation();
}

function renderIndicatorButtons(allResults) {
    // Grafik container'ının üstüne buton satırı ekle
    const canvas = document.getElementById("mainChart");
    if (!canvas) return;
 
    const container = canvas.parentElement;
 
    // Daha önce eklenmişse kaldır
    const old = document.getElementById("indicatorButtons");
    if (old) old.remove();
 
    const btnRow = document.createElement('div');
    btnRow.id = 'indicatorButtons';
    btnRow.style.cssText = `
        display: flex;
        gap: 6px;
        padding: 8px 12px;
        background: #181a20;
        border-bottom: 1px solid #2b2f36;
        flex-wrap: wrap;
        align-items: center;
        font-family: monospace;
    `;
 
    // Başlık
    const label = document.createElement('span');
    label.textContent = 'İNDİKATÖRLER:';
    label.style.cssText = 'font-size: 10px; color: #5e6673; letter-spacing: 1px; margin-right: 4px;';
    btnRow.appendChild(label);
 
    Object.entries(allResults).forEach(([name, data]) => {
        const color = INDICATOR_COLORS[name] || '#ffffff';
        let active = false;
 
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.dataset.indicator = name;
 
        const setStyle = () => {
            btn.style.cssText = `
                padding: 4px 12px;
                font-family: monospace;
                font-size: 11px;
                cursor: pointer;
                border-radius: 4px;
                transition: all 0.15s;
                border: 1px solid ${active ? color : '#2b2f36'};
                background: ${active ? color + '22' : '#1e2329'};
                color: ${active ? color : '#5e6673'};
                font-weight: ${active ? 'bold' : 'normal'};
                box-shadow: ${active ? `0 0 8px ${color}44` : 'none'};
            `;
        };
 
        setStyle();
 
        btn.addEventListener('click', () => {
            active = !active;
            setStyle();
            if (canvas.setIndicator) {
                canvas.setIndicator(name, data.tradesForChart, active);
            }
        });
 
        btn.addEventListener('mouseenter', () => {
            if (!active) {
                btn.style.borderColor = color + '88';
                btn.style.color = color + 'aa';
            }
        });
        btn.addEventListener('mouseleave', () => {
            if (!active) {
                btn.style.borderColor = '#2b2f36';
                btn.style.color = '#5e6673';
            }
        });
 
        btnRow.appendChild(btn);
    });
 
    // "Tümünü Temizle" butonu
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ Temizle';
    clearBtn.style.cssText = `
        padding: 4px 10px;
        font-family: monospace;
        font-size: 10px;
        cursor: pointer;
        border-radius: 4px;
        border: 1px solid #2b2f36;
        background: #1e2329;
        color: #5e6673;
        margin-left: 8px;
        transition: all 0.15s;
    `;
    clearBtn.addEventListener('click', () => {
        // Tüm butonları pasife al
        btnRow.querySelectorAll('button[data-indicator]').forEach(b => {
            b.click();
            // Sadece active olanları kapat
        });
        // Daha güvenli: activeTradesMap'i temizle
        if (canvas.activeTradesMap) {
            canvas.activeTradesMap = {};
        }
        // Tüm butonları pasife zorla
        btnRow.querySelectorAll('button[data-indicator]').forEach(b => {
            const n = b.dataset.indicator;
            const c = INDICATOR_COLORS[n] || '#fff';
            b.style.cssText = `
                padding: 4px 12px;
                font-family: monospace;
                font-size: 11px;
                cursor: pointer;
                border-radius: 4px;
                border: 1px solid #2b2f36;
                background: #1e2329;
                color: #5e6673;
                font-weight: normal;
                box-shadow: none;
                transition: all 0.15s;
            `;
        });
        if (canvas.setIndicator) canvas.setIndicator('__clear__', [], false);
        // Manuel redraw
        const redrawEvent = new Event('mousemove');
        canvas.dispatchEvent(redrawEvent);
    });
    btnRow.appendChild(clearBtn);
 
    // Canvas container'ın başına ekle
    container.insertBefore(btnRow, canvas);
}

function renderAnalizPanel(allResults) {
    const panel = document.querySelector('.analiz-panel');
    if (!panel) return;
 
    // Butonları da render et
    renderIndicatorButtons(allResults);
 
    const rows = Object.entries(allResults).map(([name, data]) => {
        const s = data.stats;
        const color = INDICATOR_COLORS[name] || '#ffffff';
        const pnlColor = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
        const avgColor = s.avgPnl  >= 0 ? '#0ecb81' : '#f6465d';
        const wrColor  = s.winRate >= 50 ? '#0ecb81' : '#f6465d';
 
        return `
            <tr class="indicator-row" data-indicator="${name}" style="border-bottom: 1px solid #1e2329; cursor: pointer; transition: background 0.2s;">
                <td style="padding: 8px; color: #eaecef; display: flex; align-items: center; gap: 8px;">
                    <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${color};"></span>
                    ${name}
                </td>
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
        <style>
            .indicator-row:hover { background: #2b2f36 !important; }
            .indicator-row.active { background: #1e2329 !important; border-left: 3px solid #f0b90b; }
        </style>
        <div style="font-family: monospace; color: #eaecef;">
            <div style="padding: 12px 15px; border-bottom: 1px solid #2b2f36; font-size: 13px; color: #848e9c; letter-spacing: 1px;">
                İNDİKATÖR BAZINDA BACKTEST — Tıkla ve grafikte gör
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
 
    panel.querySelectorAll('.indicator-row').forEach(row => {
        row.addEventListener('click', () => {
            panel.querySelectorAll('.indicator-row').forEach(r => r.classList.remove('active'));
            row.classList.add('active');
 
            const indicatorName = row.getAttribute('data-indicator');
            const indicatorData = allResults[indicatorName];
 
            // Demo panel güncelle
            renderDemoPanel(indicatorData.trades, indicatorName);
        });
    });
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


const INDICATOR_COLORS = {
    "RSI":          "#ff9800",   // Turuncu
    "MACD (Güçlü)": "#2196f3",  // Mavi
    "MACD (Zayıf)": "#9c27b0",  // Mor
    "Bollinger Bands": "#f0b90b", // Sarı
    "KDJ":          "#e91e63"    // Pembe
};

function mainChart(raw, initialTrades = []) {
    const canvas = document.getElementById("mainChart");
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
 
    // activeTradesMap: { indicatorName -> tradesForChart[] }
    canvas.activeTradesMap = {};
    canvas.hoveredTrade = null;
 
    let visibleCount = raw.length;
    let viewStart = 0;
 
    let isDragging = false;
    let dragStartX = 0, dragStartView = 0;
    let mouseX = -1, mouseY = -1;
 
    const syncSize = () => {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    };
 
    const formatDateShort = (ts) => {
        const d = new Date(ts);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const mon = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}/${mon} ${h}:${m}`;
    };
 
    const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    };
 
    const draw = () => {
        const W = canvas.width, H = canvas.height;
        const PAD_TOP = 40, PAD_BOTTOM = 80, RIGHT_PANEL = 90, VOL_HEIGHT = 80;
        const chartH = H - PAD_BOTTOM - VOL_HEIGHT;
        const chartW = W - RIGHT_PANEL;
 
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
        const maxVol = Math.max(...visible.map(d => +d[5] || 0)) || 1;
 
        const getY = (p) => PAD_TOP + (1 - (p - minP) / pRange) * (chartH - PAD_TOP);
        const cW = chartW / visibleCount;
 
        // 1. Izgara
        ctx.strokeStyle = '#2b2f36';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const p = minP + (pRange * i / 5);
            const y = getY(p);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
        }
 
        // 2. Mumlar
        visible.forEach((d, i) => {
            const x = i * cW + cW / 2;
            const o = +d[1], h = +d[2], l = +d[3], c = +d[4];
            const color = c >= o ? '#0ecb81' : '#f6465d';
            ctx.strokeStyle = ctx.fillStyle = color;
            ctx.beginPath(); ctx.moveTo(x, getY(h)); ctx.lineTo(x, getY(l)); ctx.stroke();
            const bodyW = Math.max(0.5, cW * 0.75);
            ctx.fillRect(x - bodyW / 2, getY(Math.max(o, c)), bodyW, Math.max(1, Math.abs(getY(o) - getY(c))));
        });
 
        // 3. Hacim
        const volTop = H - PAD_BOTTOM - VOL_HEIGHT;
        ctx.fillStyle = 'rgba(24, 26, 32, 0.95)';
        ctx.fillRect(0, volTop, chartW, VOL_HEIGHT);
        ctx.strokeStyle = '#2b2f36';
        ctx.beginPath(); ctx.moveTo(0, volTop); ctx.lineTo(chartW, volTop); ctx.stroke();
 
        visible.forEach((d, i) => {
            const x = i * cW + cW / 2;
            const c = +d[4], o = +d[1];
            const vol = +d[5] || 0;
            const color = c >= o ? 'rgba(14, 203, 129, 0.5)' : 'rgba(246, 70, 93, 0.5)';
            const h = (vol / maxVol) * (VOL_HEIGHT - 10);
            ctx.fillStyle = color;
            ctx.fillRect(x - cW * 0.35, H - PAD_BOTTOM - h, cW * 0.7, h);
        });
 
        // 4. X Ekseni
        ctx.fillStyle = '#848e9c';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        const step = Math.max(1, Math.floor(visible.length / 8));
        for (let i = 0; i < visible.length; i += step) {
            const x = i * cW + cW / 2;
            ctx.fillText(formatDateShort(visible[i][0]), x, H - PAD_BOTTOM + 15);
        }
 
        // 5. Son fiyat çizgisi
        const lastClose = +visible[visible.length - 1][4];
        const lastY = getY(lastClose);
        ctx.strokeStyle = '#f0b90b';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(chartW, lastY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f0b90b';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lastClose.toFixed(2), chartW + 8, lastY + 4);
 
        // 6. Sağ panel
        ctx.fillStyle = '#848e9c';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        for (let i = 0; i <= 5; i++) {
            const p = minP + (pRange * i / 5);
            const y = getY(p);
            ctx.fillText(p.toFixed(2), chartW + 5, y + 4);
        }
        ctx.fillStyle = '#5e6673';
        ctx.font = '10px sans-serif';
        ctx.fillText(`Min: ${minP.toFixed(2)}`, chartW + 5, PAD_TOP - 5);
        ctx.fillText(`Max: ${maxP.toFixed(2)}`, chartW + 5, PAD_TOP + 10);
 
        // 7. TRADE HARİTASI — tüm aktif indikatörler
        let hoveredTrade = null;
 
        // Çakışma takibi: mum index -> kaç etiket var (offset hesabı için)
        const entryOffsets = {};
        const exitOffsets  = {};
 
        const activeEntries = Object.entries(canvas.activeTradesMap);
 
        activeEntries.forEach(([indicatorName, trades]) => {
            const color = INDICATOR_COLORS[indicatorName] || '#ffffff';
 
            trades.forEach(trade => {
                const entryIdx = visible.findIndex(d => d[0] == trade.entryTimestamp);
                const exitIdx  = visible.findIndex(d => d[0] == trade.exitTimestamp);
 
                if (entryIdx === -1 && exitIdx === -1) return;
 
                const x1 = entryIdx !== -1 ? entryIdx * cW + cW / 2 : null;
                const x2 = exitIdx  !== -1 ? exitIdx  * cW + cW / 2 : null;
                const y1 = entryIdx !== -1 ? getY(trade.entryPrice) : null;
                const y2 = exitIdx  !== -1 ? getY(trade.exitPrice)  : null;
 
                // Kutu
                if (entryIdx !== -1 && exitIdx !== -1) {
                    const boxX = x1;
                    const boxY = Math.min(y1, y2);
                    const boxW = x2 - x1;
                    const boxH = Math.abs(y2 - y1);
 
                    if (mouseX >= boxX && mouseX <= boxX + boxW &&
                        mouseY >= boxY && mouseY <= boxY + boxH) {
                        hoveredTrade = { trade, color, indicatorName };
                    }
 
                    ctx.fillStyle = hexToRgba(color, 0.07);
                    ctx.fillRect(boxX, boxY, boxW, boxH);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1;
                    ctx.globalAlpha = 0.4;
                    ctx.strokeRect(boxX, boxY, boxW, boxH);
                    ctx.globalAlpha = 1;
 
                    // Orta etiket (PnL + süre)
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const infoText = `${trade.pnl > 0 ? '+' : ''}${trade.pnl}%  ·  ${trade.duration}m`;
                    ctx.font = 'bold 9px sans-serif';
                    const textWidth = ctx.measureText(infoText).width;
 
                    ctx.fillStyle = 'rgba(24, 26, 32, 0.90)';
                    ctx.fillRect(midX - textWidth/2 - 6, midY - 9, textWidth + 12, 18);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(midX - textWidth/2 - 6, midY - 9, textWidth + 12, 18);
 
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(infoText, midX, midY);
                    ctx.textBaseline = 'alphabetic';
                }
 
                // AL üçgeni + etiket
                if (entryIdx !== -1) {
                    const offsetCount = entryOffsets[entryIdx] || 0;
                    entryOffsets[entryIdx] = offsetCount + 1;
                    const vertOffset = offsetCount * 30; // her indikatör 30px aşağı
 
                    ctx.save();
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = color;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1 + 10 + vertOffset);
                    ctx.lineTo(x1 - 6, y1 + 22 + vertOffset);
                    ctx.lineTo(x1 + 6, y1 + 22 + vertOffset);
                    ctx.fill();
                    ctx.restore();
 
                    const label1 = `AL`;
                    const label2 = trade.entryPrice.toFixed(2);
                    ctx.font = 'bold 8px sans-serif';
                    const w1 = ctx.measureText(label1).width;
                    ctx.font = '8px sans-serif';
                    const w2 = ctx.measureText(label2).width;
                    const labelW = Math.max(w1, w2) + 10;
                    const labelH = 22;
                    const lx = x1 - labelW / 2;
                    const ly = y1 + 24 + vertOffset;
 
                    ctx.fillStyle = hexToRgba(color, 0.15);
                    ctx.strokeStyle = hexToRgba(color, 0.7);
                    ctx.lineWidth = 1;
                    ctx.fillRect(lx, ly, labelW, labelH);
                    ctx.strokeRect(lx, ly, labelW, labelH);
 
                    ctx.textAlign = 'center';
                    ctx.fillStyle = color;
                    ctx.font = 'bold 8px sans-serif';
                    ctx.fillText(label1, x1, ly + 9);
                    ctx.fillStyle = '#eaecef';
                    ctx.font = '8px sans-serif';
                    ctx.fillText(label2, x1, ly + 19);
                }
 
                // SAT üçgeni + etiket
                if (exitIdx !== -1) {
                    const offsetCount = exitOffsets[exitIdx] || 0;
                    exitOffsets[exitIdx] = offsetCount + 1;
                    const vertOffset = offsetCount * 30;
 
                    ctx.save();
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = color;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(x2, y2 - 10 - vertOffset);
                    ctx.lineTo(x2 - 6, y2 - 22 - vertOffset);
                    ctx.lineTo(x2 + 6, y2 - 22 - vertOffset);
                    ctx.fill();
                    ctx.restore();
 
                    const label1 = `SAT`;
                    const pnlStr = `${trade.pnl > 0 ? '+' : ''}${trade.pnl}%`;
                    ctx.font = 'bold 8px sans-serif';
                    const w1 = ctx.measureText(label1).width;
                    ctx.font = '8px sans-serif';
                    const w2 = ctx.measureText(pnlStr).width;
                    const labelW = Math.max(w1, w2) + 10;
                    const labelH = 22;
                    const lx = x2 - labelW / 2;
                    const ly = y2 - 48 - vertOffset;
 
                    ctx.fillStyle = hexToRgba(color, 0.15);
                    ctx.strokeStyle = hexToRgba(color, 0.7);
                    ctx.lineWidth = 1;
                    ctx.fillRect(lx, ly, labelW, labelH);
                    ctx.strokeRect(lx, ly, labelW, labelH);
 
                    ctx.textAlign = 'center';
                    ctx.fillStyle = color;
                    ctx.font = 'bold 8px sans-serif';
                    ctx.fillText(label1, x2, ly + 9);
                    ctx.fillStyle = '#eaecef';
                    ctx.font = '8px sans-serif';
                    ctx.fillText(pnlStr, x2, ly + 19);
                }
            });
        });
 
        canvas.hoveredTrade = hoveredTrade;
 
        // 8. LEGEND (aktif indikatörler)
        const activeNames = Object.keys(canvas.activeTradesMap);
        if (activeNames.length > 0) {
            const legendPad = 8;
            const legendLineH = 18;
            const legendW = 160;
            const legendH = activeNames.length * legendLineH + legendPad * 2;
            const legendX = 10;
            const legendY = PAD_TOP + 5;
 
            ctx.fillStyle = 'rgba(24, 26, 32, 0.85)';
            ctx.strokeStyle = '#2b2f36';
            ctx.lineWidth = 1;
            ctx.fillRect(legendX, legendY, legendW, legendH);
            ctx.strokeRect(legendX, legendY, legendW, legendH);
 
            activeNames.forEach((name, i) => {
                const c = INDICATOR_COLORS[name] || '#fff';
                const y = legendY + legendPad + i * legendLineH + legendLineH / 2;
 
                ctx.fillStyle = c;
                ctx.fillRect(legendX + 8, y - 5, 12, 10);
 
                ctx.fillStyle = '#eaecef';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(name, legendX + 26, y);
                ctx.textBaseline = 'alphabetic';
            });
        }
 
        // 9. CROSSHAIR + TOOLTIP
        if (mouseX > 0 && mouseX < chartW && mouseY > PAD_TOP && mouseY < chartH) {
            const candleIdx = Math.floor(mouseX / cW);
 
            if (hoveredTrade) {
                const { trade, color, indicatorName } = hoveredTrade;
                const ttW = 210, ttH = 130;
                let tx = mouseX + 15, ty = mouseY + 15;
                if (tx + ttW > chartW) tx = mouseX - ttW - 15;
                if (ty + ttH > chartH) ty = mouseY - ttH - 15;
 
                ctx.fillStyle = 'rgba(30, 35, 41, 0.98)';
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.fillRect(tx, ty, ttW, ttH);
                ctx.strokeRect(tx, ty, ttW, ttH);
 
                // İndikatör adı renk bandı
                ctx.fillStyle = hexToRgba(color, 0.2);
                ctx.fillRect(tx, ty, ttW, 20);
                ctx.fillStyle = color;
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(indicatorName, tx + ttW / 2, ty + 10);
                ctx.textBaseline = 'alphabetic';
 
                const lines = [
                    [`İşlem #${trade.id}`, '', '#f0b90b'],
                    [`Giriş:`, `${trade.entryPrice.toFixed(2)}  (${formatDateShort(trade.entryTimestamp)})`, '#eaecef'],
                    [`Çıkış:`, `${trade.exitPrice.toFixed(2)}  (${formatDateShort(trade.exitTimestamp)})`, '#eaecef'],
                    [`Süre:`, `${trade.duration} mum`, '#848e9c'],
                    [`PnL:`, `${trade.pnl > 0 ? '+' : ''}${trade.pnl}%`, trade.isSuccess ? '#0ecb81' : '#f6465d'],
                    [`Sonuç:`, trade.isSuccess ? 'KAZANÇ ✅' : 'KAYIP ❌', trade.isSuccess ? '#0ecb81' : '#f6465d']
                ];
 
                lines.forEach((line, i) => {
                    ctx.fillStyle = line[2];
                    ctx.font = i === 0 ? 'bold 10px sans-serif' : '10px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.fillText(line[0], tx + 10, ty + 32 + i * 16);
                    ctx.textAlign = 'right';
                    ctx.fillText(line[1], tx + ttW - 10, ty + 32 + i * 16);
                    ctx.textAlign = 'left';
                });
 
            } else if (candleIdx >= 0 && candleIdx < visible.length) {
                const d = visible[candleIdx];
                const x = candleIdx * cW + cW / 2;
                const o = +d[1], h = +d[2], l = +d[3], c = +d[4], vol = +d[5] || 0;
                const change = ((c - o) / o) * 100;
                const changeColor = change >= 0 ? '#0ecb81' : '#f6465d';
 
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x, PAD_TOP); ctx.lineTo(x, chartH); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, mouseY); ctx.lineTo(chartW, mouseY); ctx.stroke();
                ctx.setLineDash([]);
 
                const tooltipW = 170, tooltipH = 115;
                let tx = x + 15, ty = mouseY + 15;
                if (tx + tooltipW > chartW) tx = x - tooltipW - 15;
                if (ty + tooltipH > chartH) ty = mouseY - tooltipH - 15;
 
                ctx.fillStyle = 'rgba(30, 35, 41, 0.95)';
                ctx.strokeStyle = '#2b2f36';
                ctx.lineWidth = 1;
                ctx.fillRect(tx, ty, tooltipW, tooltipH);
                ctx.strokeRect(tx, ty, tooltipW, tooltipH);
 
                const lines = [
                    [`Tarih`, formatDateShort(d[0]), '#848e9c'],
                    [`Açılış`, o.toFixed(2), '#eaecef'],
                    [`Yüksek`, h.toFixed(2), '#0ecb81'],
                    [`Düşük`, l.toFixed(2), '#f6465d'],
                    [`Kapanış`, c.toFixed(2), c >= o ? '#0ecb81' : '#f6465d'],
                    [`Hacim`, vol.toLocaleString('tr-TR'), '#848e9c'],
                    [`Değişim`, `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`, changeColor]
                ];
 
                lines.forEach((line, i) => {
                    ctx.fillStyle = line[2];
                    ctx.font = '11px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.fillText(line[0] + ':', tx + 10, ty + 18 + i * 14);
                    ctx.textAlign = 'right';
                    ctx.fillText(line[1], tx + tooltipW - 10, ty + 18 + i * 14);
                });
            }
        }
    };
 
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
 
    const resizeHandler = () => { syncSize(); draw(); };
    if (canvas.resizeHandler) window.removeEventListener('resize', canvas.resizeHandler);
    canvas.resizeHandler = resizeHandler;
    window.addEventListener('resize', resizeHandler);
 
    // Dışarıdan indikatör ekle/çıkar
    canvas.setIndicator = (indicatorName, trades, active) => {
        if (active) {
            canvas.activeTradesMap[indicatorName] = trades;
        } else {
            delete canvas.activeTradesMap[indicatorName];
        }
        draw();
    };
 
    // Eski updateTrades — geriye dönük uyumluluk
    canvas.updateTrades = (newTrades) => {
        draw();
    };
 
    syncSize();
    draw();
}

main()