const tickerBody = document.getElementById("ticker-body");
const statusDiv = document.getElementById("status");
const bannerPriceEl = document.getElementById("banner-price");
const bitcoinLiveEl = document.getElementById("bitcoin-live");
const bannerChangeEl = document.getElementById("banner-change");
const bannerHighEl = document.getElementById("banner-high");
const bannerLowEl = document.getElementById("banner-low");
const bannerVolumeEl = document.getElementById("banner-volume");
const indMaEl = document.getElementById("ind-ma");
const indSmaEl = document.getElementById("ind-sma");
const indEmaEl = document.getElementById("ind-ema");
const indKEl = document.getElementById("ind-k");
const indDEl = document.getElementById("ind-d");
const indJEl = document.getElementById("ind-j");
const indRsiEl = document.getElementById("ind-rsi");
const indBbUpEl = document.getElementById("ind-bb-up");
const indBbMidEl = document.getElementById("ind-bb-mid");
const indBbLowEl = document.getElementById("ind-bb-low");
const indMacdEl = document.getElementById("ind-macd");
const indMacdSignalEl = document.getElementById("ind-macd-signal");
const indMacdHistEl = document.getElementById("ind-macd-hist");
const signalBuyBox = document.getElementById("signal-buy");
const signalSellBox = document.getElementById("signal-sell");
const signalReasonEl = document.getElementById("signal-reason");
const aiChatLogEl = document.getElementById("ai-chat-log");
const aiChatFormEl = document.getElementById("ai-chat-form");
const aiChatInputEl = document.getElementById("ai-chat-input");
const loginOpenEl = document.getElementById("login-open");
const loginModalEl = document.getElementById("login-modal");
const loginCloseEl = document.getElementById("login-close");
const loginFormEl = document.getElementById("login-form");
const newsRefreshEl = document.getElementById("news-refresh");

const miniTickerSocket = new WebSocket("wss://stream.binance.com:9443/stream?streams=!miniTicker@arr@3000ms");
const klineApiUrl = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=240";

const lastPrices = {};
const analysisState = {
    updatedAt: null,
    price: NaN,
    ma10: NaN,
    sma20: NaN,
    ema20: NaN,
    rsi14: NaN,
    k: NaN,
    d: NaN,
    j: NaN,
    bbUp: NaN,
    bbMid: NaN,
    bbLow: NaN,
    macd: NaN,
    macdSignal: NaN,
    macdHist: NaN,
    stance: "BEKLE",
    score: 0,
    reason: "Sinyal olusuyor...",
};

function formatPrice(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return "-";
    }
    return num < 1 ? num.toFixed(6) : num.toFixed(2);
}

function formatVolume(value) {
    const num = Math.floor(Number(value));
    if (!Number.isFinite(num)) {
        return "-";
    }
    return num.toLocaleString("tr-TR");
}

function formatBigNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return "-";
    }
    return num.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatMoneyTR(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return "-";
    }
    return num.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function average(values) {
    if (!values.length) {
        return NaN;
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
}

function stdDev(values, mean) {
    if (!values.length) {
        return NaN;
    }
    const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

function calcSMA(closes, period) {
    if (closes.length < period) {
        return NaN;
    }
    return average(closes.slice(-period));
}

function calcEMA(closes, period) {
    if (closes.length < period) {
        return NaN;
    }
    const k = 2 / (period + 1);
    let ema = average(closes.slice(0, period));
    for (let i = period; i < closes.length; i += 1) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) {
        return NaN;
    }

    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= period; i += 1) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
            gainSum += diff;
        } else {
            lossSum += Math.abs(diff);
        }
    }

    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;

    for (let i = period + 1; i < closes.length; i += 1) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
        return 100;
    }

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

function calcKDJ(highs, lows, closes, period = 9) {
    if (closes.length < period) {
        return { K: NaN, D: NaN, J: NaN };
    }

    let K = 50;
    let D = 50;

    for (let i = period - 1; i < closes.length; i += 1) {
        const highPeriod = Math.max(...highs.slice(i - period + 1, i + 1));
        const lowPeriod = Math.min(...lows.slice(i - period + 1, i + 1));
        const denom = highPeriod - lowPeriod;
        const rsv = denom === 0 ? 50 : ((closes[i] - lowPeriod) / denom) * 100;

        K = (2 / 3) * K + (1 / 3) * rsv;
        D = (2 / 3) * D + (1 / 3) * K;
    }

    const J = 3 * K - 2 * D;
    return { K, D, J };
}

