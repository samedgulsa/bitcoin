import asyncio
import websockets
import json

CLIENTS = set()

async def binance_stream():
    url = "wss://stream.binance.com:443/stream?streams=btcusdt@aggTrade"
    while True:
        try:
            async with websockets.connect(url) as ws:
                print("✅ Binance'e bağlandı, veri akışı başladı...")
                async for message in ws:
                    raw = json.loads(message)
                    if 'data' in raw:
                        trade = raw['data']
                        data = {
                            "price": trade["p"],
                            "qty":   trade["q"],
                            "side":  "BUY" if trade["m"] == False else "SELL",
                            "time":  trade["T"]
                        }
                        if CLIENTS:
                            msg = json.dumps(data)
                            await asyncio.gather(*[c.send(msg) for c in CLIENTS], return_exceptions=True)
        except Exception as e:
            print(f"⚠️  Binance bağlantı hatası: {e} — 3sn sonra yeniden denenecek...")
            await asyncio.sleep(3)

async def handler(websocket):
    CLIENTS.add(websocket)
    print(f"🔌 Tarayıcı bağlandı. Aktif: {len(CLIENTS)}")
    try:
        await websocket.wait_closed()
    finally:
        CLIENTS.discard(websocket)
        print(f"🔌 Tarayıcı ayrıldı. Aktif: {len(CLIENTS)}")

async def main():
    print("🚀 Sunucu başlatılıyor: ws://localhost:8765")
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await binance_stream()

if __name__ == "__main__":
    asyncio.run(main())