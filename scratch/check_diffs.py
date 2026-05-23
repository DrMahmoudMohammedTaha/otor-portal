import sys
import os
import json
import pyodbc
from sqlalchemy import text
from sqlmodel import Session

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import engine as pg_engine
from sync_databases import TABLE_CONFIGS, ACCESS_CONN_STR, is_equal, compute_row_hash, CALCULATED_COLUMNS, load_snapshot, fetch_postgres_data, fetch_access_data

def check_diffs():
    snapshot = load_snapshot()
    access_conn = pyodbc.connect(ACCESS_CONN_STR)
    access_cursor = access_conn.cursor()
    pg_session = Session(pg_engine)
    pg_inspector = pg_engine.dialect.inspector(pg_engine)
    
    for config in TABLE_CONFIGS:
        name = config["name"]
        access_table = config["access_table"]
        postgres_table = config["postgres_table"]
        
        # Get active columns
        access_cols = [col.column_name.lower() for col in access_cursor.columns(table=access_table)]
        pg_cols = [col["name"].lower() for col in pg_inspector.get_columns(postgres_table)]
        sync_columns = list(set(access_cols).intersection(set(pg_cols)))
        if "id" not in sync_columns:
            sync_columns.append("id")
        sync_columns.sort()
        
        pg_data = fetch_postgres_data(pg_session, config, sync_columns)
        ac_data = fetch_access_data(access_cursor, config, sync_columns)
        snap_data = snapshot.get(name, {})
        
        # Check diffs
        all_ids = set(pg_data.keys()).union(set(ac_data.keys()))
        for rid in all_ids:
            in_pg = rid in pg_data
            in_ac = rid in ac_data
            if in_pg and in_ac:
                pg_row = pg_data[rid]
                ac_row = ac_data[rid]
                diff_cols = [col for col in sync_columns if not is_equal(pg_row[col], ac_row[col])]
                if diff_cols:
                    print(f"\nTable: {name}, ID: {rid}")
                    print(f"  Diff cols: {diff_cols}")
                    exclude_cols = CALCULATED_COLUMNS.get(access_table, set())
                    pg_hash = compute_row_hash(pg_row, exclude_cols)
                    ac_hash = compute_row_hash(ac_row, exclude_cols)
                    snap_hash = snap_data.get(str(rid)) if isinstance(snap_data, dict) else None
                    print(f"  PG Hash:   {pg_hash}")
                    print(f"  AC Hash:   {ac_hash}")
                    print(f"  Snap Hash: {snap_hash}")
                    
                    # Print values for diff cols
                    for col in diff_cols:
                        print(f"    Col '{col}': PG='{pg_row[col]}' vs AC='{ac_row[col]}'")
            elif in_pg:
                print(f"\nTable: {name}, ID: {rid} exists only in PG")
            elif in_ac:
                print(f"\nTable: {name}, ID: {rid} exists only in AC")
                
    pg_session.close()
    access_conn.close()

if __name__ == "__main__":
    check_diffs()