function calcBollinger(closes, period = 20, multiplier = 2) {
    if (closes.length < period) {
        return { upper: NaN, middle: NaN, lower: NaN };
    }
    const window = closes.slice(-period);
    const middle = average(window);
    const sigma = stdDev(window, middle);
    return {
        upper: middle + multiplier * sigma,
        middle,
        lower: middle - multiplier * sigma,
    };
}

function calcMACD(closes, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
    if (closes.length < longPeriod + signalPeriod) {
        return { macd: NaN, signal: NaN, histogram: NaN };
    }

    const shortK = 2 / (shortPeriod + 1);
    const longK = 2 / (longPeriod + 1);
    let shortEma = average(closes.slice(0, shortPeriod));
    let longEma = average(closes.slice(0, longPeriod));
    const macdSeries = [];

    for (let i = 0; i < closes.length; i += 1) {
        if (i >= shortPeriod) {
            shortEma = closes[i] * shortK + shortEma * (1 - shortK);
        }
        if (i >= longPeriod) {
            longEma = closes[i] * longK + longEma * (1 - longK);
            macdSeries.push(shortEma - longEma);
        }
    }

    const signalK = 2 / (signalPeriod + 1);
    let signal = average(macdSeries.slice(0, signalPeriod));
    for (let i = signalPeriod; i < macdSeries.length; i += 1) {
        signal = macdSeries[i] * signalK + signal * (1 - signalK);
    }

    const macd = macdSeries[macdSeries.length - 1];
    const histogram = macd - signal;
    return { macd, signal, histogram };
}

function setIndicatorValue(element, value, digits = 2) {
    if (!element) {
        return;
    }
    if (!Number.isFinite(value)) {
        element.textContent = "-";
        element.className = "kv-value";
        return;
    }
    element.textContent = Number(value).toFixed(digits);
    element.className = `kv-value ${value >= 0 ? "price-up" : "price-down"}`;
}

function evaluateTradeSignal(snapshot) {
    let score = 0;
    const notes = [];

    if (snapshot.price > snapshot.ema20) {
        score += 1;
        notes.push("Fiyat EMA20 ustunde");
    } else {
        score -= 1;
        notes.push("Fiyat EMA20 altinda");
    }

    if (snapshot.macdHist > 0) {
        score += 1;
        notes.push("MACD histogram pozitif");
    } else {
        score -= 1;
        notes.push("MACD histogram negatif");
    }

    if (snapshot.rsi14 < 35) {
        score += 1;
        notes.push("RSI dusuk bolgede");
    } else if (snapshot.rsi14 > 65) {
        score -= 1;
        notes.push("RSI yuksek bolgede");
    }

    if (snapshot.k > snapshot.d) {
        score += 1;
        notes.push("KDJ yukari kesisim");
    } else {
        score -= 1;
        notes.push("KDJ asagi baski");
    }

    if (snapshot.price < snapshot.bbLow) {
        score += 1;
        notes.push("Fiyat alt Bollinger altina sarkmis");
    } else if (snapshot.price > snapshot.bbUp) {
        score -= 1;
        notes.push("Fiyat ust Bollinger ustunde");
    }

    let stance = "BEKLE";
    if (score >= 2) {
        stance = "AL";
    } else if (score <= -2) {
        stance = "SAT";
    }

    return {
        stance,
        score,
        reason: notes.slice(0, 3).join(" | "),
    };
}

function updateSignalPanel() {
    if (!signalBuyBox || !signalSellBox) {
        return;
    }

    signalBuyBox.classList.remove("active-buy");
    signalSellBox.classList.remove("active-sell");

    if (analysisState.stance === "AL") {
        signalBuyBox.classList.add("active-buy");
    }
    if (analysisState.stance === "SAT") {
        signalSellBox.classList.add("active-sell");
    }

    const stamp = analysisState.updatedAt ? analysisState.updatedAt.toLocaleTimeString("tr-TR") : "-";
    if (signalReasonEl) {
        signalReasonEl.textContent = `${analysisState.reason} | Skor: ${analysisState.score} | ${stamp}`;
    }
}

function addChatMessage(role, text) {
    if (!aiChatLogEl) {
        return;
    }
    const div = document.createElement("div");
    div.className = `chat-msg ${role}`;
    div.textContent = text;
    aiChatLogEl.appendChild(div);
    aiChatLogEl.scrollTop = aiChatLogEl.scrollHeight;
}

