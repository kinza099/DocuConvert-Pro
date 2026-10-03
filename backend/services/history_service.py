import sqlite3
import datetime
from pathlib import Path
from backend.config import DATA_DIR
from backend.utils.file_helper import format_file_size

DB_PATH = DATA_DIR / "history.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            output_filename TEXT NOT NULL,
            output_filepath TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            status TEXT DEFAULT 'Completed',
            error_message TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

# Initialize immediately
init_db()

def add_history_entry(operation: str, original_filename: str, output_filename: str, output_filepath: str, file_size: int, status: str = "Completed", error_message: str = ""):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO history (operation, original_filename, output_filename, output_filepath, file_size, status, error_message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            operation,
            original_filename,
            output_filename,
            str(output_filepath),
            file_size,
            status,
            error_message,
            datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ))
        conn.commit()
        entry_id = cursor.lastrowid
        conn.close()
        return entry_id
    except Exception as e:
        print(f"Error recording history: {e}")
        return None

def get_history_entries(limit: int = 50):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, operation, original_filename, output_filename, output_filepath, file_size, status, error_message, created_at
            FROM history
            ORDER BY id DESC
            LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        entries = []
        for row in rows:
            entries.append({
                "id": row["id"],
                "operation": row["operation"],
                "original_filename": row["original_filename"],
                "output_filename": row["output_filename"],
                "output_filepath": row["output_filepath"],
                "file_size": row["file_size"],
                "formatted_size": format_file_size(row["file_size"]),
                "status": row["status"],
                "error_message": row["error_message"],
                "created_at": row["created_at"]
            })
        conn.close()
        return entries
    except Exception as e:
        print(f"Error fetching history: {e}")
        return []

def clear_history():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM history")
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Error clearing history: {e}")
        return False
