from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import websockets
import json
import sqlite3
from datetime import datetime
import uvicorn
import requests


# ═══════════════════════════════════════════════════════════════
#  LIFESPAN & APP
# ═══════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    init_db()
    asyncio.create_task(binance_composite_stream())
    await asyncio.sleep(2)
    await asyncio.to_thread(fetch_rest_all)
    for iv in INTERVALS:
        sync_buffer(iv)
    log("Startup tamam. 4 market tablosu + 2 bot tablosu aktif.")
    yield
    log("Shutdown")


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ─── CONFIG ───
INTERVALS = ['1m', '5m', '15m', '1h']
DB_PATH = "btc_market.db"

# ─── STATE ───
RAM = {iv: {} for iv in INTERVALS}
WS_RAW = {iv: {} for iv in INTERVALS}
REST_LAST_CLOSE = {iv: 0 for iv in INTERVALS}
SYNCED = {iv: False for iv in INTERVALS}
CLIENTS = set()
MAIN_LOOP = None


# ─── LOG ───
def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


# ═══════════════════════════════════════════════════════════════
#  INDICATORS (Series + Scalar)
# ═══════════════════════════════════════════════════════════════

def get_ema(prices, period):
    if len(prices) < period:
        return [None] * len(prices)
    k = 2 / (period + 1)
    ema = [None] * (period - 1)
    sma = sum(prices[:period]) / period
    ema.append(sma)
    for i in range(period, len(prices)):
        ema.append(prices[i] * k + ema[-1] * (1 - k))
    return ema


def get_rsi_series(closes, period=14):
    n = len(closes)
    if n < period + 1:
        return [None] * n
    gains = [0.0]
    losses = [0.0]
    for i in range(1, n):
        diff = closes[i] - closes[i - 1]
        gains.append(max(0.0, diff))
        losses.append(max(0.0, -diff))
    avg_g = sum(gains[1:period + 1]) / period
    avg_l = sum(losses[1:period + 1]) / period
    rsi = [None] * period
    for i in range(period, n):
        rsi.append(100.0 - (100.0 / (1.0 + avg_g / (avg_l or 1e-5))))
        if i + 1 < n:
            avg_g = (avg_g * (period - 1) + gains[i + 1]) / period
            avg_l = (avg_l * (period - 1) + losses[i + 1]) / period
    return rsi


def get_macd_series(closes):
    ema12 = get_ema(closes, 12)
    ema26 = get_ema(closes, 26)
    macd_line = []
    for i in range(len(closes)):
        if ema12[i] is None or ema26[i] is None:
            macd_line.append(None)
        else:
            macd_line.append(ema12[i] - ema26[i])
    valid_macd = [x for x in macd_line if x is not None]
    signal_calc = get_ema(valid_macd, 9)
    signal_line = [None] * (len(macd_line) - len(signal_calc)) + signal_calc
    hist = []
    for i in range(len(closes)):
        if macd_line[i] is None or signal_line[i] is None:
            hist.append(None)
        else:
            hist.append(macd_line[i] - signal_line[i])
    return macd_line, signal_line, hist


def get_kdj_series(candles, period=9):
    n = len(candles)
    k_vals = [50.0] * n
    d_vals = [50.0] * n
    j_vals = [50.0] * n
    K = 50.0
    D = 50.0
    for i in range(n):
        if i < period - 1:
            continue
        last_n = candles[i - (period - 1):i + 1]
        hh = max(c['h'] for c in last_n)
        ll = min(c['l'] for c in last_n)
        c = candles[i]['c']
        if hh == ll:
            rsv = 50.0
        else:
            rsv = ((c - ll) / (hh - ll)) * 100
        K = (2 / 3) * K + (1 / 3) * rsv
        D = (2 / 3) * D + (1 / 3) * K
        J = 3 * K - 2 * D
        k_vals[i] = K
        d_vals[i] = D
        j_vals[i] = J
    return k_vals, d_vals, j_vals