function formatStateSummary() {
    return `Fiyat ${formatPrice(analysisState.price)}, RSI ${Number.isFinite(analysisState.rsi14) ? analysisState.rsi14.toFixed(2) : "-"}, MACD hist ${Number.isFinite(analysisState.macdHist) ? analysisState.macdHist.toFixed(4) : "-"}.`;
}

function getTrendText() {
    if (!Number.isFinite(analysisState.price) || !Number.isFinite(analysisState.ema20) || !Number.isFinite(analysisState.sma20)) {
        return "Trend net degil";
    }
    if (analysisState.price > analysisState.ema20 && analysisState.ema20 >= analysisState.sma20) {
        return "Trend yukari";
    }
    if (analysisState.price < analysisState.ema20 && analysisState.ema20 <= analysisState.sma20) {
        return "Trend asagi";
    }
    return "Trend kararsiz";
}

function getMomentumText() {
    if (!Number.isFinite(analysisState.rsi14) || !Number.isFinite(analysisState.macdHist)) {
        return "Momentum okunamadi";
    }
    if (analysisState.rsi14 > 55 && analysisState.macdHist > 0) {
        return "Alim momentumu canli";
    }
    if (analysisState.rsi14 < 45 && analysisState.macdHist < 0) {
        return "Satis momentumu baskin";
    }
    return "Momentum dengede";
}

function getBandText() {
    if (!Number.isFinite(analysisState.price) || !Number.isFinite(analysisState.bbUp) || !Number.isFinite(analysisState.bbLow)) {
        return "Band verisi yetersiz";
    }
    if (analysisState.price >= analysisState.bbUp) {
        return "Fiyat ust banda yakin, geri cekilme riski var";
    }
    if (analysisState.price <= analysisState.bbLow) {
        return "Fiyat alt banda yakin, tepki alimi gelebilir";
    }
    return "Fiyat band ortasinda, normal dalga";
}

function getGraphThought() {
    return `${getTrendText()}. ${getMomentumText()}. ${getBandText()}.`;
}

function buildAiReply(message) {
    const lower = message.toLowerCase();
    const thought = getGraphThought();

    if (lower.includes("al") || lower.includes("sat") || lower.includes("sinyal")) {
        if (analysisState.stance === "AL") {
            return `Kisa cevap: AL tarafi agir. ${thought}`;
        }
        if (analysisState.stance === "SAT") {
            return `Kisa cevap: SAT tarafi agir. ${thought}`;
        }
        return `Kisa cevap: Net yon yok. ${thought}`;
    }

    if (lower.includes("rsi")) {
        return `RSI14: ${Number.isFinite(analysisState.rsi14) ? analysisState.rsi14.toFixed(2) : "-"}. 30 alti zayif, 70 ustu asiri guclu.`;
    }

    if (lower.includes("macd")) {
        return `MACD: ${Number.isFinite(analysisState.macd) ? analysisState.macd.toFixed(4) : "-"}, Signal: ${Number.isFinite(analysisState.macdSignal) ? analysisState.macdSignal.toFixed(4) : "-"}.`;
    }

    if (lower.includes("kdj") || lower.includes("k") || lower.includes("d") || lower.includes("j")) {
        return `KDJ degerleri K:${Number.isFinite(analysisState.k) ? analysisState.k.toFixed(2) : "-"} D:${Number.isFinite(analysisState.d) ? analysisState.d.toFixed(2) : "-"} J:${Number.isFinite(analysisState.j) ? analysisState.j.toFixed(2) : "-"}.`;
    }

    if (lower.includes("bollinger") || lower.includes("band")) {
        return `Bollinger ust:${Number.isFinite(analysisState.bbUp) ? analysisState.bbUp.toFixed(2) : "-"} orta:${Number.isFinite(analysisState.bbMid) ? analysisState.bbMid.toFixed(2) : "-"} alt:${Number.isFinite(analysisState.bbLow) ? analysisState.bbLow.toFixed(2) : "-"}.`;
    }

    return `Kisa ozet: ${analysisState.stance}. ${thought}`;
}

function buildSignalClickReply(type) {
    const thought = getGraphThought();
    const stance = analysisState.stance;

    if (type === "buy") {
        if (stance === "AL") {
            return `AL fikri su an daha mantikli. ${thought}`;
        }
        if (stance === "SAT") {
            return `AL icin acele etme. ${thought}`;
        }
        return `AL icin net onay yok. ${thought}`;
    }

    if (stance === "SAT") {
        return `SAT fikri su an daha mantikli. ${thought}`;
    }
    if (stance === "AL") {
        return `SAT icin erken olabilir. ${thought}`;
    }
    return `SAT icin net onay yok. ${thought}`;
}

