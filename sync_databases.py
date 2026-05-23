import os
import sys
import json
import argparse
from datetime import datetime
from decimal import Decimal
import pyodbc
from sqlalchemy import text, inspect
from sqlmodel import Session

# Import database engine
from database import engine as pg_engine

# CONFIGURATION
SNAPSHOT_FILE = "sync_snapshot.json"
ACCESS_DB_PATH = r"G:\otor_be.accdb"
ACCESS_CONN_STR = f"Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={ACCESS_DB_PATH};"

# Table Mappings: Maps configuration name to Access and Postgres table names
TABLE_CONFIGS = [
    {
        "name": "sheikh",
        "access_table": "SHEIKH",
        "postgres_table": "sheikh",
        "timestamp_col": None
    },
    {
        "name": "orders",
        "access_table": "ORDER",  # Plural in PG, Singular in Access
        "postgres_table": "orders",
        "timestamp_col": "update_date"
    },
    {
        "name": "content",
        "access_table": "CONTENT",
        "postgres_table": "content",
        "timestamp_col": None
    },
    {
        "name": "expenses",
        "access_table": "EXPENSES",
        "postgres_table": "expenses",
        "timestamp_col": None
    },
    {
        "name": "money",
        "access_table": "MONEY",
        "postgres_table": "money",
        "timestamp_col": None
    },
    {
        "name": "package",
        "access_table": "PACKAGE",
        "postgres_table": "package",
        "timestamp_col": None
    },
    {
        "name": "order_history",
        "access_table": "ORDER_HISTORY",
        "postgres_table": "order_history",
        "timestamp_col": "update_date"
    }
]

# Access tables calculated fields that cannot be written or updated directly
CALCULATED_COLUMNS = {
    "ORDER": {"rest", "degree"},
    "CONTENT": {"degree"},
    "ORDER_HISTORY": {"rest", "degree"}
}

def load_snapshot():
    if os.path.exists(SNAPSHOT_FILE):
        try:
            with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load snapshot file ({e}). Starting fresh.")
    return {}

def save_snapshot(snapshot):
    try:
        with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error: Failed to save snapshot file ({e}).")

def is_equal(v1, v2):
    # Normalize Decimals
    if isinstance(v1, Decimal):
        v1 = float(v1)
    if isinstance(v2, Decimal):
        v2 = float(v2)
    # Normalize Floats to 2 decimal places to avoid minor precision mismatches
    if isinstance(v1, float):
        v1 = round(v1, 2)
    if isinstance(v2, float):
        v2 = round(v2, 2)
    # Normalize empty strings/whitespace and None
    if v1 == "" or (isinstance(v1, str) and v1.strip() == ""):
        v1 = None
    if v2 == "" or (isinstance(v2, str) and v2.strip() == ""):
        v2 = None
    # Normalize datetimes (strip tzinfo)
    if isinstance(v1, datetime) and isinstance(v2, datetime):
        return v1.replace(tzinfo=None) == v2.replace(tzinfo=None)
    
    return v1 == v2

def compute_row_hash(row_dict, exclude_cols=None):
    if not exclude_cols:
        exclude_cols = set()
    normalized = {}
    for k, v in row_dict.items():
        if k in exclude_cols or k == "id":
            continue
        # Normalize values
        val = v
        if isinstance(val, Decimal):
            val = float(val)
        if isinstance(val, float):
            val = round(val, 2)
        if val == "" or (isinstance(val, str) and val.strip() == ""):
            val = None
        if isinstance(val, datetime):
            val = val.replace(tzinfo=None).isoformat()
        normalized[k] = val
    # Sort keys to ensure deterministic hashing
    serialized = json.dumps(normalized, sort_keys=True, default=str)
    import hashlib
    return hashlib.md5(serialized.encode("utf-8")).hexdigest()