def get_bb_series(closes, period=20, mult=2):
    n = len(closes)
    upper = [None] * n
    mid = [None] * n
    lower = [None] * n
    for i in range(period - 1, n):
        slice_ = closes[i - period + 1:i + 1]
        sma = sum(slice_) / period
        variance = sum((x - sma) ** 2 for x in slice_) / period
        std = variance ** 0.5
        upper[i] = sma + mult * std
        mid[i] = sma
        lower[i] = sma - mult * std
    return upper, mid, lower


def get_rsi(closes, period=14):
    s = get_rsi_series(closes, period)
    return s[-1] if s else None


def get_macd(closes):
    ml, sl, hl = get_macd_series(closes)
    return (ml[-1] if ml else None, sl[-1] if sl else None, hl[-1] if hl else None)


def get_kdj(candles, period=9):
    k, d, j = get_kdj_series(candles, period)
    return (k[-1] if k else None, d[-1] if d else None, j[-1] if j else None)


def get_bb(closes, period=20, mult=2):
    u, m, l = get_bb_series(closes, period, mult)
    return (u[-1] if u else None, m[-1] if m else None, l[-1] if l else None)


# ═══════════════════════════════════════════════════════════════
#  DATABASE
# ═══════════════════════════════════════════════════════════════

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    for iv in INTERVALS:
        c.execute(f'''
            CREATE TABLE IF NOT EXISTS market_{iv} (
                timestamp INTEGER,
                close_price REAL,
                rsi REAL,
                kdj_k REAL,
                kdj_d REAL,
                kdj_j REAL,
                macd_line REAL,
                macd_signal REAL,
                macd_hist REAL,
                bb_upper REAL,
                bb_mid REAL,
                bb_lower REAL
            )
        ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS user_strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            balance REAL,
            timeframe TEXT,
            indicators TEXT,
            leverage INTEGER,
            in_position INTEGER DEFAULT 0,
            entry_price REAL DEFAULT 0.0
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS strategy_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER,
            timestamp INTEGER,
            log_type TEXT,
            price REAL,
            current_balance REAL,
            message TEXT
        )
    ''')

    conn.commit()
    conn.close()
    log("DB init tamam (6 tablo)")


