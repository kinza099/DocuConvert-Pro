"""
run.py — DocuConvert Pro development server launcher.

Usage:
    python run.py
    python run.py --port 8080
    python run.py --host 0.0.0.0 --port 5000 --no-debug
"""

import sys
import argparse
from pathlib import Path

# Ensure the project root is on sys.path so "backend.*" imports resolve
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def main():
    parser = argparse.ArgumentParser(description="Start DocuConvert Pro server")
    parser.add_argument("--host",    default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port",    default=5000, type=int, help="Port number (default: 5000)")
    parser.add_argument("--no-debug", action="store_true", help="Disable debug/auto-reload mode")
    args = parser.parse_args()

    debug = not args.no_debug

    try:
        from backend.app import app
    except ImportError as e:
        print(f"\n[ERROR] Could not import backend: {e}")
        print("\nMake sure dependencies are installed:")
        print("  pip install -r requirements.txt\n")
        sys.exit(1)

    print("=" * 60)
    print("  DocuConvert Pro")
    print("=" * 60)
    print(f"  URL  -> http://{args.host}:{args.port}/")
    print(f"  Mode -> {'Development (debug)' if debug else 'Production'}")
    print("  Press Ctrl+C to stop the server.")
    print("=" * 60)

    app.run(host=args.host, port=args.port, debug=debug)


if __name__ == "__main__":
    main()
