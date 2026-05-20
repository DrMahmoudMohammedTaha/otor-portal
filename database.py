import os
from sqlmodel import create_engine, Session
from dotenv import load_dotenv

# Load connection strings
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in the environment or .env file.")

# SQLite compat: if using postgresql, standard engine is fine
engine = create_engine(DATABASE_URL, echo=False)

def get_session():
    with Session(engine) as session:
        yield session