def update_market_db(iv, indicators):
    if indicators is None:
        return
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        c.execute(f"DELETE FROM market_{iv}")
        c.execute(f'''
            INSERT INTO market_{iv}
            (timestamp, close_price, rsi, kdj_k, kdj_d, kdj_j,
             macd_line, macd_signal, macd_hist, bb_upper, bb_mid, bb_lower)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            indicators['timestamp'],
            indicators['close_price'],
            indicators['rsi'],
            indicators['kdj_k'],
            indicators['kdj_d'],
            indicators['kdj_j'],
            indicators['macd_line'],
            indicators['macd_signal'],
            indicators['macd_hist'],
            indicators['bb_upper'],
            indicators['bb_mid'],
            indicators['bb_lower']
        ))
        conn.commit()
    except Exception as e:
        log(f"DB update hata [{iv}]: {e}")
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════
#  SİNYAL MOTORU
# ═══════════════════════════════════════════════════════════════

def get_indicator_signals(iv):
    candles = sorted(RAM[iv].values(), key=lambda x: x['t'])
    n = len(candles)
    if n < 26:
        return {}

    closes = [c['c'] for c in candles]
    i = n - 1
    prev = n - 2

    rsi_s = get_rsi_series(closes, 14)
    macd_line, signal_line, _ = get_macd_series(closes)
    k_vals, d_vals, j_vals = get_kdj_series(candles, 9)
    bb_upper, bb_mid, bb_lower = get_bb_series(closes, 20, 2)

    signals = {}

    if rsi_s[i] is not None:
        if rsi_s[i] < 30:
            signals['RSI'] = 'buy'
        elif rsi_s[i] > 70:
            signals['RSI'] = 'sell'

    if all(v is not None for v in [macd_line[i], signal_line[i], macd_line[prev], signal_line[prev]]):
        if macd_line[prev] < signal_line[prev] and macd_line[i] > signal_line[i] and macd_line[i] < 0:
            signals['MACD (Güçlü)'] = 'buy'
        elif macd_line[prev] > signal_line[prev] and macd_line[i] < signal_line[i] and macd_line[i] > 0:
            signals['MACD (Güçlü)'] = 'sell'

    if all(v is not None for v in [macd_line[i], signal_line[i], macd_line[prev], signal_line[prev]]):
        if macd_line[prev] < signal_line[prev] and macd_line[i] > signal_line[i] and macd_line[i] >= 0:
            signals['MACD (Zayıf)'] = 'buy'
        elif macd_line[prev] > signal_line[prev] and macd_line[i] < signal_line[i] and macd_line[i] <= 0:
            signals['MACD (Zayıf)'] = 'sell'

    if bb_lower[i] is not None and bb_upper[i] is not None:
        if closes[i] <= bb_lower[i]:
            signals['Bollinger Bands'] = 'buy'
        elif closes[i] >= bb_upper[i]:
            signals['Bollinger Bands'] = 'sell'

    if i > 0 and k_vals[i] is not None:
        was_below = j_vals[prev] < k_vals[prev] and j_vals[prev] < d_vals[prev]
        is_above = j_vals[i] > k_vals[i] and j_vals[i] > d_vals[i]
        was_above = j_vals[prev] > k_vals[prev] and j_vals[prev] > d_vals[prev]
        is_below = j_vals[i] < k_vals[i] and j_vals[i] < d_vals[i]

        if was_below and is_above and k_vals[i] < 30 and d_vals[i] < 30:
            signals['KDJ'] = 'buy'
        elif was_above and is_below and k_vals[i] > 70 and d_vals[i] > 70:
            signals['KDJ'] = 'sell'

    return signals


async def check_user_strategies(iv, current_close):
    def _process():
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        c.execute('''
            SELECT id, name, balance, indicators, leverage, in_position, entry_price
            FROM user_strategies WHERE timeframe=?
        ''', (iv,))

        strategies = c.fetchall()
        if not strategies:
            conn.close()
            return []

        signals = get_indicator_signals(iv)
        if not signals:
            conn.close()
            return []

        updates = []
        logs = []
        now_ts = int(datetime.now().timestamp() * 1000)
        time_str = datetime.now().strftime('%H:%M:%S')

        for row in strategies:
            sid, name, balance, ind_json, leverage, in_pos, entry_p = row
            selected = json.loads(ind_json) if ind_json else []

            if in_pos == 0:
                all_buy = len(selected) > 0
                for ind_name in selected:
                    if signals.get(ind_name) != 'buy':
                        all_buy = False
                        break

                if all_buy:
                    # DÜZELTME: Sütun eşleşme sırası -> in_position, entry_price, balance, id
                    updates.append((1, current_close, balance, sid))
                    logs.append((
                        sid, now_ts, 'BUY', current_close, balance,
                        f'[{time_str}] {leverage}x LONG Girildi | {balance:.2f} USDT @ {current_close:.2f}'
                    ))

            else:
                price_change = (current_close - entry_p) / entry_p
                net_lev = price_change * leverage

                if net_lev <= -1.0:
                    # DÜZELTME: Sütun eşleşme sırası -> in_position, entry_price, balance, id
                    updates.append((0, 0.0, 0.0, sid))
                    logs.append((
                        sid, now_ts, 'LIQUIDATED', current_close, 0.0,
                        f'[{time_str}] Likidasyon! Fiyat: {current_close:.2f}, Değişim: {price_change*100:.2f}%, Net: {net_lev*100:.2f}%'
                    ))
                    continue # Likit olan bot için alt taraftaki satış kontrolünü atla.

                any_sell = False
                for ind_name in selected:
                    if signals.get(ind_name) == 'sell':
                        any_sell = True
                        break

                if any_sell:
                    new_balance = balance * (1 + net_lev)
                    # DÜZELTME: Sütun eşleşme sırası -> in_position, entry_price, balance, id
                    updates.append((0, 0.0, new_balance, sid))
                    logs.append((
                        sid, now_ts, 'SELL', current_close, new_balance,
                        f'[{time_str}] LONG Kapatıldı. Fiyat: {current_close:.2f} | Kâr/Zarar: {net_lev*100:.2f}% | Yeni Bakiye: {new_balance:.2f} USDT'
                    ))

        for upd in updates:
            c.execute('UPDATE user_strategies SET in_position=?, entry_price=?, balance=? WHERE id=?', upd)

        for lg in logs:
            c.execute('''
                INSERT INTO strategy_logs (strategy_id, timestamp, log_type, price, current_balance, message)
                VALUES (?,?,?,?,?,?)
            ''', lg)

        conn.commit()
        conn.close()
        return logs

    logs = await asyncio.to_thread(_process)
    for lg in logs:
        log(f"  [BOT] {lg[5]}")


# ═══════════════════════════════════════════════════════════════
#  RAM & MARKET
# ═══════════════════════════════════════════════════════════════

def calculate_indicators(iv):
    candles = sorted(RAM[iv].values(), key=lambda x: x['t'])
    if len(candles) < 26:
        return None

    closes = [c['c'] for c in candles]

    rsi = get_rsi(closes, 14)
    macd_l, macd_s, macd_h = get_macd(closes)
    kdj_k, kdj_d, kdj_j = get_kdj(candles, 9)
    bb_u, bb_m, bb_l = get_bb(closes, 20, 2)

    last = candles[-1]
    return {
        'timestamp': last['t'],
        'close_price': last['c'],
        'rsi': rsi,
        'kdj_k': kdj_k,
        'kdj_d': kdj_d,
        'kdj_j': kdj_j,
        'macd_line': macd_l,
        'macd_signal': macd_s,
        'macd_hist': macd_h,
        'bb_upper': bb_u,
        'bb_mid': bb_m,
        'bb_lower': bb_l
    }


def add_closed_candle(iv, kline):
    candle = {
        't': kline['t'],
        'o': float(kline['o']),
        'h': float(kline['h']),
        'l': float(kline['l']),
        'c': float(kline['c']),
        'v': float(kline['v']),
        'T': kline['T'],
        'x': True
    }

    RAM[iv][candle['t']] = candle

    if len(RAM[iv]) > 1000:
        oldest_t = min(RAM[iv].keys())
        RAM[iv].pop(oldest_t)

    ind = calculate_indicators(iv)
    if ind:
        update_market_db(iv, ind)
        if MAIN_LOOP:
            asyncio.run_coroutine_threadsafe(check_user_strategies(iv, candle['c']), MAIN_LOOP)


def sync_buffer(iv):
    cutoff = REST_LAST_CLOSE[iv]
    dropped = 0
    for t, k in list(WS_RAW[iv].items()):
        if t <= cutoff:
            dropped += 1
        else:
            add_closed_candle(iv, k)
    WS_RAW[iv].clear()
    SYNCED[iv] = True
    log(f"[{iv}] Sync tamam. Atılan: {dropped}, RAM: {len(RAM[iv])}")


def fetch_rest_all():
    for iv in INTERVALS:
        url = f"https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval={iv}&limit=1000"
        try:
            r = requests.get(url, timeout=15)
            data = r.json()
            if not data or not isinstance(data, list):
                log(f"[{iv}] REST boş yanıt")
                continue
            for k in data:
                add_closed_candle(iv, {
                    't': k[0], 'o': float(k[1]), 'h': float(k[2]),
                    'l': float(k[3]), 'c': float(k[4]), 'v': float(k[5]),
                    'T': k[6], 'x': True
                })
            REST_LAST_CLOSE[iv] = data[-1][6]
            log(f"[{iv}] REST OK: {len(data)} mum")
        except Exception as e:
            log(f"[{iv}] REST HATA: {e}")


# ═══════════════════════════════════════════════════════════════
#  WEBSOCKET
# ═══════════════════════════════════════════════════════════════

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    CLIENTS.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        CLIENTS.discard(ws)


async def binance_composite_stream():
    streams = '/'.join([f"btcusdt@kline_{iv}" for iv in INTERVALS])
    uri = f"wss://stream.binance.com:443/stream?streams={streams}"
    while True:
        try:
            async with websockets.connect(uri) as bws:
                log("Composite WS bağlandı")
                async for raw in bws:
                    msg = json.loads(raw)
                    stream = msg.get('stream', '')
                    data = msg.get('data', {})
                    if not stream or data.get('e') != 'kline':
                        continue
                    iv = stream.split('@kline_')[-1]
                    if iv not in INTERVALS:
                        continue
                    k = data['k']
                    if not k.get('x'):
                        continue
                    if not SYNCED[iv]:
                        WS_RAW[iv][k['t']] = k
                        continue
                    add_closed_candle(iv, k)
        except Exception as e:
            log(f"WS hata: {e}")
            await asyncio.sleep(3)


# ═══════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.post("/api/strategies")
async def create_strategy(request: Request):
    body = await request.json()
    name = body.get('name', 'Bot')
    balance = float(body.get('balance', 0))
    timeframe = body.get('timeframe')
    indicators = body.get('indicators', [])
    leverage = int(body.get('leverage', 1))

    if timeframe not in INTERVALS:
        return {"error": f"Geçersiz timeframe. Izin verilenler: {INTERVALS}"}

    ind_json = json.dumps(indicators)

    def _insert():
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            INSERT INTO user_strategies (name, balance, timeframe, indicators, leverage, in_position, entry_price)
            VALUES (?, ?, ?, ?, ?, 0, 0.0)
        ''', (name, balance, timeframe, ind_json, leverage))
        conn.commit()
        sid = c.lastrowid
        conn.close()
        return sid

    sid = await asyncio.to_thread(_insert)
    return {
        "id": sid,
        "name": name,
        "balance": balance,
        "timeframe": timeframe,
        "indicators": indicators,
        "leverage": leverage,
        "in_position": 0,
        "entry_price": 0.0
    }