function setupSignalClicks() {
    if (signalBuyBox) {
        signalBuyBox.addEventListener("click", () => {
            addChatMessage("user", "Al kutusuna tikladim, kisa yorum ver.");
            addChatMessage("bot", buildSignalClickReply("buy"));
        });
    }

    if (signalSellBox) {
        signalSellBox.addEventListener("click", () => {
            addChatMessage("user", "Sat kutusuna tikladim, kisa yorum ver.");
            addChatMessage("bot", buildSignalClickReply("sell"));
        });
    }
}

function setupLoginModal() {
    if (!loginOpenEl || !loginModalEl || !loginCloseEl || !loginFormEl) {
        return;
    }

    loginOpenEl.addEventListener("click", () => {
        loginModalEl.classList.add("show");
    });

    loginCloseEl.addEventListener("click", () => {
        loginModalEl.classList.remove("show");
    });

    loginModalEl.addEventListener("click", (event) => {
        if (event.target === loginModalEl) {
            loginModalEl.classList.remove("show");
        }
    });

    loginFormEl.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!loginFormEl.checkValidity()) {
            loginFormEl.reportValidity();
            return;
        }
        loginModalEl.classList.remove("show");
        loginFormEl.reset();
        addChatMessage("bot", "Giris talebiniz alindi.");
    });
}

function refreshNewsOnly() {
    const statusElements = document.querySelectorAll("[data-news-status]");
    const timeElements = document.querySelectorAll("[data-news-time]");
    const newsCards = document.querySelectorAll(".news-card");
    const stamp = new Date().toLocaleTimeString("tr-TR");

    statusElements.forEach((el) => {
        el.textContent = "Veri Alinamadi";
    });

    timeElements.forEach((el) => {
        el.textContent = `Son deneme: ${stamp}`;
    });

    newsCards.forEach((card) => {
        card.classList.remove("flash");
        void card.offsetWidth;
        card.classList.add("flash");
    });
}

function setupNewsRefresh() {
    if (!newsRefreshEl) {
        return;
    }

    newsRefreshEl.addEventListener("click", () => {
        refreshNewsOnly();
    });

    refreshNewsOnly();
}

function setupChat() {
    if (!aiChatFormEl || !aiChatInputEl) {
        return;
    }

    addChatMessage("bot", "Merhaba, teknik gorunume gore yorum yapabilirim. Ornek: simdi alinir mi?");

    aiChatFormEl.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = aiChatInputEl.value.trim();
        if (!text) {
            return;
        }

        addChatMessage("user", text);
        const reply = buildAiReply(text);
        addChatMessage("bot", reply);
        aiChatInputEl.value = "";
    });
}

async function refreshIndicators() {
    try {
        const response = await fetch(klineApiUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("Kline request failed");
        }

        const rows = await response.json();
        const closes = rows.map((row) => Number(row[4]));
        const highs = rows.map((row) => Number(row[2]));
        const lows = rows.map((row) => Number(row[3]));

        const ma10 = calcSMA(closes, 10);
        const sma20 = calcSMA(closes, 20);
        const ema20 = calcEMA(closes, 20);
        const rsi14 = calcRSI(closes, 14);
        const kdj = calcKDJ(highs, lows, closes, 9);
        const bb = calcBollinger(closes, 20, 2);
        const macd = calcMACD(closes, 12, 26, 9);

        setIndicatorValue(indMaEl, ma10, 2);
        setIndicatorValue(indSmaEl, sma20, 2);
        setIndicatorValue(indEmaEl, ema20, 2);

        setIndicatorValue(indKEl, kdj.K, 2);
        setIndicatorValue(indDEl, kdj.D, 2);
        setIndicatorValue(indJEl, kdj.J, 2);

        setIndicatorValue(indRsiEl, rsi14, 2);

        setIndicatorValue(indBbUpEl, bb.upper, 2);
        setIndicatorValue(indBbMidEl, bb.middle, 2);
        setIndicatorValue(indBbLowEl, bb.lower, 2);

        setIndicatorValue(indMacdEl, macd.macd, 4);
        setIndicatorValue(indMacdSignalEl, macd.signal, 4);
        setIndicatorValue(indMacdHistEl, macd.histogram, 4);

        analysisState.updatedAt = new Date();
        analysisState.price = closes[closes.length - 1];
        analysisState.ma10 = ma10;
        analysisState.sma20 = sma20;
        analysisState.ema20 = ema20;
        analysisState.rsi14 = rsi14;
        analysisState.k = kdj.K;
        analysisState.d = kdj.D;
        analysisState.j = kdj.J;
        analysisState.bbUp = bb.upper;
        analysisState.bbMid = bb.middle;
        analysisState.bbLow = bb.lower;
        analysisState.macd = macd.macd;
        analysisState.macdSignal = macd.signal;
        analysisState.macdHist = macd.histogram;

        const result = evaluateTradeSignal(analysisState);
        analysisState.stance = result.stance;
        analysisState.score = result.score;
        analysisState.reason = result.reason;
        updateSignalPanel();
    } catch (error) {
        statusDiv.textContent = "Indikator verisi alinamadi";
        statusDiv.classList.remove("connected");
        statusDiv.classList.add("error");
    }
}

