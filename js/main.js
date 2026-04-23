const tickerBody = document.getElementById("ticker-body");
const statusDiv = document.getElementById("status");
const bannerPriceEl = document.getElementById("banner-price");
const bannerChangeEl = document.getElementById("banner-change");
const bannerHighEl = document.getElementById("banner-high");
const bannerLowEl = document.getElementById("banner-low");
const bannerVolumeEl = document.getElementById("banner-volume");

const miniTickerSocket = new WebSocket("wss://stream.binance.com:9443/stream?streams=!miniTicker@arr@3000ms");

const lastPrices = {};

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

function updateMarketBanner(btcTicker) {
    if (!btcTicker) {
        return;
    }

    const close = Number(btcTicker.c);
    const open = Number(btcTicker.o);
    const diff = close - open;
    const pct = open ? (diff / open) * 100 : 0;
    const chgText = `${diff >= 0 ? "+" : ""}${formatPrice(diff)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;

    bannerPriceEl.textContent = formatPrice(btcTicker.c);
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
    updateMarketBanner(btcTicker);

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