@app.get("/api/strategies")
async def list_strategies():
    def _fetch():
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            SELECT id, name, balance, timeframe, indicators, leverage, in_position, entry_price
            FROM user_strategies
        ''')
        rows = c.fetchall()
        conn.close()
        return rows

    rows = await asyncio.to_thread(_fetch)
    return {
        "strategies": [
            {
                "id": r[0],
                "name": r[1],
                "balance": r[2],
                "timeframe": r[3],
                "indicators": json.loads(r[4]) if r[4] else [],
                "leverage": r[5],
                "in_position": bool(r[6]),
                "entry_price": r[7]
            }
            for r in rows
        ]
    }


@app.get("/api/strategies/{strategy_id}/logs")
async def get_strategy_logs(strategy_id: int):
    def _fetch():
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            SELECT id, strategy_id, timestamp, log_type, price, current_balance, message
            FROM strategy_logs WHERE strategy_id=? ORDER BY id DESC
        ''', (strategy_id,))
        rows = c.fetchall()
        conn.close()
        return rows

    rows = await asyncio.to_thread(_fetch)
    return {
        "strategy_id": strategy_id,
        "logs": [
            {
                "id": r[0],
                "timestamp": r[2],
                "log_type": r[3],
                "price": r[4],
                "current_balance": r[5],
                "message": r[6]
            }
            for r in rows
        ]
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000) 