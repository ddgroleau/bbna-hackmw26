"""
Adds Amazon Titan Text Embeddings V2 vectors (via Bedrock) to the weather-history database.

The backend uses these as a tie-breaker when ranking similar past days, if it has a Bedrock key;
without vectors (or without a key) it ranks on the matching rules alone.

Credentials: a Bedrock API key in AWS_BEARER_TOKEN_BEDROCK, taken from the environment or from the
git-ignored bbna-hackmw26.client/src/api/.env (the same file the AI agent uses). The key is never printed.
Region: AWS_REGION, default us-east-1.

Only cards without a vector (or whose text changed since) are embedded, so re-runs are cheap.
Usage (from the repo root, after build_cards.py):
    python -I tools/weather-history/embed_cards.py
"""
import json, os, sqlite3, struct, sys, time, urllib.error, urllib.request
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO = TOOL_DIR.parent.parent
DB_PATH = REPO / "bbna-hackmw26.Server" / "WeatherHistory" / "kc-weather-history.db"
ENV_FILE = REPO / "bbna-hackmw26.client" / "src" / "api" / ".env"

MODEL = "amazon.titan-embed-text-v2:0"   # keep in step with Bedrock:EmbeddingModel in appsettings.json
DIMENSIONS = 1024


def load_key():
    """The Bedrock API key from the environment, else from the agent's .env file."""
    if os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
        return os.environ["AWS_BEARER_TOKEN_BEDROCK"]
    if ENV_FILE.exists():
        # utf-8-sig: Notepad may save the file with an invisible byte-order mark at the start.
        for line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
            if line.strip().startswith("AWS_BEARER_TOKEN_BEDROCK="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"No Bedrock API key: set AWS_BEARER_TOKEN_BEDROCK or add it to {ENV_FILE}")


def embed(text, key, region):
    """One Titan V2 call. Returns DIMENSIONS floats of unit length (normalize=true), so dot product = cosine."""
    url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{MODEL}/invoke"
    body = json.dumps({"inputText": text, "dimensions": DIMENSIONS, "normalize": True}).encode()
    for attempt in range(5):
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())["embedding"]
        except urllib.error.HTTPError as e:
            # Throttling (429) and server errors (5xx) are temporary: back off and retry. Anything else is fatal.
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(2 ** attempt); continue
            sys.exit(f"Bedrock returned HTTP {e.code}: {e.read().decode(errors='replace')[:300]}")


def main():
    key, region = load_key(), os.environ.get("AWS_REGION", "us-east-1")
    db = sqlite3.connect(DB_PATH)
    todo = db.execute("SELECT id, text FROM event_cards WHERE embedding IS NULL OR embedding_model IS NOT ?", (MODEL,)).fetchall()
    print(f"{len(todo)} cards to embed with {MODEL} ({DIMENSIONS} dims, {region})")
    started = time.time()
    for i, (card_id, text) in enumerate(todo, 1):
        vector = embed(text, key, region)
        db.execute("UPDATE event_cards SET embedding = ?, embedding_model = ? WHERE id = ?",
                   (struct.pack(f"<{len(vector)}f", *vector), MODEL, card_id))   # little-endian float32, 4 KB per card
        if i % 25 == 0 or i == len(todo):
            db.commit(); print(f"  {i}/{len(todo)} ({time.time() - started:.0f}s)")
    db.execute("INSERT OR REPLACE INTO build_info VALUES ('embedding_model', ?)", (MODEL,))
    db.commit()
    db.execute("VACUUM")
    n, embedded = db.execute("SELECT COUNT(*), COUNT(embedding) FROM event_cards").fetchone()
    print(f"done: {embedded}/{n} cards have embeddings")


if __name__ == "__main__":
    main()
