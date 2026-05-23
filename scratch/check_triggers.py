import sys
import os
from sqlalchemy import text
from sqlmodel import Session

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import engine as pg_engine

def check_triggers():
    pg_session = Session(pg_engine)
    query = text("""
        SELECT trigger_name, event_manipulation, action_statement
        FROM information_schema.triggers
        WHERE event_object_table = 'orders';
    """)
    res = pg_session.exec(query).all()
    print("Triggers on 'orders':", res)
    pg_session.close()

if __name__ == "__main__":
    check_triggers()