# Dynamic DB Type Mappings
def map_access_to_pg_type(access_type, size=None):
    t = access_type.upper()
    if "COUNTER" in t or "AUTOINCREMENT" in t:
        return "INTEGER"
    if "INTEGER" in t or "INT" in t or "SMALLINT" in t:
        return "INTEGER"
    if "LONGCHAR" in t or "MEMO" in t:
        return "TEXT"
    if "VARCHAR" in t or "TEXT" in t or "CHAR" in t:
        if size and int(size) > 0 and int(size) <= 255:
            return f"VARCHAR({size})"
        return "VARCHAR(255)"
    if "DATETIME" in t or "DATE" in t or "TIME" in t:
        return "TIMESTAMP"
    if "DOUBLE" in t or "FLOAT" in t or "REAL" in t:
        return "DOUBLE PRECISION"
    if "DECIMAL" in t or "NUMERIC" in t or "CURRENCY" in t:
        return "DECIMAL(18,2)"
    if "BIT" in t or "YESNO" in t or "BOOLEAN" in t:
        return "BOOLEAN"
    return "VARCHAR(255)"  # Fallback

def map_pg_to_access_type(pg_type_obj):
    t = str(pg_type_obj).upper()
    if "INT" in t:
        return "INTEGER"
    if "VARCHAR" in t:
        import re
        m = re.search(r"\d+", t)
        if m:
            return f"VARCHAR({m.group(0)})"
        return "VARCHAR(255)"
    if "TEXT" in t:
        return "LONGCHAR"  # MEMO in Access
    if "TIMESTAMP" in t or "DATE" in t:
        return "DATETIME"
    if "DOUBLE" in t or "FLOAT" in t:
        return "DOUBLE"
    if "NUMERIC" in t or "DECIMAL" in t:
        return "DECIMAL(18,2)"
    if "BOOL" in t:
        return "BIT"  # Yes/No in Access
    return "VARCHAR(255)"  # Fallback

def fetch_postgres_data(pg_session, config, columns):
    table = config["postgres_table"]
    # Wrap column names in double quotes to preserve case and prevent reserved word conflicts
    col_str = ", ".join(f'"{col}"' for col in columns)
    query = text(f"SELECT {col_str} FROM {table}")
    res = pg_session.exec(query).all()
    
    data_dict = {}
    for row in res:
        row_dict = dict(zip(columns, row))
        data_dict[row_dict["id"]] = row_dict
    return data_dict

def fetch_access_data(access_cursor, config, columns):
    table = config["access_table"]
    col_str = ", ".join(f"[{col.upper()}]" for col in columns)
    query = f"SELECT {col_str} FROM [{table}]"
    access_cursor.execute(query)
    rows = access_cursor.fetchall()
    
    col_names = [col[0].lower() for col in access_cursor.description]
    data_dict = {}
    for row in rows:
        row_dict = {}
        for idx, col_name in enumerate(col_names):
            val = row[idx]
            # Normalize Boolean / YesNo / Gender string values
            if col_name == "gender":
                if isinstance(val, str):
                    val_clean = val.strip()
                    if val_clean == "معلم":
                        row_dict[col_name] = True
                    elif val_clean == "معلمة":
                        row_dict[col_name] = False
                    else:
                        row_dict[col_name] = True # default
                elif val == -1 or val is True:
                    row_dict[col_name] = True
                elif val == 0 or val is False:
                    row_dict[col_name] = False
                else:
                    row_dict[col_name] = True # default
            else:
                row_dict[col_name] = val
        data_dict[row_dict["id"]] = row_dict
    return data_dict

def build_access_insert_query(table, columns):
    col_str = ", ".join(f"[{col.upper()}]" for col in columns)
    placeholders = ", ".join("?" for _ in columns)
    return f"INSERT INTO [{table}] ({col_str}) VALUES ({placeholders})"

def build_access_update_query(table, columns, id_col="id"):
    set_clauses = ", ".join(f"[{col.upper()}] = ?" for col in columns if col != id_col)
    return f"UPDATE [{table}] SET {set_clauses} WHERE [{id_col.upper()}] = ?"

def build_postgres_insert_query(table, columns):
    col_str = ", ".join(f'"{col}"' for col in columns)
    placeholders = ", ".join(f":{col}" for col in columns)
    return f'INSERT INTO "{table}" ({col_str}) VALUES ({placeholders})'

