import argparse
import json
import logging


def main():
    ap = argparse.ArgumentParser(prog="smp")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    sc = sub.add_parser("scrape")
    sc.add_argument("--chains", nargs="*")
    sc.add_argument("--limit", type=int)
    sc.add_argument("--list", action="store_true")
    ig = sub.add_parser("ingest")
    ig.add_argument("--path")
    q = sub.add_parser("quality")
    q.add_argument("--no-save", action="store_true")
    ap_ = sub.add_parser("api")
    ap_.add_argument("--port", type=int, default=8000)
    m = sub.add_parser("mcp")
    m.add_argument("--http", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)

    from .config import settings
    from .db import get_engine, session_scope

    if a.cmd == "init-db":
        from .models import init_db
        init_db(get_engine())
        print("schema created")
    elif a.cmd == "scrape":
        from .ingest import scrape
        if a.list:
            print("\n".join(scrape.list_chains()))
        else:
            scrape.run_scrape(settings.dumps_dir, a.chains, a.limit)
    elif a.cmd == "ingest":
        from .ingest.loader import ingest_path
        with session_scope() as s:
            print(ingest_path(s, a.path or settings.dumps_dir))
    elif a.cmd == "quality":
        from .quality import run_quality
        with session_scope() as s:
            print(json.dumps(run_quality(s, persist=not a.no_save), ensure_ascii=False, indent=2, default=str))
    elif a.cmd == "api":
        import uvicorn
        uvicorn.run("smp.api.main:app", host="0.0.0.0", port=a.port)
    elif a.cmd == "mcp":
        from .mcp_server import run
        run(http=a.http)


if __name__ == "__main__":
    main()
