import os
from database import engine
from sqlmodel import Session, select
from models import Package

with Session(engine) as session:
    packages = session.exec(select(Package)).all()
    print(f"Total packages: {len(packages)}")
    for p in packages:
        print(f"ID: {p.id}, start_date: {p.start_date}, end_date: {p.end_date}, post_cost: {p.post_cost}")
