import sys
import os
import pyodbc
from sqlalchemy import text
from sqlmodel import Session

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import engine as pg_engine
from sync_databases import TABLE_CONFIGS, ACCESS_CONN_STR

def check_ids():
    access_conn = pyodbc.connect(ACCESS_CONN_STR)
    access_cursor = access_conn.cursor()
    pg_session = Session(pg_engine)
    
    config = next(c for c in TABLE_CONFIGS if c["name"] == "orders")
    access_table = config["access_table"]
    postgres_table = config["postgres_table"]
    
    # Count rows
    access_cursor.execute(f"SELECT COUNT(*) FROM [{access_table}]")
    ac_count = access_cursor.fetchone()[0]
    
    pg_count = pg_session.exec(text(f"SELECT COUNT(*) FROM {postgres_table}")).first()
    
    print(f"Access count: {ac_count}")
    print(f"Postgres count: {pg_count}")
    
    # Check if 4776 exists
    access_cursor.execute(f"SELECT ID FROM [{access_table}] WHERE ID = 4776")
    ac_row = access_cursor.fetchone()
    print(f"Access row ID 4776 exists: {ac_row is not None}")
    
    pg_row = pg_session.exec(text(f"SELECT id FROM {postgres_table} WHERE id = 4776")).first()
    print(f"Postgres row ID 4776 exists: {pg_row is not None}")
    
    # Let's list top 5 rows from both
    access_cursor.execute(f"SELECT TOP 5 ID FROM [{access_table}] ORDER BY ID DESC")
    print("Access top 5:", [r[0] for r in access_cursor.fetchall()])
    
    print("PG top 5:", pg_session.exec(text(f"SELECT id FROM {postgres_table} ORDER BY id DESC LIMIT 5")).all())

    pg_session.close()
    access_conn.close()

if __name__ == "__main__":
    check_ids()