def build_postgres_update_query(table, columns, id_col="id"):
    set_clauses = ", ".join(f'"{col}" = :{col}' for col in columns if col != id_col)
    return f'UPDATE "{table}" SET {set_clauses} WHERE "{id_col}" = :{id_col}'

def run_sync(dry_run=False, master="postgres", delete_missing=False):
    print("=" * 70)
    print(f"DATABASE SYNC START: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if dry_run:
        print("NOTE: RUNNING IN DRY-RUN MODE (No schema changes or record writes will be saved)")
    print(f"Master default for conflicts: {master.upper()}")
    print(f"Delete missing (deletions propagation): {'ENABLED' if delete_missing else 'DISABLED'}")
    print("=" * 70)
    
    # Initialize snapshot
    snapshot = load_snapshot()
    new_snapshot = {}
    
    # Establish Connections
    print("Connecting to local Access database...")
    try:
        access_conn = pyodbc.connect(ACCESS_CONN_STR, autocommit=False)
        access_cursor = access_conn.cursor()
    except Exception as e:
        print(f"CRITICAL ERROR: Failed to connect to local Access DB at {ACCESS_DB_PATH}.\nDetails: {e}")
        sys.exit(1)
        
    print("Connecting to remote PostgreSQL database...")
    try:
        pg_session = Session(pg_engine)
        # Verify connection
        pg_session.exec(text("SELECT 1"))
    except Exception as e:
        print(f"CRITICAL ERROR: Failed to connect to PostgreSQL.\nDetails: {e}")
        access_conn.close()
        sys.exit(1)
        
    pg_inspector = inspect(pg_engine)
    
    total_pg_inserts = 0
    total_pg_updates = 0
    total_pg_deletes = 0
    
    total_ac_inserts = 0
    total_ac_updates = 0
    total_ac_deletes = 0
    
    has_errors = False
    
    try:
        for config in TABLE_CONFIGS:
            name = config["name"]
            access_table = config["access_table"]
            postgres_table = config["postgres_table"]
            timestamp_col = config["timestamp_col"]
            
            print(f"\nSynchronizing table: {name.upper()} (Access: {access_table} <-> PG: {postgres_table})")
            
            # --- SCHEMA SYNCHRONIZATION ---
            # 1. Fetch current Access columns
            access_cols = {}
            for col in access_cursor.columns(table=access_table):
                col_name_lower = col.column_name.lower()
                access_cols[col_name_lower] = {
                    "raw_name": col.column_name,
                    "type": col.type_name,
                    "size": col.column_size
                }
                
            # 2. Fetch current Postgres columns
            pg_cols = {}
            for col in pg_inspector.get_columns(postgres_table):
                col_name_lower = col["name"].lower()
                pg_cols[col_name_lower] = {
                    "raw_name": col["name"],
                    "type": col["type"]
                }
                
            # Save original keys for dry-run intersection (to avoid SELECT errors on uncreated columns)
            orig_access_keys = set(access_cols.keys())
            orig_pg_keys = set(pg_cols.keys())
                
            # 3. Detect and propagate missing columns
            # Access -> Postgres
            for col_name_lower, col_info in access_cols.items():
                if col_name_lower not in pg_cols:
                    pg_type = map_access_to_pg_type(col_info["type"], col_info["size"])
                    print(f"  [SCHEMA CHANGE] Found new column '{col_name_lower}' in Access [{access_table}]. Adding to Postgres '{postgres_table}' as {pg_type}...")
                    alter_query = f'ALTER TABLE "{postgres_table}" ADD COLUMN "{col_name_lower}" {pg_type}'
                    if not dry_run:
                        pg_session.exec(text(alter_query))
                        pg_session.commit()
                        print(f"  Successfully added column '{col_name_lower}' to Postgres.")
                    # Keep track for sync list
                    pg_cols[col_name_lower] = {
                        "raw_name": col_name_lower,
                        "type": pg_type
                    }
                    
            # Postgres -> Access
            for col_name_lower, col_info in pg_cols.items():
                if col_name_lower not in access_cols:
                    access_type = map_pg_to_access_type(col_info["type"])
                    print(f"  [SCHEMA CHANGE] Found new column '{col_name_lower}' in Postgres '{postgres_table}'. Adding to Access [{access_table}] as {access_type}...")
                    alter_query = f"ALTER TABLE [{access_table}] ADD COLUMN [{col_name_lower.upper()}] {access_type}"
                    if not dry_run:
                        access_cursor.execute(alter_query)
                        access_conn.commit()
                        print(f"  Successfully added column '{col_name_lower.upper()}' to Access.")
                    access_cols[col_name_lower] = {
                        "raw_name": col_name_lower.upper(),
                        "type": access_type,
                        "size": None
                    }
                    
            # 4. Formulate the active sync column list
            if dry_run:
                # In dry run, we must only sync columns that exist in BOTH databases to avoid SELECT errors
                sync_columns = list(orig_access_keys.intersection(orig_pg_keys))
            else:
                # In live run, since the schemas have been altered/aligned, we can sync the union of all columns
                sync_columns = list(set(access_cols.keys()).union(set(pg_cols.keys())))
                
            if "id" not in sync_columns:
                sync_columns.append("id")
            sync_columns.sort()
            
            # --- DATA SYNCHRONIZATION ---
            # Fetch datasets
            pg_data = fetch_postgres_data(pg_session, config, sync_columns)
            ac_data = fetch_access_data(access_cursor, config, sync_columns)
            
            # Load snapshot IDs & hashes (backward-compatible)
            snap_data = snapshot.get(name, {})
            if isinstance(snap_data, list):
                snap_ids = set(snap_data)
                snap_hashes = {}
            else:
                snap_ids = set(int(rid) for rid in snap_data.keys())
                snap_hashes = snap_data
                
            current_snap_data = {}
            
            # Tracks rows to insert/update/delete
            pg_to_insert = []
            pg_to_update = []
            pg_to_delete = []
            
            ac_to_insert = []
            ac_to_update = []
            ac_to_delete = []
            
            # Detect Updates and Insertions
            all_ids = set(pg_data.keys()).union(set(ac_data.keys()))
            
            exclude_cols = CALCULATED_COLUMNS.get(access_table, set())
            exclude_cols_for_hash = exclude_cols.copy()
            if timestamp_col:
                exclude_cols_for_hash.add(timestamp_col)
            
            for rid in all_ids:
                in_pg = rid in pg_data
                in_ac = rid in ac_data
                
                if in_pg and in_ac:
                    pg_row = pg_data[rid]
                    ac_row = ac_data[rid]
                    
                    diff_cols = [col for col in sync_columns if not is_equal(pg_row[col], ac_row[col])]
                    
                    if diff_cols:
                        # 3-Way Merge conflict resolution using hashes
                        pg_hash = compute_row_hash(pg_row, exclude_cols_for_hash)
                        ac_hash = compute_row_hash(ac_row, exclude_cols_for_hash)
                        snap_hash = snap_hashes.get(str(rid))
                        
                        use_pg = True
                        resolved_by_3way = False
                        
                        if snap_hash:
                            if ac_hash == snap_hash and pg_hash != snap_hash:
                                # Access has not changed, Postgres did. Postgres wins.
                                use_pg = True
                                resolved_by_3way = True
                                print(f"  [UPDATE ACCESS] ID #{rid}: Diff on {diff_cols}. Postgres wins (detected Postgres modification)")
                            elif pg_hash == snap_hash and ac_hash != snap_hash:
                                # Postgres has not changed, Access did. Access wins.
                                use_pg = False
                                resolved_by_3way = True
                                print(f"  [UPDATE POSTGRES] ID #{rid}: Diff on {diff_cols}. Access wins (detected Access modification)")
                                
                        if not resolved_by_3way:
                            # Fallback to timestamp resolution (only if we have historical snapshot hashes)
                            resolved_by_ts = False
                            if snap_hash and timestamp_col and timestamp_col in sync_columns:
                                pg_ts = pg_row.get(timestamp_col)
                                ac_ts = ac_row.get(timestamp_col)
                                
                                if isinstance(pg_ts, str):
                                    pg_ts = datetime.fromisoformat(pg_ts.replace("Z", ""))
                                if isinstance(ac_ts, str):
                                    ac_ts = datetime.fromisoformat(ac_ts.replace("Z", ""))
                                    
                                if pg_ts and ac_ts:
                                    pg_ts = pg_ts.replace(tzinfo=None)
                                    ac_ts = ac_ts.replace(tzinfo=None)
                                    if pg_ts > ac_ts:
                                        use_pg = True
                                        resolved_by_ts = True
                                    elif ac_ts > pg_ts:
                                        use_pg = False
                                        resolved_by_ts = True
                                        
                            if not resolved_by_ts:
                                # Fallback to master default tie-breaker
                                use_pg = (master == "postgres")
                                print(f"  [CONFLICT] ID #{rid}: Diff on {diff_cols}. Both databases modified or first sync. Fallback to master: " + ("POSTGRES wins" if use_pg else "ACCESS wins"))
                            else:
                                if use_pg:
                                    print(f"  [UPDATE ACCESS] ID #{rid}: Diff on {diff_cols}. Postgres wins (newer timestamp)")
                                else:
                                    print(f"  [UPDATE POSTGRES] ID #{rid}: Diff on {diff_cols}. Access wins (newer timestamp)")
                                    
                        if use_pg:
                            ac_to_update.append(pg_row)
                            winning_row = pg_row
                        else:
                            pg_to_update.append(ac_row)
                            winning_row = ac_row
                    else:
                        # No diff, both rows are equal
                        winning_row = pg_row
                        
                    winning_hash = compute_row_hash(winning_row, exclude_cols_for_hash)
                    current_snap_data[str(rid)] = winning_hash
                    
                elif in_pg and not in_ac:
                    if rid in snap_ids:
                        if delete_missing:
                            pg_to_delete.append(rid)
                            print(f"  [DELETE POSTGRES] ID #{rid}: Deleted from Access.")
                        else:
                            ac_to_insert.append(pg_data[rid])
                            winning_hash = compute_row_hash(pg_data[rid], exclude_cols_for_hash)
                            current_snap_data[str(rid)] = winning_hash
                            print(f"  [RE-INSERT ACCESS] ID #{rid}: Missing in Access, deletion sync disabled.")
                    else:
                        ac_to_insert.append(pg_data[rid])
                        winning_hash = compute_row_hash(pg_data[rid], exclude_cols_for_hash)
                        current_snap_data[str(rid)] = winning_hash
                        print(f"  [INSERT ACCESS] ID #{rid}: Created in Postgres.")
                        
                elif in_ac and not in_pg:
                    if rid in snap_ids:
                        if delete_missing:
                            ac_to_delete.append(rid)
                            print(f"  [DELETE ACCESS] ID #{rid}: Deleted from Postgres.")
                        else:
                            pg_to_insert.append(ac_data[rid])
                            winning_hash = compute_row_hash(ac_data[rid], exclude_cols_for_hash)
                            current_snap_data[str(rid)] = winning_hash
                            print(f"  [RE-INSERT POSTGRES] ID #{rid}: Missing in Postgres, deletion sync disabled.")
                    else:
                        pg_to_insert.append(ac_data[rid])
                        winning_hash = compute_row_hash(ac_data[rid], exclude_cols_for_hash)
                        current_snap_data[str(rid)] = winning_hash
                        print(f"  [INSERT POSTGRES] ID #{rid}: Created in Access.")
                        
            new_snapshot[name] = current_snap_data
            
            # Apply Changes
            # A. Postgres Inserts
            if pg_to_insert:
                insert_q = text(build_postgres_insert_query(postgres_table, sync_columns))
                for row in pg_to_insert:
                    if not dry_run:
                        pg_session.execute(insert_q, row)
                    total_pg_inserts += 1
                    
            # B. Postgres Updates
            if pg_to_update:
                update_q = text(build_postgres_update_query(postgres_table, sync_columns))
                for row in pg_to_update:
                    if not dry_run:
                        pg_session.execute(update_q, row)
                    total_pg_updates += 1
                    
            # C. Postgres Deletes
            if pg_to_delete:
                delete_q = text(f'DELETE FROM "{postgres_table}" WHERE "id" = :id')
                for rid in pg_to_delete:
                    if not dry_run:
                        pg_session.execute(delete_q, {"id": rid})
                    total_pg_deletes += 1
                    
            # D. Access Inserts
            if ac_to_insert:
                ac_insert_cols = [col for col in sync_columns if col not in CALCULATED_COLUMNS.get(access_table, set())]
                insert_q = build_access_insert_query(access_table, ac_insert_cols)
                for row in ac_to_insert:
                    params = []
                    for col in ac_insert_cols:
                        val = row[col]
                        if col == "gender":
                            val = "معلم" if val is True else "معلمة"
                        params.append(val)
                    if not dry_run:
                        access_cursor.execute(insert_q, params)
                    total_ac_inserts += 1
                    
            # E. Access Updates
            if ac_to_update:
                ac_update_cols = [col for col in sync_columns if col != "id" and col not in CALCULATED_COLUMNS.get(access_table, set())]
                update_q = build_access_update_query(access_table, ac_update_cols)
                for row in ac_to_update:
                    params = []
                    for col in ac_update_cols:
                        val = row[col]
                        if col == "gender":
                            val = "معلم" if val is True else "معلمة"
                        params.append(val)
                    params.append(row["id"])
                    if not dry_run:
                        access_cursor.execute(update_q, params)
                    total_ac_updates += 1
                    
            # F. Access Deletes
            if ac_to_delete:
                delete_q = f"DELETE FROM [{access_table}] WHERE [ID] = ?"
                for rid in ac_to_delete:
                    if not dry_run:
                        access_cursor.execute(delete_q, [rid])
                    total_ac_deletes += 1
                    
        # Commit transactions if not dry_run
        if not dry_run:
            print("\nSaving changes to both databases...")
            pg_session.commit()
            access_conn.commit()
            save_snapshot(new_snapshot)
            print("Successfully synchronized!")
        else:
            print("\nDry-run completed successfully. (Rollback executed, no changes saved.)")
            pg_session.rollback()
            access_conn.rollback()
            
    except Exception as e:
        print(f"\nCRITICAL SYNC ERROR: {e}")
        print("Rolling back transaction changes in both databases to prevent mismatch...")
        pg_session.rollback()
        access_conn.rollback()
        has_errors = True
    finally:
        pg_session.close()
        access_conn.close()
        
    print("\n" + "=" * 70)
    print("SYNCHRONIZATION SUMMARY:")
    print("=" * 70)
    print(f"PostgreSQL Actions:")
    print(f"  - Inserts: {total_pg_inserts}")
    print(f"  - Updates: {total_pg_updates}")
    print(f"  - Deletes: {total_pg_deletes}")
    print(f"Access Database ({ACCESS_DB_PATH}) Actions:")
    print(f"  - Inserts: {total_ac_inserts}")
    print(f"  - Updates: {total_ac_updates}")
    print(f"  - Deletes: {total_ac_deletes}")
    print("=" * 70)
    
    if has_errors:
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synchronize local Access DB (otor_be.accdb) with Neon PostgreSQL")
    parser.add_argument("--dry-run", action="store_true", help="Preview sync changes without writing to databases")
    parser.add_argument("--master", choices=["postgres", "access"], default="postgres", help="Tie-breaker winner database when values differ without timestamps (default: postgres)")
    parser.add_argument("--delete-missing", action="store_true", help="Propagate deletions bidirectionally (removes records present in snapshot but missing in one database)")
    
    args = parser.parse_args()
    run_sync(dry_run=args.dry_run, master=args.master, delete_missing=args.delete_missing)