function updateMarketBanner(btcTicker, allTickers) {
    if (!btcTicker) {
        return;
    }

    const close = Number(btcTicker.c);
    const open = Number(btcTicker.o);
    const diff = close - open;
    const pct = open ? (diff / open) * 100 : 0;
    const chgText = `${diff >= 0 ? "+" : ""}${formatPrice(diff)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;

    bannerPriceEl.textContent = formatPrice(btcTicker.c);
    if (bitcoinLiveEl) {
        const btcUsd = Number(btcTicker.c);
        const usdtTryTicker = allTickers.find((item) => item.s === "USDTTRY" || item.s === "USDTRY");
        const btcTryTicker = allTickers.find((item) => item.s === "BTCTRY");

        let btcTl = NaN;
        if (usdtTryTicker) {
            btcTl = btcUsd * Number(usdtTryTicker.c);
        } else if (btcTryTicker) {
            btcTl = Number(btcTryTicker.c);
        }

        const usdText = `${formatMoneyTR(btcUsd)} USD`;
        const tlText = Number.isFinite(btcTl) ? `${formatMoneyTR(btcTl)} TL` : "TL verisi yok";
        bitcoinLiveEl.textContent = `${usdText} | ${tlText}`;
    }
    bannerChangeEl.textContent = chgText;
    bannerChangeEl.className = `metric-value ${diff >= 0 ? "price-up" : "price-down"}`;
    bannerHighEl.textContent = formatPrice(btcTicker.h);
    bannerLowEl.textContent = formatPrice(btcTicker.l);
    bannerVolumeEl.textContent = formatBigNumber(btcTicker.q);
}

function updateTable(data) {
    const usdtData = data.filter((item) => item.s.endsWith("USDT"));
    usdtData.sort((a, b) => Number(b.q) - Number(a.q));

    const btcTicker = usdtData.find((item) => item.s === "BTCUSDT");
    updateMarketBanner(btcTicker, data);

    tickerBody.innerHTML = "";
    usdtData.forEach((coin) => {
        const row = document.createElement("tr");
        const currentPrice = Number(coin.c);
        const prevPrice = lastPrices[coin.s];

        let priceClass = "";
        if (Number.isFinite(prevPrice)) {
            if (currentPrice > prevPrice) {
                priceClass = "price-up";
            } else if (currentPrice < prevPrice) {
                priceClass = "price-down";
            }
        }
        lastPrices[coin.s] = currentPrice;

        row.innerHTML = `
            <td class="${coin.s === "BTCUSDT" ? "symbol-btc" : ""}">${coin.s}</td>
            <td class="${priceClass}">${formatPrice(coin.c)}</td>
            <td>${formatPrice(coin.h)}</td>
            <td>${formatPrice(coin.l)}</td>
            <td>${formatVolume(coin.q)}</td>
        `;
        tickerBody.appendChild(row);
    });
}

miniTickerSocket.onopen = () => {
    statusDiv.textContent = "Canli baglanti aktif";
    statusDiv.classList.add("connected");
    statusDiv.classList.remove("error");
    refreshIndicators();
};

miniTickerSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.stream === "!miniTicker@arr@3000ms") {
        updateTable(message.data);
    }
};

miniTickerSocket.onerror = () => {
    statusDiv.textContent = "Baglanti hatasi";
    statusDiv.classList.remove("connected");
    statusDiv.classList.add("error");
};

refreshIndicators();
setInterval(refreshIndicators, 15000);
setupChat();
setupSignalClicks();
setupLoginModal();
setupNewsRefresh();
