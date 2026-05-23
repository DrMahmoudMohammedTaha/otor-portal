import sys
import os
import json
from decimal import Decimal
from datetime import datetime
import pyodbc
from sqlalchemy import text
from sqlmodel import Session

# Add parent directory to path so we can import from project
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import engine as pg_engine
from sync_databases import compute_row_hash, TABLE_CONFIGS, CALCULATED_COLUMNS, ACCESS_CONN_STR, is_equal, load_snapshot

def debug():
    snapshot = load_snapshot()
    
    print("Connecting to local Access database...")
    access_conn = pyodbc.connect(ACCESS_CONN_STR, autocommit=False)
    access_cursor = access_conn.cursor()
    
    print("Connecting to remote PostgreSQL database...")
    pg_session = Session(pg_engine)
    
    # Let's inspect ID 4774 in ORDERS/ORDER table
    config = next(c for c in TABLE_CONFIGS if c["name"] == "orders")
    
    # Get columns
    access_table = config["access_table"]
    postgres_table = config["postgres_table"]
    
    access_cols = [col.column_name.lower() for col in access_cursor.columns(table=access_table)]
    
    # Fetch from Postgres
    col_str = ", ".join(f'"{col}"' for col in access_cols)
    pg_query = text(f"SELECT {col_str} FROM {postgres_table} WHERE id = 4774")
    pg_row = pg_session.exec(pg_query).first()
    
    # Fetch from Access
    ac_col_str = ", ".join(f"[{col.upper()}]" for col in access_cols)
    ac_query = f"SELECT {ac_col_str} FROM [{access_table}] WHERE ID = 4774"
    access_cursor.execute(ac_query)
    ac_row = access_cursor.fetchone()
    
    if not pg_row:
        print("Record 4774 not found in Postgres.")
    if not ac_row:
        print("Record 4774 not found in Access.")
        
    if pg_row and ac_row:
        pg_dict = dict(zip(access_cols, pg_row))
        
        # Access zip
        ac_col_names = [col[0].lower() for col in access_cursor.description]
        ac_dict = {}
        for idx, col_name in enumerate(ac_col_names):
            val = ac_row[idx]
            if col_name == "gender":
                if val == -1 or val is True:
                    ac_dict[col_name] = True
                else:
                    ac_dict[col_name] = False
            else:
                ac_dict[col_name] = val
                
        print("\n--- POSTGRES ROW ---")
        for k, v in sorted(pg_dict.items()):
            print(f"{k}: {v} ({type(v)})")
            
        print("\n--- ACCESS ROW ---")
        for k, v in sorted(ac_dict.items()):
            print(f"{k}: {v} ({type(v)})")
            
        diff_cols = [col for col in access_cols if not is_equal(pg_dict[col], ac_dict[col])]
        print(f"\nDifferences detected on: {diff_cols}")
        
        exclude_cols = CALCULATED_COLUMNS.get(access_table, set())
        pg_hash = compute_row_hash(pg_dict, exclude_cols)
        ac_hash = compute_row_hash(ac_dict, exclude_cols)
        
        snap_data = snapshot.get("orders", {})
        snap_hash = snap_data.get("4774") if isinstance(snap_data, dict) else None
        
        print(f"\nPG Hash:   {pg_hash}")
        print(f"AC Hash:   {ac_hash}")
        print(f"Snap Hash: {snap_hash}")
        
        if snap_hash:
            if ac_hash == snap_hash and pg_hash != snap_hash:
                print("Decision: PG changed. PG wins.")
            elif pg_hash == snap_hash and ac_hash != snap_hash:
                print("Decision: AC changed. AC wins.")
            elif pg_hash != snap_hash and ac_hash != snap_hash:
                print("Decision: Both changed/Conflict. Fallback.")
            else:
                print("Decision: Neither changed.")
        else:
            print("Decision: No snapshot hash found.")

    pg_session.close()
    access_conn.close()

if __name__ == "__main__":
    debug()
